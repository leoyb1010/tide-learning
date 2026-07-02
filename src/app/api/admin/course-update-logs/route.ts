import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { audit } from "@/lib/audit";
import { ok, fail, handle } from "@/lib/api";

// POST /api/admin/course-update-logs — 新增更新日志（§6.3 五要素）
export async function POST(req: NextRequest) {
  return handle(async () => {
    const admin = await requireAdmin();
    const body = (await req.json()) as {
      courseId: string;
      lessonId?: string;
      updateType: string;
      title: string;
      description?: string;
    };
    if (!body.courseId || !body.title?.trim()) return fail("请填写课程和更新标题");
    const log = await prisma.courseUpdateLog.create({
      data: {
        courseId: body.courseId,
        lessonId: body.lessonId ?? null,
        updateType: body.updateType ?? "added",
        title: body.title.trim(),
        description: body.description,
        ownerId: admin.id,
      },
    });
    await prisma.course.update({ where: { id: body.courseId }, data: { lastUpdatedAt: new Date() } });
    await audit({ operatorId: admin.id, action: "update_log.create", targetType: "course", targetId: body.courseId, detail: body.title });
    return ok(log);
  });
}
