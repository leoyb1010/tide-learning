import { NextRequest } from "next/server";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { resolveEntitlement } from "@/lib/entitlement";
import { assertCanSpend } from "@/lib/credits";
import { generateLessonCore } from "@/lib/course-gen";

export const dynamic = "force-dynamic";

/**
 * POST /api/ai/generate-lesson —— AI 自习室 引擎A · Step1..N：逐节生成块课件。
 *
 * v3.0：生成/校验/降级/扣费/收尾核心已抽到 course-gen.ts 的 generateLessonCore
 *（含 12 块协议叙事 prompt、越权铁律、幂等、genStatus=ready 收尾），
 * 本 route 只保留请求级闸门（同源 / 登录 / 权益 / 余额预检 / 限流）与结构性错误映射。
 * 权益：需 canUseLLM。限流：每用户每小时 60 节。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();

    const snapshot = await resolveEntitlement(user.id);
    if (!snapshot.canUseLLM) throw new AppError("AI 功能需订阅后使用", 402);

    await assertCanSpend(user.id);

    assertUserRateLimit(user.id, "ai_gen_lesson", 60, 3_600_000);

    const body = (await req.json().catch(() => null)) as { lessonId?: string } | null;
    const lessonId = body?.lessonId?.trim();
    if (!lessonId) return fail("缺少 lessonId");

    // 内核负责：越权校验 / LLM 生成 / 校验重试 / 降级 / 扣费 / 写库 / genStatus 收尾。
    // 结构性错误（章节不存在 / 越权）以 Error 抛出，这里映射为 4xx。
    let result;
    try {
      result = await generateLessonCore(lessonId, user.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "章节不存在") return fail("章节不存在", 404);
      if (msg === "无权操作该课程") throw new AppError("无权操作该课程", 403);
      throw e; // 其余交由 handle 折叠为 500
    }

    return ok({ lessonId, blocks: result.blocks, allReady: result.allReady });
  });
}
