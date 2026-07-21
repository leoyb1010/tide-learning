import { after } from "next/server";
import { prisma } from "@/lib/db";
import { chatJson } from "@/lib/llm";
import { creditingOnUsage } from "@/lib/credits";
import { track } from "@/lib/analytics";
import { slugify } from "@/lib/format";
import { initGenJob, runCourseGenBackground } from "@/lib/course-gen";
import { importOutlinePrompt } from "@/lib/ai/prompts";
import { createCourseContentBrief, serializeCourseContentBrief } from "@/lib/ai/content-brief";

// 粘贴 / 文件导入共用的文本长度口径。
export const MIN_IMPORT_TEXT = 100;
export const MAX_IMPORT_TEXT = 50_000;

interface OutlineItem {
  title: string;
  objective: string;
}
interface OutlineResult {
  outline: OutlineItem[];
}

export interface ImportCourseResult {
  courseId: string;
  slug: string;
  title: string;
  charCount: number;
  lessons: { id: string; title: string }[];
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

  // —— 先落库 ImportedSource（已抽取出纯文本即 parsed）——
  const source = await prisma.importedSource.create({
    data: { userId, kind, title, rawText, charCount: rawText.length, parseStatus: "parsed" },
  });

  // —— 内置 prompt 库：忠于原文切章 + 模板结构。输出契约 {outline:[{title, objective}]}。——
  const { system, user: userMsg } = importOutlinePrompt({ title, rawText, template });
  let outline: OutlineItem[] = [];
  try {
    const result = await chatJson<OutlineResult>({
      system,
      user: userMsg,
      temperature: 0.3,
      maxTokens: 6000,
      model,
      // 切章是导入点击后同步等待的调用：不做超时重试，避免慢模型 120s 漫长转圈；
      // 失败会走下方「退回单章」兜底，导入不空。逐节生成（后台）仍保留默认重试。
      retries: 0,
      onUsage: creditingOnUsage(userId, "import_source"),
    });
    const raw = Array.isArray(result?.outline) ? result.outline : [];
    outline = raw
      .filter((o) => o && typeof o.title === "string" && o.title.trim())
      .map((o) => ({
        title: o.title.trim().slice(0, 120),
        objective: (typeof o.objective === "string" ? o.objective : "").trim().slice(0, 300),
      }))
      .slice(0, 24);
  } catch {
    outline = [];
  }
  // 切章失败退回单章，保证导入不空。
  if (outline.length === 0) {
    outline = [{ title, objective: "根据导入材料整理的学习内容" }];
  }

  const slug = slugify(title) + "-" + Math.random().toString(36).slice(2, 6);

  // —— 事务落库：Course + N 个空 Lesson + 回填 generatedCourseId + GenerationJob ——
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
      select: { id: true, title: true },
    });

    await tx.importedSource.update({
      where: { id: source.id },
      data: { generatedCourseId: course.id },
    });

    await tx.generationJob.create({
      data: {
        userId,
        type: "import_structure",
        status: "done",
        inputJson: JSON.stringify({ sourceId: source.id, charCount: rawText.length, kind, template: template ?? null, model: model ?? null, qualityTier }),
        resultRef: course.id,
        finishedAt: new Date(),
      },
    });

    return { course, lessons };
  });

  await track({
    eventName: "ai_import_source",
    userId,
    properties: {
      sourceId: source.id,
      courseId: created.course.id,
      lessons: created.lessons.length,
      chars: rawText.length,
      kind,
    },
  });

  // —— 服务端后台续跑：大纲已落库，逐节生成交给 after() 在响应返回后接管（关页/刷新不影响）。——
  const courseId = created.course.id;
  if (!checkpoint) {
    await initGenJob(courseId, userId, created.lessons.length, { category: "user_imported" });
    after(async () => {
      // after() 内绝不能抛：runCourseGenBackground 已全程 try/catch 自我兜底。
      await runCourseGenBackground(courseId, userId);
    });
  }

  return {
    courseId: created.course.id,
    slug: created.course.slug,
    title: created.course.title,
    charCount: rawText.length,
    lessons: created.lessons,
    ...(checkpoint ? { checkpoint: true } : {}),
  };
}
