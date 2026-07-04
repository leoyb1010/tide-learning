import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { track } from "@/lib/analytics";

export const dynamic = "force-dynamic";

/**
 * POST /api/market/collect — 从课程集市「拿走」一门课（免费 fork 引用）。
 * 入参：{ courseId }
 *
 * 校验：
 *   - 登录（requireUser）。
 *   - 该课 sharedStatus="shared"（在集市在售）。
 *   - 非自己造的课（authorUserId !== user.id；自己的课在书架已属造课层，无需拿走）。
 *
 * fork 机制（MVP，不拷贝课程数据）：给该用户在该课「第 1 节 lesson」建一条起始
 * LearningProgress（progressSec=0）。这样它天然进入用户书架的 "collected" 层，
 * 进度按 userId 独立。选此方案而非新建 CourseCollection 表的理由：
 *   1) 零迁移、零新表，最简可靠；
 *   2) LearningProgress 的 @@unique([userId, lessonId]) 天然给幂等（重复拿走 = upsert 命中）；
 *   3) getMyShelf 本就读 LearningProgress 派生进度，"collected" 从同一份数据落出，无额外 join；
 *   4) 「谁拿走了这门课」的信号与「谁在学这门课」是同一份，避免两处冗余不一致。
 * 幂等：已拿走（起始记录已存在）则提示「已在你的书架」，不重复埋点。
 * 埋点：course_collect。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req); // A2：写操作 CSRF 防护
    const user = await requireUser();
    // 防刷：每小时最多 60 次拿走操作
    assertUserRateLimit(user.id, "market_collect", 60, 3_600_000);

    const body = (await req.json().catch(() => null)) as { courseId?: string } | null;
    const courseId = body?.courseId?.trim();
    if (!courseId) return fail("缺少课程参数");

    // 只允许拿走已上架的课；顺带拿到作者与第 1 节 lesson。
    const course = await prisma.course.findFirst({
      where: { id: courseId, sharedStatus: "shared" },
      select: {
        id: true,
        title: true,
        authorUserId: true,
        lessons: {
          orderBy: { sortOrder: "asc" },
          take: 1,
          select: { id: true },
        },
      },
    });
    if (!course) throw new AppError("课程不存在或未在集市展示", 404);
    if (course.authorUserId === user.id) return fail("这是你自己的课，已在你的书架");

    const firstLesson = course.lessons[0];
    if (!firstLesson) throw new AppError("该课程还没有可学习的章节", 400);

    // 幂等判断：起始记录（第 1 节 LearningProgress）是否已存在。
    const existing = await prisma.learningProgress.findUnique({
      where: { userId_lessonId: { userId: user.id, lessonId: firstLesson.id } },
      select: { id: true },
    });
    if (existing) {
      return ok({ status: "collected", already: true, message: "这门课已在你的书架" });
    }

    // 建起始记录（progressSec=0）。并发下唯一约束兜底：竞争失败也视作已拿走。
    try {
      await prisma.learningProgress.create({
        data: { userId: user.id, courseId: course.id, lessonId: firstLesson.id, progressSec: 0 },
      });
    } catch {
      return ok({ status: "collected", already: true, message: "这门课已在你的书架" });
    }

    await track({ eventName: "course_collect", userId: user.id, properties: { courseId: course.id } });

    return ok({ status: "collected", already: false, message: `已把《${course.title}》放进你的书架` });
  });
}
