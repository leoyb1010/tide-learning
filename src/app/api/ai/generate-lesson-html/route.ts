import { NextRequest } from "next/server";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { requireLessonGenAccess } from "@/lib/ai-guard";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { selectModelFor } from "@/lib/ai/models";
import { generateLessonHtml } from "@/lib/ai/courseware-gen";

export const dynamic = "force-dynamic";

/**
 * POST /api/ai/generate-lesson-html —— v3.3 把一节的块课件升级为「多样化 HTML 课件」。
 *
 * body: { lessonId, enhance?: boolean, model?: string }
 * - 默认 enhance=false：走确定性渲染引擎（按课级设计系统 × Variance 抽签渲染，免费、快、可复现）。
 * - enhance=true：先试 LLM bespoke HTML（按真实 token 记 generate_lesson_html），过安全/反slop 校验才采用，
 *   否则回落确定性渲染；再不行由内核兜底。绝不空/崩（内容层 blocksJson 始终保留）。
 * 权益：需 canUseLLM（enhance 才真花钱，但入口统一按 LLM 能力门控）。限流：每用户每小时 60 节。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);

    // 审计修复：鉴权+限流先于任何业务 DB 触达（同 generate-lesson，防匿名无限流打库）。
    const preUser = await requireUser();
    assertUserRateLimit(preUser.id, "ai_gen_lesson_html", 60, 3_600_000);

    const body = (await req.json().catch(() => null)) as { lessonId?: string; enhance?: boolean; model?: string } | null;
    const lessonId = body?.lessonId?.trim();
    if (!lessonId) return fail("缺少 lessonId");

    // 蓝图 D5：免费用户对自己名下课放行（确定性渲染零 LLM 成本）；enhance 精修仍会员专属（下方钳制）。
    const target = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { course: { select: { authorUserId: true } } },
    });
    const { user, snapshot } = await requireLessonGenAccess(target?.course?.authorUserId, {
      spendScene: "generate_lesson_html",
    });

    // 按用户档位校验请求模型（tier 门控）：resolveModel/chat 只查 isModelUsable 不查 tier，
    // 直传 body.model 会让「非会员档」绕过 premium 门。此处经 selectModelFor 按 canUseLLM(=会员) 过滤，
    // 不匹配档位则返回 null → 下游用默认模型，杜绝越档取用。
    const allowedModel = selectModelFor(body?.model?.trim() || null, snapshot.canUseLLM);

    let result;
    try {
      result = await generateLessonHtml(lessonId, user.id, {
        // 蓝图 D5 钳制：bespoke 精修是订阅权益，免费体验课只走确定性渲染（不花 LLM 钱）。
        enhance: Boolean(body?.enhance) && snapshot.isSubscriber,
        model: allowedModel?.key ?? null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "章节不存在") return fail("章节不存在", 404);
      if (msg === "无权操作该课程") throw new AppError("无权操作该课程", 403);
      throw e;
    }

    if (!result.ok) return fail("本节尚无内容块，请先生成块课件再升级为 HTML 课件", 409);
    return ok({ lessonId, engine: result.engine });
  });
}
