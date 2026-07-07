import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { readGenProgress, getGenJob, finalizeGenJob, isGenJobStale } from "@/lib/course-gen";

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
    let genStatus = course.genStatus;
    let currentLessonId = progress.currentLessonId;

    // 自愈收尾：后台 after() 在 serverless/重启/超时时可能来不及执行最终 finalize，
    // 导致所有节都 ready 但 Course 仍是 generating。轮询接口是用户正在看的路径，顺手收敛为 ready。
    if (genStatus === "generating" && total > 0 && doneByLessons === total) {
      await prisma.course.update({ where: { id: course.id }, data: { genStatus: "ready" } });
      await finalizeGenJob(course.id, "done");
      genStatus = "ready";
      currentLessonId = null;
    }

    // 僵尸收敛：有空节但 course_gen running 心跳过期，说明后台流水已死。
    // 不继续展示“正在生成”转圈，改为 failed，让前端出现“继续生成”入口。
    if (genStatus === "generating" && doneByLessons < total) {
      const job = await getGenJob(course.id);
      if (job?.status === "running" && isGenJobStale(job)) {
        await prisma.course.update({ where: { id: course.id }, data: { genStatus: "failed" } });
        await finalizeGenJob(course.id, "failed");
        genStatus = "failed";
        currentLessonId = null;
      }
    }

    return ok({
      total,
      done: Math.max(progress.done, doneByLessons),
      failed: progress.failed,
      currentLessonId,
      genStatus,
      lessons,
    });
  });
}
