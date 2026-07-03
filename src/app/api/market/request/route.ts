import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { notify } from "@/lib/notify";
import { track } from "@/lib/analytics";

export const dynamic = "force-dynamic";

/**
 * POST /api/market/request — 申请学习集市里的某门课。
 * 入参：{ courseId, message? }
 * 规则：
 *   - 课程必须已上架（sharedStatus="shared"）。
 *   - 不能申请自己的课（作者本人无需申请）。
 *   - 防重复：CourseAccessRequest 有 @@unique([courseId, requesterId])，同一人对同一课只能申请一次。
 * 成功后建 pending 申请（requesterId=user.id, ownerId=课程作者），并 notify 作者。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req); // A2：写操作 CSRF 防护
    const user = await requireUser();
    // 防刷：每小时最多 30 次申请
    assertUserRateLimit(user.id, "market_request", 30, 3_600_000);

    const body = (await req.json().catch(() => null)) as { courseId?: string; message?: string } | null;
    const courseId = body?.courseId?.trim();
    if (!courseId) return fail("缺少课程参数");
    const message = body?.message?.trim().slice(0, 200) || undefined;

    // 只允许申请已上架的课；顺带拿到作者 ownerId。
    const course = await prisma.course.findFirst({
      where: { id: courseId, sharedStatus: "shared" },
      select: { id: true, title: true, authorUserId: true },
    });
    if (!course || !course.authorUserId) throw new AppError("课程不存在或未在集市展示", 404);

    const ownerId = course.authorUserId;
    if (ownerId === user.id) return fail("这是你自己的课，无需申请");

    // 防重复申请（先查一次给出友好文案；真正的原子约束是 @@unique）。
    const existing = await prisma.courseAccessRequest.findUnique({
      where: { courseId_requesterId: { courseId: course.id, requesterId: user.id } },
      select: { status: true },
    });
    if (existing) {
      const label = existing.status === "approved" ? "已获得学习权" : existing.status === "rejected" ? "上次申请未通过" : "申请审核中";
      return ok({ status: existing.status, message: `你${label}，无需重复申请` });
    }

    let request;
    try {
      request = await prisma.courseAccessRequest.create({
        data: { courseId: course.id, requesterId: user.id, ownerId, status: "pending", message: message ?? null },
        select: { id: true },
      });
    } catch {
      // 并发下唯一约束兜底（两次点击竞争）
      return ok({ status: "pending", message: "申请已提交，等待作者批准" });
    }

    // 通知课程作者（失败静默，不阻断主流程）
    await notify({
      userId: ownerId,
      type: "access_request",
      title: `有人申请学习你的课《${course.title}》`,
      body: message,
      refType: "request",
      refId: request.id,
    });
    await track({ eventName: "market_request", userId: user.id, properties: { courseId: course.id, requestId: request.id } });

    return ok({ status: "pending", message: "申请已提交，等待作者批准", requestId: request.id });
  });
}
