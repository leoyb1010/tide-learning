import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { track } from "@/lib/analytics";

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
      select: { id: true, authorUserId: true },
    });
    if (!course) return fail("课程不存在", 404);
    if (course.authorUserId !== user.id) throw new AppError("无权操作该课程", 403);
    const max = await prisma.lesson.aggregate({ where: { courseId }, _max: { sortOrder: true } });
    const lesson = await prisma.lesson.create({
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
    await prisma.course.update({ where: { id: courseId }, data: { lastUpdatedAt: new Date() } });
    await track({ eventName: "lesson_manual_create", userId: user.id, properties: { courseId, lessonId: lesson.id } });
    return ok({ lesson });
  });
}
