import { NextRequest, after } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { chatJson } from "@/lib/llm";
import { assertCanSpend, creditingOnUsage } from "@/lib/credits";
import { requireCourseGenAccess } from "@/lib/ai-guard";
import { track } from "@/lib/analytics";
import { slugify } from "@/lib/format";
import { initGenJob, runCourseGenBackground } from "@/lib/course-gen";
import { courseOutlinePrompt } from "@/lib/ai/prompts";
import { isValidTemplate } from "@/lib/ai/templates";
import { selectModelFor } from "@/lib/ai/models";
import { parseBlueprint, serializeBlueprint, blueprintOutlineFragment, lessonRangeForLength } from "@/lib/ai/blueprint";
import { createCourseContentBrief, serializeCourseContentBrief } from "@/lib/ai/content-brief";
import { acquireInflight, releaseInflight } from "@/lib/ai/inflight";

export const dynamic = "force-dynamic";

interface OutlineItem {
  title: string;
  objective: string;
  difficulty: string;
}

interface OutlineResult {
  title: string;
  subtitle: string;
  intro: string;
  plan?: {
    learnerOutcome?: unknown;
    scope?: unknown;
    prerequisites?: unknown;
    capstone?: unknown;
    exclusions?: unknown;
    planningRationale?: unknown;
  };
  outline: OutlineItem[];
}

