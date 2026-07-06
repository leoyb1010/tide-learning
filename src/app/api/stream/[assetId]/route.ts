import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement, canAccessLesson } from "@/lib/entitlement";
import { hasPurchasedCourse } from "@/lib/queries";
import { fail, handle } from "@/lib/api";

/**
 * GET /api/stream/:assetId — 受控视频流。
 * 服务端二次校验权益：非订阅用户不能通过接口直接获取付费视频（§6.4 / §19 技术验收）。
 * MVP 返回一段占位说明；真实环境返回 HLS 加密清单或 302 到短时签名 CDN URL。
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  return handle(async () => {
    const { assetId } = await params;
    const exp = Number(req.nextUrl.searchParams.get("exp") ?? 0);
    if (exp && exp < Date.now()) return fail("链接已过期，请刷新页面", 403);

    const lesson = await prisma.lesson.findFirst({ where: { videoAssetId: assetId }, include: { course: { select: { id: true, category: true } } } });
    if (!lesson) return fail("资源不存在", 404);

    const user = await getCurrentUser();
    const snapshot = await resolveEntitlement(user?.id ?? null);
    // 买断放行：已购本课（CoursePurchase 所有权真值源）则受控流放行，不走赛道订阅门（修 P0 买断失能）。
    const owned = await hasPurchasedCourse(lesson.course.id, user?.id ?? null);
    if (!canAccessLesson(lesson.course.category, lesson.isFree, snapshot, owned)) {
      return fail("无权访问该资源，请先订阅", 403);
    }

    // 占位：真实实现返回加密 m3u8。此处回显签名有效的 mock 流地址（NextResponse 兼容流/重定向语义）。
    return new NextResponse(
      JSON.stringify({
        ok: true,
        assetId,
        kind: "mock-hls",
        note: "受控视频流占位：已通过服务端权益校验。真实环境返回 HLS 加密清单 + 动态水印。",
        expiresAt: exp || null,
      }),
      { headers: { "content-type": "application/json", "cache-control": "private, max-age=0" } },
    );
  });
}
