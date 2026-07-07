import { NextRequest, after } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { chatJson } from "@/lib/llm";
import { assertCanSpend, creditingOnUsage } from "@/lib/credits";
import { requireLLMAccess } from "@/lib/ai-guard";
import { track } from "@/lib/analytics";
import { slugify } from "@/lib/format";
import { initGenJob, runCourseGenBackground } from "@/lib/course-gen";
import { courseOutlinePrompt } from "@/lib/ai/prompts";
import { isValidTemplate, pickTemplate } from "@/lib/ai/templates";
import { selectModelFor } from "@/lib/ai/models";
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
    // 权益闸门：AI 能力需订阅（余额预检留到限流之后，保持原有先限流再预检的顺序）
    const { user, snapshot } = await requireLLMAccess({ precheckSpend: false });

    // 端点级幂等（P2）：同一用户已有未完成的造课请求（进程内 in-flight 锁）直接拒绝，
    // 防双击/重放并发建两门课、双份大纲扣费。finally 释放。
    if (!acquireInflight("generate_course", user.id)) {
      return fail("已有生成任务进行中，请稍后再试", 409);
    }
    try {
      // 高成本 AI：按用户限流，每天 5 门
      assertUserRateLimit(user.id, "ai_gen_course", 5, 86_400_000);

      // 积分预检：余额不足抛 402。造课高成本（generate_course 权重 1.0），按该场景最坏成本
      // 设门槛，堵住「余额仅够 1 分却发起满额造课」的超额免单缺口。
      await assertCanSpend(user.id, "generate_course");

      const body = (await req.json().catch(() => null)) as {
        prompt?: string;
        category?: string;
        template?: string;
        model?: string;
      } | null;
      const prompt = body?.prompt?.trim();
      if (!prompt) return fail("请描述你想学的内容");
      if (prompt.length < 4) return fail("需求太短，请多说几个字（至少 4 字）");
      if (prompt.length > 500) return fail("需求描述过长，请精简到 500 字以内");

      const category = body?.category?.trim() || "ai_skill";

      // v3.2 课件模板：模板全员免费，非法 key 直接拒绝（不静默回落，避免脏数据落库）。
      const provided = body?.template?.trim() || undefined;
      if (provided && !isValidTemplate(provided)) return fail("未知的课件模板");
      // #3b：未显式选模板时据内容自动匹配课型，避免全默认 classic → 内容块千篇一律。
      const template = provided ?? pickTemplate({ category, prompt });

      // v3.2 选模型：会员可选高级模型。请求了不在可用集内的模型 → 402（会员专享/未配置）。
      const requestedModel = body?.model?.trim();
      const modelEntry = selectModelFor(requestedModel, snapshot.isSubscriber);
      if (!modelEntry) {
        return requestedModel
          ? fail("该模型为会员专享或暂不可用，请升级订阅或换用默认模型", 402)
          : fail("AI 服务未配置", 503);
      }
      const modelKey = modelEntry.key;

      // 内置 prompt 库：金牌架构师 + 分赛道吸引力包 + 起承转合 + 模板结构 + 合规底线。
      // 输出契约不变：{title, subtitle, intro, outline:[{title, objective, difficulty}]}。
      const { system, user: userMsg } = courseOutlinePrompt({ prompt, category, template });

      const result = await chatJson<OutlineResult>({
        system,
        user: userMsg,
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
      const outline = rawOutline
        .filter((o) => o && typeof o.title === "string" && o.title.trim())
        .map((o) => ({
          title: o.title.trim().slice(0, 120),
          objective: (typeof o.objective === "string" ? o.objective : "").trim().slice(0, 300),
          difficulty: (typeof o.difficulty === "string" ? o.difficulty : "").trim().slice(0, 20),
        }))
        .slice(0, 8);
      if (outline.length === 0) throw new AppError("大纲生成失败，请调整需求后重试", 502);

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
            genStatus: "generating",
            template: template ?? null,
            modelUsed: modelKey,
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
            inputJson: JSON.stringify({ prompt, category, template: template ?? null, model: modelKey }),
            resultRef: course.id,
            finishedAt: new Date(),
          },
        });

        return { course, lessons };
      });

      await track({
        eventName: "ai_gen_course",
        userId: user.id,
        properties: { courseId: created.course.id, category, lessons: created.lessons.length },
      });

      // —— v3.0 服务端后台续跑：大纲已落库，逐节生成交给 after() 在响应返回后接管 ——
      // 建课级进度 job（course_gen，一课一条，记 total/done/failed/currentLessonId），
      // 再注册后台任务：关页面/刷新也不影响，前端凭 gen-progress 轮询恢复进度。
      const courseId = created.course.id;
      const total = created.lessons.length;
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
      releaseInflight("generate_course", user.id);
    }
  });
}
