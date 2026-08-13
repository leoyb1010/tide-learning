import { after } from "next/server";
import { prisma } from "@/lib/db";
import { chatJson, isFailClosedLlmError } from "@/lib/llm";
import { AppError } from "@/lib/errors";
import { track } from "@/lib/analytics";
import { slugify } from "@/lib/format";
import { initGenJob, runCourseGenBackground } from "@/lib/course-gen";
import { importOutlinePrompt } from "@/lib/ai/prompts";
import { createCourseContentBrief, normalizeAssessmentNeed, serializeCourseContentBrief } from "@/lib/ai/content-brief";
import { sourcePolicyForTopic, trustedSourceAsOfDate } from "@/lib/ai/source-policy";
import { runWithGenerationJobLeaseHeartbeat } from "@/lib/generation-job-lease";
import {
  completeImportOperation,
  type ImportOperation,
  type ImportOperationResponse,
} from "@/lib/import-operation";

// 粘贴 / 文件导入共用的文本长度口径。
export const MIN_IMPORT_TEXT = 100;
export const MAX_IMPORT_TEXT = 50_000;
// 文件导入允许保留更长原文；大纲 prompt 会做覆盖首尾/标题/更正的确定性取样，逐节再按主题召回。
// 超过此值明确拒绝，绝不再静默截断后宣称“忠实导入”。
export const MAX_FILE_IMPORT_TEXT = 500_000;

interface OutlineItem {
  title: string;
  objective: string;
  assessmentNeed?: "none" | "check" | "practice" | "transfer" | "adaptive";
}
interface OutlineResult {
  outline: OutlineItem[];
}

export interface ImportCourseResult {
  courseId: string;
  slug: string;
  title: string;
  charCount: number;
  lessons: { id: string; title: string; summary: string | null }[];
  checkpoint?: boolean;
}

/**
 * 把「已抽取出的纯文本」结构化为一门 user_imported 课程：
 * LLM 切章 → 落库 Course + N 个空 Lesson（ai_block）→ GenerationJob → initGenJob + after() 后台逐节生成。
 *
 * 粘贴导入（/api/ai/import-source）与文件导入（/api/ai/import-file）共用此核心，
 * 二者差异只在「如何拿到 rawText」——粘贴直接给，文件先经 pdf-parse / mammoth / utf8 抽取。
 *
 * 调用方须已完成：requireLLMAccess（spendScene: import_source）、限流、in-flight 锁、
 * 以及 rawText 的长度校验（MIN/MAX_IMPORT_TEXT）。越权铁律：所有记录强制挂 userId。
 */
