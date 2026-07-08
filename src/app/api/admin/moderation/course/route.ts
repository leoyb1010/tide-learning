import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";

// POST /api/admin/moderation/course — 审核课程集市分享申请 / 强制下架（内容审核台）。
// body: { courseId, action: "approve" | "reject" | "unshare", reason? }
// approve → sharedStatus=shared；reject → sharedStatus=rejected（两者仅对 pending 课）；
// unshare → 把已上架（shared）课强制置 private 并通知作者（reason 必填）。已购者权益不受影响。
// 权限：content:review——课程集市待审属「内容审核台」（/admin/moderation, gate=content:review）的工作，
// 与同台的帖子审核（moderation/post）一致。此前误用 demand:moderate（那是需求广场审核的权限），
// 导致能进审核台的 reviewer 无权执行课程审核、而有 demand:moderate 的 demand_moderator 又进不了页面——
// page/nav/API 三处权限对齐后，reviewer 可完整处理课程集市审核闭环（审计 P1-new-1）。
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req); // A2：写操作 CSRF 防护
    const admin = await requirePermission("content:review");

    const body = (await req.json()) as {
      courseId?: string;
      action?: "approve" | "reject" | "unshare";
      reason?: string;
    };
    const courseId = body.courseId?.trim();
    if (!courseId) return fail("缺少 courseId");
    if (body.action !== "approve" && body.action !== "reject" && body.action !== "unshare")
      return fail("非法操作类型");

    const reason = body.reason?.trim();
    if (body.action === "reject" && !reason) return fail("拒绝时必须填写理由");
    if (body.action === "unshare" && !reason) return fail("强制下架必须填写理由");

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, sharedStatus: true, authorUserId: true, title: true },
    });
    if (!course) throw new AppError("课程不存在", 404);

    // —— unshare：强制下架已上架课（保留 priceCredits；已购者权益由 CoursePurchase 保障，不动）——
    if (body.action === "unshare") {
      if (course.sharedStatus !== "shared") throw new AppError("该课程当前未在集市上架", 409);
      await prisma.course.update({
        where: { id: courseId },
        data: { sharedStatus: "private" },
      });
      await audit({
        operatorId: admin.id,
        action: "course_moderate",
        targetType: "course",
        targetId: courseId,
        detail: `强制下架：${reason}`,
      });
      // 通知作者课程已被平台下架（失败静默）。
      if (course.authorUserId) {
        await notify({
          userId: course.authorUserId,
          type: "system",
          title: `《${course.title}》已被平台下架`,
          body: `你的课程已被平台从集市下架。原因：${reason}`,
          refType: "course",
          refId: courseId,
        });
      }
      return ok({ id: courseId, sharedStatus: "private" });
    }

    if (course.sharedStatus !== "pending") throw new AppError("该课程已被处理", 409);

    const nextStatus = body.action === "approve" ? "shared" : "rejected";
    await prisma.course.update({
      where: { id: courseId },
      data: { sharedStatus: nextStatus, lastUpdatedAt: new Date() },
    });

    await audit({
      operatorId: admin.id,
      action: "course_moderate",
      targetType: "course",
      targetId: courseId,
      detail: body.action === "reject" ? `拒绝分享：${reason}` : "批准上架集市",
    });

    // 通知作者审核结果（失败静默）。
    if (course.authorUserId) {
      await notify({
        userId: course.authorUserId,
        type: "system",
        title:
          body.action === "approve"
            ? `《${course.title}》已上架课程集市`
            : `《${course.title}》分享申请未通过`,
        body: body.action === "reject" ? reason : undefined,
        refType: "course",
        refId: courseId,
      });
    }

    return ok({ id: courseId, sharedStatus: nextStatus });
  });
}