/**
 * POST /api/ai/generate-course —— AI 自习室 引擎A · Step0：一句话需求 → 课程大纲。
 *
 * 生成课程元信息 + 6-8 节大纲，落库为一门 private 的 ai_generated 课程（generating 态）
 * 与 N 个空 Lesson（blocksJson 待逐节生成）。返回 courseId/slug/lessons 供前端逐节触发。
 * 权益：需 canUseLLM。限流：每用户每天 5 门。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    // 权益闸门（蓝图 D5）：订阅者照旧；免费用户每月 N 次体验造课（standard 档 + free tier 模型，
    // 见 requireCourseGenAccess）。余额预检留到限流之后，保持原有顺序。
    const { user, snapshot } = await requireCourseGenAccess({ precheckSpend: false });

    // 端点级幂等（P2）：同一用户已有未完成的造课请求（进程内 in-flight 锁）直接拒绝，
    // 防双击/重放并发建两门课、双份大纲扣费。finally 释放。
    if (!acquireInflight("course_gen", user.id)) {
      return fail("已有生成任务进行中，请稍后再试", 409);
    }
    try {
      // 高成本 AI：按用户限流，每天 10 门（真实成本由积分门兜底；此前 5/天 且与
      // confirm/regenerate/resume 共用作用域——专业模式一门课吃 2-3 次,两门即锁死,已拆分）。
      assertUserRateLimit(user.id, "ai_gen_course", 10, 86_400_000);

      const body = (await req.json().catch(() => null)) as {
        prompt?: string;
        category?: string;
        template?: string;
        model?: string;
        qualityTier?: string;
        /** L2 可控造课：专业模式下先停在大纲检查点（outline_draft），由用户确认后再扇出逐节生成。 */
        checkpoint?: boolean;
        /** L1 课程蓝图（专业模式）：受众/口吻/篇幅/块偏好/参考资料，透传进大纲与逐节 prompt。 */
        blueprint?: unknown;
      } | null;
      // 专业模式大纲检查点：置真则大纲落库后停在 outline_draft，不自动扇出（等 /outline/confirm）。
      const checkpoint = body?.checkpoint === true;
      // L1 蓝图：白名单校验后落库 blueprintJson（逐节生成读它定制内容 + grounding）。
      const blueprint = parseBlueprint(body?.blueprint);
      const prompt = body?.prompt?.trim();
      if (!prompt) return fail("请描述你想学的内容");
      if (prompt.length < 4) return fail("需求太短，请多说几个字（至少 4 字）");
      if (prompt.length > 500) return fail("需求描述过长，请精简到 500 字以内");

      const category = body?.category?.trim() || "ai_skill";

      // v3.2 课件模板：模板全员免费，非法 key 直接拒绝（不静默回落，避免脏数据落库）。
      const provided = body?.template?.trim() || undefined;
      if (provided && !isValidTemplate(provided)) return fail("未知的课件模板");
      // 未显式选择时保持自由导演，不再暗中挑一套模板并把它注入全课内容结构。
      const template = provided ?? null;

      // v3.2 选模型：会员可选高级模型。请求了不在可用集内的模型 → 402（会员专享/未配置）。
      const requestedModel = body?.model?.trim();
      const modelEntry = selectModelFor(requestedModel, snapshot.isSubscriber);
      if (!modelEntry) {
        return requestedModel
          ? fail("该模型为会员专享或暂不可用，请升级订阅或换用默认模型", 402)
          : fail("AI 服务未配置", 503);
      }
      const modelKey = modelEntry.key;
      const qualityTier = body?.qualityTier === "premium" ? "premium" : "standard";
      if (qualityTier === "premium" && !snapshot.isSubscriber) {
        return fail("深度研究为会员专享，请升级订阅或使用完整生成", 402);
      }

      // 积分预检（P1-3 修复）：按所选模型的真实计费权重设门槛（高级模型门槛更高），
      // 堵住「余额仅够基准模型 1 门却用高级模型发起满额造课」的超额免单缺口。
      // 逐节生成的整课扇出成本另由 runCourseGenBackground 内的「逐节预检」按累计预估兜住。
      await assertCanSpend(user.id, "generate_course", modelKey);

      // 内置 prompt 库：金牌架构师 + 分赛道吸引力包 + 起承转合 + 模板结构 + 合规底线。
      // 输出契约不变：{title, subtitle, intro, outline:[{title, objective, difficulty}]}。
      const lessonRange = blueprint?.length ? lessonRangeForLength(blueprint.length) : undefined;
      const { system, user: userMsg } = courseOutlinePrompt({ prompt, category, template: template ?? undefined, lessonRange });
      // L1 蓝图：受众/口吻/篇幅影响大纲规划，追加到 user 消息末尾。
      const userMsgWithBlueprint = userMsg + blueprintOutlineFragment(blueprint);

      const result = await chatJson<OutlineResult>({
        system,
        user: userMsgWithBlueprint,
        temperature: 0.5,
        maxTokens: 6000,
        model: modelKey,
        // 大纲是用户点击后同步等待的调用：不做超时重试，避免慢模型「60s×2=120s」的漫长转圈；
        // 单次 60s 仍失败即快速回错，前端明确提示而非久等。逐节生成（后台）仍保留默认重试。
        retries: 0,
        onUsage: creditingOnUsage(user.id, "generate_course"),
      });

      // —— 规范化 LLM 产出，兜底非法结构 ——
      const title = (result?.title || "").trim() || prompt.slice(0, 20);
      const subtitle = (result?.subtitle || "").trim() || null;
      const intro = (result?.intro || "").trim();
      const rawOutline = Array.isArray(result?.outline) ? result.outline : [];
      // 篇幅是范围而非固定配额；保留模型按主题复杂度少设或多设的决策。
      const outline = rawOutline
        .filter((o) => o && typeof o.title === "string" && o.title.trim())
        .map((o) => ({
          title: o.title.trim().slice(0, 120),
          objective: (typeof o.objective === "string" ? o.objective : "").trim().slice(0, 300),
          difficulty: (typeof o.difficulty === "string" ? o.difficulty : "").trim().slice(0, 20),
        }))
        .slice(0, lessonRange?.max ?? 24);
      if (outline.length === 0) throw new AppError("大纲生成失败，请调整需求后重试", 502);

      const contentBrief = createCourseContentBrief({ request: prompt, plan: result?.plan });

      // v5 专属视觉：本课设计 brief 不在此同步生成（避免给用户点「生成课程」再叠加一次 LLM 阻塞，
      // review #5）。designJson 先留空,由后台 runCourseGenBackground 的 ensureDesignBrief 在渲染前补齐
      // （失败降级固定皮肤;续造/重拟大纲后确认会再试/按新大纲刷新）。

      const slug = slugify(title) + "-" + Math.random().toString(36).slice(2, 6);

      // —— 事务落库：Course + N 个空 Lesson + GenerationJob ——
      const created = await prisma.$transaction(async (tx) => {
        const course = await tx.course.create({
          data: {
            slug,
            title,
            subtitle,
            description: intro || null,
            category,
            level: "L1",
            status: "published",
            coverColor: "tide",
            origin: "ai_generated",
            authorUserId: user.id,
            ownerId: user.id,
            visibility: "private",
            // 检查点模式先停在 outline_draft（等用户确认），否则直接 generating 走后台扇出。
            genStatus: checkpoint ? "outline_draft" : "generating",
            blueprintJson: blueprint ? serializeBlueprint(blueprint) : null,
            contentBriefJson: serializeCourseContentBrief(contentBrief),
            // designJson 留空：由后台 ensureDesignBrief 生成本课专属 brief 后写入（v5，见上）。
            template,
            modelUsed: modelKey,
            qualityTier,
            disclaimer: "本课程由 AI 生成，内容仅供学习参考",
          },
        });

        // 逐节创建空课件（首节免费试学）
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

        // 重新按 sortOrder 取回，保证返回顺序稳定
        const lessons = await tx.lesson.findMany({
          where: { courseId: course.id },
          orderBy: { sortOrder: "asc" },
          select: { id: true, title: true },
        });

        await tx.generationJob.create({
          data: {
            userId: user.id,
            type: "course_outline",
            status: "done",
            inputJson: JSON.stringify({ prompt, category, template, model: modelKey, qualityTier }),
            resultRef: course.id,
            finishedAt: new Date(),
          },
        });

        return { course, lessons };
      });

      await track({
        eventName: "ai_gen_course",
        userId: user.id,
        properties: { courseId: created.course.id, category, lessons: created.lessons.length, qualityTier },
      });

      const courseId = created.course.id;
      const total = created.lessons.length;

      // —— L2 检查点模式：大纲已落库为 outline_draft，不建 job、不扇出，直接把大纲交给前端确认 ——
      // 用户在大纲检查点增删改排序后调 /outline/confirm 才真正开始逐节生成。
      if (checkpoint) {
        return ok({
          courseId,
          slug: created.course.slug,
          title: created.course.title,
          checkpoint: true,
          genStatus: "outline_draft",
          lessons: created.lessons,
        });
      }

      // —— v3.0 服务端后台续跑：大纲已落库，逐节生成交给 after() 在响应返回后接管 ——
      // 建课级进度 job（course_gen，一课一条，记 total/done/failed/currentLessonId），
      // 再注册后台任务：关页面/刷新也不影响，前端凭 gen-progress 轮询恢复进度。
      await initGenJob(courseId, user.id, total, { prompt, category });
      after(async () => {
        // after() 内部绝不能抛：runCourseGenBackground 已全程 try/catch 自我兜底。
        await runCourseGenBackground(courseId, user.id);
      });

      // 响应立即返回大纲：前端剧场照常逐条展示，但真实生成已由服务端保障（断点续造）。
      return ok({
        courseId,
        slug: created.course.slug,
        title: created.course.title, // 供前端「可退出」横幅显示真实课名（附加字段，不改既有契约）
        lessons: created.lessons,
      });
    } finally {
      releaseInflight("course_gen", user.id);
    }
  });
}
