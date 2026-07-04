import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, getCurrentUser } from "@/lib/session";
import { track } from "@/lib/analytics";
import { ok, handle } from "@/lib/api";

// POST /api/progress — 记录学习进度（§18.3）
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const { lessonId, progressSec, completed, kind } = (await req.json()) as {
      lessonId: string;
      progressSec: number;
      completed?: boolean;
      // 进度语义区分：video（默认，秒数锚点）/ slide（翻页课件的「已读到第几页」，1-indexed）。
      // 两者落在不同字段，块课翻页与视频播放的续读锚点互不覆盖。
      kind?: "video" | "slide";
    };
    const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson) return ok({ saved: false });

    // 翻页进度写 lastSlideIndex，视频/模拟播放进度写 progressSec；二者隔离，互不污染另一视图的续读点。
    const isSlide = kind === "slide";

    await prisma.learningProgress.upsert({
      where: { userId_lessonId: { userId: user.id, lessonId } },
      create: {
        userId: user.id,
        courseId: lesson.courseId,
        lessonId,
        progressSec: isSlide ? 0 : progressSec,
        lastSlideIndex: isSlide ? progressSec : null,
        completedAt: completed ? new Date() : null,
      },
      update: {
        ...(isSlide ? { lastSlideIndex: progressSec } : { progressSec }),
        lastPlayedAt: new Date(),
        ...(completed ? { completedAt: new Date() } : {}),
      },
    });
    await track({
      eventName: completed ? "lesson_complete" : "lesson_progress",
      userId: user.id,
      properties: { course_id: lesson.courseId, lesson_id: lessonId, progress_sec: progressSec, kind: isSlide ? "slide" : "video" },
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
