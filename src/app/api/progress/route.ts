import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, getCurrentUser } from "@/lib/session";
import { track } from "@/lib/analytics";
import { ok, handle } from "@/lib/api";

// POST /api/progress — 记录学习进度（§18.3）
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const { lessonId, progressSec, completed } = (await req.json()) as {
      lessonId: string;
      progressSec: number;
      completed?: boolean;
    };
    const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson) return ok({ saved: false });

    await prisma.learningProgress.upsert({
      where: { userId_lessonId: { userId: user.id, lessonId } },
      create: {
        userId: user.id,
        courseId: lesson.courseId,
        lessonId,
        progressSec,
        completedAt: completed ? new Date() : null,
      },
      update: {
        progressSec,
        lastPlayedAt: new Date(),
        ...(completed ? { completedAt: new Date() } : {}),
      },
    });
    await track({
      eventName: completed ? "lesson_complete" : "lesson_progress",
      userId: user.id,
      properties: { course_id: lesson.courseId, lesson_id: lessonId, progress_sec: progressSec },
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
