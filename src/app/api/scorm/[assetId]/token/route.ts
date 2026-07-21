import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ok, handle } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { canViewCourse, hasPurchasedCourse } from "@/lib/queries";
import { mintScormToken } from "@/lib/scorm-token";

export const dynamic = "force-dynamic";

/**
 * GET /api/scorm/:assetId/token —— SCORM 播放发号端(2026-07-21 审查 M1/P0 修复)。
 *
 * 背景:课件 iframe 是 sandbox 不透明源,包内子资源请求带不上 SameSite=strict 会话 cookie,
 * 多文件 SCORM 包(Articulate/Captivate 均是)的 js/css 全 401 → 白屏。
 * 方案:这里用 cookie 会话跑**完整权益链**(登录 + 课程可见性/已购),通过则发一枚 2h 签名 token;
 * 前端把 token 作为路径段拼进 iframe src,包内相对引用解析时天然继承该段,免 cookie 即可鉴权。
 * 静态段 "token" 优先于 [...path] 捕获,包内若真有名为 token 的根文件会被遮蔽(实际不存在此命名习惯)。
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    assertUserRateLimit(user.id, "scorm_token", 60, 3_600_000);
    const { assetId } = await params;
    const source = await prisma.importedSource.findFirst({
      where: { assetId, generatedCourseId: { not: null } },
      select: { userId: true, generatedCourseId: true },
    });
    if (!source?.generatedCourseId) return NextResponse.json({ ok: false, error: "资源不存在" }, { status: 404 });
    const course = await prisma.course.findUnique({
      where: { id: source.generatedCourseId },
      select: { id: true, authorUserId: true, visibility: true, sharedStatus: true },
    });
    if (!course) return NextResponse.json({ ok: false, error: "课程不存在" }, { status: 404 });
    const owned = await hasPurchasedCourse(course.id, user.id);
    if (!canViewCourse(course, user.id, owned)) return NextResponse.json({ ok: false, error: "无权访问" }, { status: 403 });
    const asset = await prisma.asset.findFirst({ where: { id: assetId, userId: source.userId, kind: "scorm" }, select: { id: true } });
    if (!asset) return NextResponse.json({ ok: false, error: "资源不存在" }, { status: 404 });
    return ok({ token: mintScormToken(assetId) });
  });
}