export async function structureImportedTextIntoCourse(opts: {
  userId: string;
  operation: ImportOperation;
  rawText: string;
  /** ImportedSource.kind：paste_text / file_pdf / file_docx / file_text，仅作来源追溯。 */
  kind: string;
  title?: string;
  /** v3.2 课件模板 key（见 templates.ts）；缺省 classic。 */
  template?: string;
  /** v3.2 生成所用模型 key（见 models.ts）；缺省默认模型。 */
  model?: string;
  /** v3.4 排版质量档：standard / premium。 */
  qualityTier?: "standard" | "premium";
  /** 导入现成大纲时先停在 OutlineCheckpoint，由作者确认结构后再逐节生成。 */
  checkpoint?: boolean;
}): Promise<ImportCourseResult> {
  const { userId, rawText, kind, template, model, qualityTier = "standard", checkpoint = false } = opts;
  const title = (opts.title?.trim() || rawText.slice(0, 20)).slice(0, 120);
  const sourcePolicy = sourcePolicyForTopic(`${title} ${rawText.slice(0, 2_000)}`);
  // 风险主题仍只看标题+开头，避免超长文档中一次历史性提及误分类；
  // 但“截至日期”是真值元数据，必须扫描完整已导入原文，不能困在前 2000 字。
  const sourceAsOf = sourcePolicy.asOfDate ?? trustedSourceAsOfDate(rawText);
  if (sourcePolicy.requiresAsOfDate && !sourceAsOf) {
    throw new AppError("导入资料涉及最新/当前信息，请先在标题或原文中补充截至日期", 422, false);
  }

  // —— 内置 prompt 库：忠于原文切章 + 模板结构。输出契约 {outline:[{title, objective}]}。——
  const { system, user: userMsg } = importOutlinePrompt({ title, rawText, template });
  let outline: OutlineItem[] = [];
  try {
    const result = await runWithGenerationJobLeaseHeartbeat(opts.operation.lease, () => chatJson<OutlineResult>({
      system,
      user: userMsg,
      temperature: 0.3,
      maxTokens: 6000,
      model,
      // 切章是导入点击后同步等待的调用：不做超时重试，避免慢模型 120s 漫长转圈；
      // 失败会走下方「退回单章」兜底，导入不空。逐节生成（后台）仍保留默认重试。
      retries: 0,
      billing: {
        userId,
        scene: "import_source",
        callKey: `import-outline:${opts.operation.lease.jobId}:f${opts.operation.lease.fencingToken}`,
        operationKey: opts.operation.operationKey,
      },
    }));
    const raw = Array.isArray(result?.outline) ? result.outline : [];
    outline = raw
      .filter((o) => o && typeof o.title === "string" && o.title.trim())
      .map((o) => ({
        title: o.title.trim().slice(0, 120),
        objective: (typeof o.objective === "string" ? o.objective : "").trim().slice(0, 300),
        assessmentNeed: normalizeAssessmentNeed(o.assessmentNeed),
      }))
      .slice(0, 24);
  } catch (error) {
    // 并发消费导致的真实余额不足不能被“单章兜底”绕过；供应商/格式失败则允许无计费降级。
    if (isFailClosedLlmError(error)) throw error;
    outline = [];
  }
  // 切章失败退回单章，保证导入不空。
  if (outline.length === 0) {
    outline = [{ title, objective: "根据导入材料整理的学习内容", assessmentNeed: "adaptive" }];
  }

  const slug = slugify(title) + "-" + Math.random().toString(36).slice(2, 6);

  // —— 事务落库：Source + Course + Lessons + 客户端回放快照 + operation done ——
  // 不再在 LLM 前先建孤儿 ImportedSource；响应丢失后同 requestId 只回放这个原子结果。
  const created = await prisma.$transaction(async (tx) => {
    const course = await tx.course.create({
      data: {
        slug,
        title,
        description: null,
        category: "user_imported",
        level: "L1",
        status: "published",
        coverColor: "tide",
        origin: "user_imported",
        authorUserId: userId,
        ownerId: userId,
        visibility: "private",
        genStatus: checkpoint ? "outline_draft" : "generating",
        contentBriefJson: serializeCourseContentBrief(createCourseContentBrief({
          request: `忠实地把《${title}》整理成可学习、可检验的课程`,
          plan: {
            learnerOutcome: "能够复述、解释并应用导入资料中的核心内容",
            scope: "仅覆盖导入资料中明确出现的主题、事实与方法",
            capstone: "用导入资料中的方法完成一次综合解释或应用任务",
            exclusions: ["导入资料没有提供依据的延伸知识"],
          },
          sourceBased: true,
          topicType: sourcePolicy.topicType,
          sourceAsOf,
          confirmedOutline: outline.map((item) => ({
            title: item.title, objective: item.objective, assessmentNeed: item.assessmentNeed,
          })),
        })),
        template: template ?? null,
        modelUsed: model ?? null,
        qualityTier,
        disclaimer: "本课程由用户导入材料经 AI 结构化，内容仅供学习参考",
      },
    });

    await Promise.all(
      outline.map((o, i) =>
        tx.lesson.create({
          data: {
            courseId: course.id,
            title: o.title,
            summary: o.objective || null,
            sortOrder: i,
            contentType: "ai_block",
            blocksJson: null,
            isFree: i === 0,
            status: "published",
          },
        }),
      ),
    );

    const lessons = await tx.lesson.findMany({
      where: { courseId: course.id },
      orderBy: { sortOrder: "asc" },
      // 专业模式确认会全量 PATCH 大纲；带回 summary 才能无损保留导入阶段生成的学习目标。
      select: { id: true, title: true, summary: true },
    });

    const source = await tx.importedSource.create({
      data: {
        userId,
        kind,
        title,
        rawText,
        charCount: rawText.length,
        parseStatus: "parsed",
        generatedCourseId: course.id,
      },
    });
    const response: ImportOperationResponse = {
      courseId: course.id,
      slug: course.slug,
      title: course.title,
      charCount: rawText.length,
      lessons,
      ...(checkpoint ? { checkpoint: true } : {}),
    };
    await completeImportOperation(tx, opts.operation, course.id, response);
    return { course, lessons, source, response };
  });

  await track({
    eventName: "ai_import_source",
    userId,
    properties: {
      sourceId: created.source.id,
      courseId: created.course.id,
      lessons: created.lessons.length,
      chars: rawText.length,
      kind,
    },
  }).catch(() => undefined);

  // —— 服务端后台续跑：大纲已落库，逐节生成交给 after() 在响应返回后接管（关页/刷新不影响）。——
  const courseId = created.course.id;
  if (!checkpoint) {
    const lease = await initGenJob(courseId, userId, created.lessons.length, { category: "user_imported" }).catch((error) => {
      // 课程+回放快照已原子提交，调度瞬时失败不能向 UI 伪报未交付。
      // 生产 worker 会扫描 generating 课程并补建/接管 course_gen job。
      console.error("[course-import] course worker scheduling deferred:", error);
      return null;
    });
    if (lease) {
      try {
        after(async () => {
          await runCourseGenBackground(courseId, userId, lease);
        });
      } catch (error) {
        console.error("[course-import] after scheduling deferred:", error);
      }
    }
  }
  return created.response;
}
