import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, getCurrentUser } from "@/lib/session";
import { getLessonForUser } from "@/lib/queries";
import { track } from "@/lib/analytics";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";

// 进度上限：约 24 小时（秒）。翻页 index 同用此上限，实际远小于此，只为挡住溢出/脏数据。
const MAX_PROGRESS = 24 * 60 * 60;

// POST /api/progress — 记录学习进度（§18.3）
export async function POST(req: NextRequest) {
  return handle(async () => {
    // P2 写门：补同源校验（对 Bearer/native 放行）
    assertSameOrigin(req);
    const user = await requireUser();
    const { lessonId, progressSec, completed, kind } = (await req.json()) as {
      lessonId: string;
      progressSec: number;
      completed?: boolean;
      // 进度语义区分：video（默认，秒数锚点）/ slide（翻页课件的「已读到第几页」，1-indexed）。
      // 两者落在不同字段，块课翻页与视频播放的续读锚点互不覆盖。
      kind?: "video" | "slide";
    };

    // P3 数值校验：progressSec 必须是有限数，clamp 到 [0, MAX_PROGRESS]，挡住 NaN/负数/溢出脏写。
    if (!Number.isFinite(progressSec)) return fail("进度数值非法");
    const safeProgress = Math.min(Math.max(0, Math.floor(progressSec)), MAX_PROGRESS);

    // P2 归属+付费双门：getLessonForUser 已内置 canViewCourse（他人私有课视为不存在→null）
    // 与 canAccessLesson（付费节需订阅→access）。null 即无权可见，403。
    const view = await getLessonForUser(lessonId, user.id);
    if (!view) return fail("无权访问该课程", 403);

    // 翻页进度写 lastSlideIndex，视频/模拟播放进度写 progressSec；二者隔离，互不污染另一视图的续读点。
    const isSlide = kind === "slide";
    // completed 仅在有访问权（付费门通过）时才允许置真：防止无权用户对付费节标记完成。
    const canComplete = completed === true && view.access;

    await prisma.learningProgress.upsert({
      where: { userId_lessonId: { userId: user.id, lessonId } },
      create: {
        userId: user.id,
        courseId: view.course.id,
        lessonId,
        progressSec: isSlide ? 0 : safeProgress,
        lastSlideIndex: isSlide ? safeProgress : null,
        completedAt: canComplete ? new Date() : null,
      },
      update: {
        ...(isSlide ? { lastSlideIndex: safeProgress } : { progressSec: safeProgress }),
        lastPlayedAt: new Date(),
        ...(canComplete ? { completedAt: new Date() } : {}),
      },
    });
    await track({
      eventName: canComplete ? "lesson_complete" : "lesson_progress",
      userId: user.id,
      properties: { course_id: view.course.id, lesson_id: lessonId, progress_sec: safeProgress, kind: isSlide ? "slide" : "video" },
    });
    return ok({ saved: true });
  });
}

// GET /api/progress/me
export async function GET() {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return ok({ progress: [] });
    const progress = await prisma.learningProgress.findMany({
      where: { userId: user.id },
      include: { course: true, lesson: true },
      orderBy: { lastPlayedAt: "desc" },
    });
    return ok({ progress });
  });
}
