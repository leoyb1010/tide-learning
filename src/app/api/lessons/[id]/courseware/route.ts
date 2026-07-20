import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement, canAccessLesson } from "@/lib/entitlement";
import { canViewCourse, hasPurchasedCourse } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/lessons/:id/courseware —— 课件「独立同源文档」承载(2026-07-20 空白根因根治)。
 *
 * 根因:课件此前用 `<iframe srcDoc>` 渲染,而 srcdoc/blob 等本地 scheme 文档**继承父页 CSP**
 * (`script-src 'self' 'nonce-…'`)。Next 软导航下页面拿到的是本次 RSC 请求的新 nonce,文档级 CSP
 * 却仍是首次整页加载的旧 nonce → 注入的 nonce 恒错配 → 课件内联运行时被拦 → 渐显文字全停在
 * opacity:0 → 「只有背景色」。(公网双引擎已决定性复现:整页直达绿、站内点击必空白。)
 *
 * 根治:课件改由本路由以**网络 scheme 文档**返回——网络文档不继承父页 CSP,由本响应自带的
 * CSP 头(与课件内部 meta CSP 同款:default-src 'none' + 仅内联脚本/样式 + connect-src 'none')
 * 独立约束。父页 CSP 保持严格不放松;iframe 端 sandbox="allow-scripts" 铁律不变(不透明源,
 * 拿不到父页权限,postMessage 协议校验 event.source 不受影响)。整类 nonce 问题就此铲除。
 *
 * 鉴权:与 learn 页完全同规则——canViewCourse(存在性/私有课越权) + canAccessLesson(isFree/买断/订阅)。
 * 免费节允许匿名(保住 /preview 免登录试读)。不满足一律 404(不区分 401/403,不泄露课程存在性)。
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const notFound = () => new NextResponse("Not Found", { status: 404, headers: { "cache-control": "private, no-store" } });

  try {
    const lesson = await prisma.lesson.findUnique({
      where: { id },
      select: {
        htmlJson: true,
        isFree: true,
        status: true,
        course: { select: { id: true, category: true, visibility: true, authorUserId: true, sharedStatus: true, status: true } },
      },
    });
    if (!lesson || !lesson.course || lesson.status !== "published" || !lesson.htmlJson) return notFound();

    const user = await getCurrentUser();
    const userId = user?.id ?? null;
    const owned = await hasPurchasedCourse(lesson.course.id, userId);
    if (!canViewCourse(lesson.course, userId, owned)) return notFound();
    const snapshot = await resolveEntitlement(userId);
    if (!canAccessLesson(lesson.course.category, lesson.isFree, snapshot, owned)) return notFound();

    let html = "";
    try {
      html = (JSON.parse(lesson.htmlJson) as { html?: string }).html ?? "";
    } catch {
      return notFound();
    }
    if (!html) return notFound();

    return new NextResponse(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        // 本文档自己的 CSP(仅作用于课件):与课件内部 meta CSP 同款,双保险。
        // frame-ancestors 'self':只允许本站嵌入,防外站盗链嵌框。
        "content-security-policy":
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
          "img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
        "x-content-type-options": "nosniff",
        // 私有内容不落共享缓存;htmlJson 重渲后立即生效。
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return notFound();
  }
}
