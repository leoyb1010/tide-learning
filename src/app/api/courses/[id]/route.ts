import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCourseDetail } from "@/lib/queries";
import { getCurrentUser, requireUser } from "@/lib/session";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { assertUserRateLimit } from "@/lib/rate-limit";

// GET /api/courses/:id
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const user = await getCurrentUser();
    const detail = await getCourseDetail(id, user?.id ?? null);
    if (!detail) return fail("课程不存在", 404);
    return ok(detail);
  });
}

/**
 * DELETE /api/courses/:id —— 删除自己的课(2026-07-21 补齐:此前全站没有任何删课能力)。
 *
 * 背景:造课剧场的「放弃这门课」只重置前端 state,课在库里永远停在 outline_draft;
 * 「我的课」也没有删除入口 → 废弃草稿越堆越多,还会挤占大纲检查点入口(见 B1)。
 *
 * 安全边界(宁可拒绝也不误删):
 * - 必须本人的课(authorUserId === user.id);
 * - 只允许删「未成品/自建」:outline_draft / failed / user_created。已 ready 的 AI 课不在此列,
 *   避免一键抹掉学员正在学的内容;
 * - 已上架/待审集市、已被购买、有他人学习记录的一律拒绝——涉及他人权益。
 * 级联删除由 schema 的 onDelete 承担;课内导入源对应的素材文件另行清理(尽力而为,失败不阻断)。
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    assertUserRateLimit(user.id, "course_delete", 30, 3_600_000);
    const { id } = await params;

    const course = await prisma.course.findUnique({
      where: { id },
      select: { id: true, authorUserId: true, genStatus: true, origin: true, sharedStatus: true },
    });
    if (!course) return fail("课程不存在", 404);
    if (course.authorUserId !== user.id) throw new AppError("无权删除该课程", 403);

    const deletable =
      course.origin === "user_created" || course.genStatus === "outline_draft" || course.genStatus === "failed";
    if (!deletable) return fail("已生成完成的课程暂不支持直接删除", 409);
    if (course.sharedStatus === "shared" || course.sharedStatus === "pending") {
      return fail("已分享到集市的课程不能删除，请先取消分享", 409);
    }
    const purchased = await prisma.coursePurchase.count({ where: { courseId: id } });
    if (purchased > 0) return fail("已有用户购买该课程，不能删除", 409);
    const othersLearning = await prisma.learningProgress.count({
      where: { lesson: { courseId: id }, userId: { not: user.id } },
    });
    if (othersLearning > 0) return fail("已有其他用户在学该课程，不能删除", 409);

    await prisma.course.delete({ where: { id } });
    return ok({ deleted: true, id });
  });
}
