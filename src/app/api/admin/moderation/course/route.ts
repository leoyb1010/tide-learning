import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";

// POST /api/admin/moderation/course — 审核课程集市分享申请（内容审核台）。
// body: { courseId, action: "approve" | "reject", reason? }
// approve → sharedStatus=shared；reject → sharedStatus=rejected。
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req); // A2：写操作 CSRF 防护
    const admin = await requirePermission("demand:moderate");

    const body = (await req.json()) as {
      courseId?: string;
      action?: "approve" | "reject";
      reason?: string;
    };
    const courseId = body.courseId?.trim();
    if (!courseId) return fail("缺少 courseId");
    if (body.action !== "approve" && body.action !== "reject") return fail("非法操作类型");

    const reason = body.reason?.trim();
    if (body.action === "reject" && !reason) return fail("拒绝时必须填写理由");

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, sharedStatus: true, authorUserId: true, title: true },
    });
    if (!course) throw new AppError("课程不存在", 404);
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
