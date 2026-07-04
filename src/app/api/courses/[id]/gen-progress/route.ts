import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { readGenProgress } from "@/lib/course-gen";

export const dynamic = "force-dynamic";

/**
 * GET /api/courses/:id/gen-progress —— 断点续造进度查询（供前端轮询恢复剧场）。
 *
 * 越权铁律：requireUser + 只能查自己作为 author 的课（authorUserId===user.id）。
 * 返回 {total, done, failed, currentLessonId, genStatus, lessons:[{id,title,ready}]}。
 * 进度来自课级 GenerationJob（course_gen）快照，lessons.ready 以 blocksJson 是否已生成为准。
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const user = await requireUser();

    const course = await prisma.course.findUnique({
      where: { id },
      select: { id: true, authorUserId: true, genStatus: true },
    });
    if (!course) return fail("课程不存在", 404);
    // 只能查自己的课（越权铁律）：官方课 authorUserId 为 null，也一并拒绝。
    if (course.authorUserId !== user.id) throw new AppError("无权查看该课程", 403);

    const [progress, lessonRows] = await Promise.all([
      readGenProgress(course.id),
      prisma.lesson.findMany({
        where: { courseId: course.id },
        orderBy: { sortOrder: "asc" },
        select: { id: true, title: true, blocksJson: true },
      }),
    ]);

    const lessons = lessonRows.map((l) => ({
      id: l.id,
      title: l.title,
      ready: l.blocksJson != null,
    }));

    // total 以实际 lesson 数为准（job 快照可能落后），保证前端进度条分母稳定。
    const total = lessons.length;
    const doneByLessons = lessons.filter((l) => l.ready).length;

    return ok({
      total,
      done: Math.max(progress.done, doneByLessons),
      failed: progress.failed,
      currentLessonId: progress.currentLessonId,
      genStatus: course.genStatus,
      lessons,
    });
  });
}
