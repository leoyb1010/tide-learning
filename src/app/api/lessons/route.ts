import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { track } from "@/lib/analytics";
import { claimCourseContentMutation } from "@/lib/course-gen";

/** POST /api/lessons：给自己的课程增加一节空白画布，不调用 AI。 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    assertUserRateLimit(user.id, "lesson_manual_create", 120, 3_600_000);
    const body = (await req.json().catch(() => null)) as {
      courseId?: string;
      title?: string;
      summary?: string;
    } | null;
    const courseId = body?.courseId?.trim();
    const title = body?.title?.trim().slice(0, 120);
    if (!courseId) return fail("缺少 courseId");
    if (!title) return fail("请填写章节标题");
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, authorUserId: true, status: true, genStatus: true, presentationRevision: true },
    });
    if (!course) return fail("课程不存在", 404);
    if (course.authorUserId !== user.id) throw new AppError("无权操作该课程", 403);
    if (course.status === "archived") return fail("已归档课程不能新增课节", 409);
    const lesson = await prisma.$transaction(async (tx) => {
      await claimCourseContentMutation(tx, {
        courseId,
        expectedPresentationRevision: course.presentationRevision,
      });
      const max = await tx.lesson.aggregate({ where: { courseId }, _max: { sortOrder: true } });
      const created = await tx.lesson.create({
        data: {
          courseId,
          title,
          summary: body?.summary?.trim().slice(0, 300) || null,
          sortOrder: (max._max.sortOrder ?? -1) + 1,
          contentType: "ai_block",
          blocksJson: JSON.stringify({ version: 1, blocks: [] }),
          durationSec: 0,
          isFree: (max._max.sortOrder ?? -1) < 0,
          status: "published",
          publishedAt: new Date(),
        },
        select: { id: true, courseId: true, title: true, summary: true, sortOrder: true, blocksJson: true },
      });
      return created;
    });
    await track({ eventName: "lesson_manual_create", userId: user.id, properties: { courseId, lessonId: lesson.id } });
    return ok({ lesson });
  });
}
