import { NextRequest } from "next/server";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { resolveEntitlement } from "@/lib/entitlement";
import { assertCanSpend } from "@/lib/credits";
import { generateLessonVideo } from "@/lib/video-gen";

export const dynamic = "force-dynamic";

/**
 * POST /api/ai/generate-video —— AI 自习室 · 把一节块课件生成为视频课件（v3.1）。
 *
 * 框架 + mock：接收 lessonId，越权校验后把该节 blocks 组织成视频脚本，标记 videoGenStatus，
 * 走 VIDEO_MODE=mock 开关由 mock provider 就绪占位视频（真实文生视频/数字人模型按 provider
 * 接口后补，见 src/lib/video-gen.ts）。
 *
 * 本 route 只保留请求级闸门（同源 / 登录 / 权益 / 余额预检 / 限流）与结构性错误映射；
 * 生成/脚本/幂等/收尾核心在 generateLessonVideo。
 * 权益：需 canUseLLM（AI 能力订阅专享）。限流：每用户每小时 30 节。
 * 越权铁律：lessonId 必须属于自己 author 的课（在内核里按 authorUserId 校验）。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();

    // 权益闸门：AI 能力需订阅
    const snapshot = await resolveEntitlement(user.id);
    if (!snapshot.canUseLLM) throw new AppError("AI 功能需订阅后使用", 402);

    // 积分预检：余额不足抛 402（视频生成为高成本能力，与造课一致先设门槛）
    await assertCanSpend(user.id);

    // 限流：每用户每小时 30 节视频
    assertUserRateLimit(user.id, "ai_gen_video", 30, 3_600_000);

    const body = (await req.json().catch(() => null)) as { lessonId?: string } | null;
    const lessonId = body?.lessonId?.trim();
    if (!lessonId) return fail("缺少 lessonId");

    // 内核负责：越权校验 / 课件前置 / 脚本组织 / claim 幂等 / provider 生成 / 收尾。
    // 结构性错误（章节不存在 / 越权 / 课件未就绪）以 Error 抛出，这里映射为 4xx。
    let result;
    try {
      result = await generateLessonVideo(lessonId, user.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "章节不存在") return fail("章节不存在", 404);
      if (msg === "无权操作该课程") throw new AppError("无权操作该课程", 403);
      if (msg === "章节课件未就绪") return fail("请先完成课件生成，再生成视频", 409);
      throw e; // 其余交由 handle 折叠为 500
    }

    return ok({
      lessonId,
      status: result.status,
      assetId: result.assetId,
      scenes: result.scenes,
      provider: result.provider,
    });
  });
}
