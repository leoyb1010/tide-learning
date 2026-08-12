import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { resolvePresentationStatus } from "@/lib/gen-progress-contract";
import {
  assessCoursePresentation,
  readGenProgress,
  isLessonGenerationReady,
  summarizeCourseGenerationReadiness,
} from "@/lib/course-gen";

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
      select: {
        id: true,
        title: true,
        category: true,
        template: true,
        designJson: true,
        authorUserId: true,
        genStatus: true,
      },
    });
    if (!course) return fail("课程不存在", 404);
    // 只能查自己的课（越权铁律）：官方课 authorUserId 为 null，也一并拒绝。
    if (course.authorUserId !== user.id) throw new AppError("无权查看该课程", 403);

    const [progress, lessonRows] = await Promise.all([
      readGenProgress(course.id),
      prisma.lesson.findMany({
        where: { courseId: course.id },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          title: true,
          blocksJson: true,
          qualityJson: true,
          htmlJson: true,
          renderSourceHash: true,
          renderEngine: true,
          designJson: true,
        },
      }),
    ]);

    const readiness = summarizeCourseGenerationReadiness(lessonRows);
    const presentation = assessCoursePresentation({ ...course, lessons: lessonRows });
    const lessons = lessonRows.map((l) => ({
      id: l.id,
      title: l.title,
      ready: isLessonGenerationReady(l),
    }));

    // total 以实际 lesson 数为准（job 快照可能落后），保证前端进度条分母稳定。
    const total = lessons.length;
    const doneByLessons = lessons.filter((l) => l.ready).length;
    const blocksDone = lessonRows.filter((lesson) => lesson.blocksJson != null).length;
    // GET 严格只读：不在轮询路径启动付费 coverage/HTML，也不凭 JSON 心跳改终态。
    // 进程恢复由 generation-worker 经原子 lease acquire 接管。
    const genStatus = course.genStatus;
    const currentLessonId = progress.currentLessonId;
    // 表现层只在整课 ready 后才对外宣布 premium / degraded。
    // 动态发布门若发现缺 HTML、旧 sourceHash 或无效 contract，则显式 incomplete；
    // 生成中不把阶段性的确定性渲染误报为降级成稿。
    const presentationStatus = resolvePresentationStatus(genStatus, presentation);

    return ok({
      total,
      done: doneByLessons,
      failed: Math.max(progress.failed, readiness.qualityFailures, total - doneByLessons - (total - blocksDone)),
      currentLessonId,
      genStatus,
      presentationStatus,
      presentation: {
        degraded: presentation.degraded,
        ready: presentation.ready,
        total: presentation.total,
        premiumRenderCount: presentation.premiumRenderCount,
        deterministicRenderCount: presentation.deterministicRenderCount,
      },
      lessons,
    });
  });
}
