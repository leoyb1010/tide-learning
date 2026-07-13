import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { audit } from "@/lib/audit";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";

// POST /api/admin/course-update-logs — 新增更新日志（§6.3 五要素）
export async function POST(req: NextRequest) {
  return handle(async () => {
    const admin = await requirePermission("course:write");
    assertSameOrigin(req);
    const body = (await req.json()) as {
      courseId: string;
      lessonId?: string;
      updateType: string;
      title: string;
      description?: string;
    };
    if (!body.courseId || !body.title?.trim()) return fail("请填写课程和更新标题");
    const log = await prisma.$transaction(async (tx) => {
      const course = await tx.course.findUnique({ where: { id: body.courseId }, select: { title: true, category: true } });
      if (!course) throw new AppError("课程不存在", 404);
      const [learners, purchasers, subscribers] = await Promise.all([
        tx.learningProgress.findMany({ where: { courseId: body.courseId }, distinct: ["userId"], select: { userId: true } }),
        tx.coursePurchase.findMany({ where: { courseId: body.courseId }, select: { userId: true } }),
        tx.subscription.findMany({
          where: { status: { in: ["active", "trial", "grace_period", "canceled_but_active"] }, scope: { in: ["all", course.category] } },
          distinct: ["userId"],
          select: { userId: true },
        }),
      ]);
      const created = await tx.courseUpdateLog.create({
        data: { courseId: body.courseId, lessonId: body.lessonId ?? null, updateType: body.updateType ?? "added", title: body.title.trim(), description: body.description, ownerId: admin.id },
      });
      await tx.course.update({ where: { id: body.courseId }, data: { lastUpdatedAt: new Date() } });
      const recipientIds = new Set([...learners, ...purchasers, ...subscribers].map((r) => r.userId));
      if (recipientIds.size) await tx.notification.createMany({
        data: [...recipientIds].map((userId) => ({ userId, type: "course_update", title: `《${course.title}》有新更新`, body: body.title.trim(), refType: "course", refId: body.courseId })),
      });
      return created;
    });
    await audit({ operatorId: admin.id, action: "update_log.create", targetType: "course", targetId: body.courseId, detail: body.title });
    return ok(log);
  });
}
