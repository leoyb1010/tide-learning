import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { track } from "@/lib/analytics";
import { getBalance } from "@/lib/credits";
import { earnFromSale, purchaseCourse, FREE_COLLECT_AUTHOR_BONUS } from "@/lib/credit-trade";

export const dynamic = "force-dynamic";

/**
 * POST /api/market/collect — 从课程集市「拿走 / 购买」一门课（S4 交易闭环 §问题⑪）。
 * 入参：{ courseId }
 *
 * 分支（按课程 priceCredits）：
 *   - 免费课（priceCredits null 或 0）：沿用原免费 fork（建学习起始记录 = 进书架），
 *     并给作者小额创作激励（FREE_COLLECT_AUTHOR_BONUS，走 course_sale_income 流水，鼓励持续供给）。
 *   - 付费课（priceCredits>0）：走 purchaseCourse 事务——买家扣积分、作者入账、建起始记录原子完成；
 *     余额不足返回 402 引导充值；已拥有幂等返回。
 *
 * 校验：
 *   - 登录（requireUser）。
 *   - 该课 sharedStatus="shared"（在集市在售）。
 *   - 非自己造的课（authorUserId !== user.id；自己的课在书架已属造课层）。
 *
 * fork/幂等机制（MVP，不拷贝课程数据）：给买家在该课「第 1 节 lesson」建一条起始
 * LearningProgress（progressSec=0），天然进入「collected」层，进度按 userId 独立。
 * LearningProgress 的 @@unique([userId, lessonId]) 天然给幂等（重复拿走/购买不重复扣款）。
 * 埋点：course_collect（免费）/ course_purchase（付费）。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req); // A2：写操作 CSRF 防护
    const user = await requireUser();
    // 防刷：每小时最多 60 次拿走/购买操作
    assertUserRateLimit(user.id, "market_collect", 60, 3_600_000);

    const body = (await req.json().catch(() => null)) as { courseId?: string } | null;
    const courseId = body?.courseId?.trim();
    if (!courseId) return fail("缺少课程参数");

    // 只允许拿走已上架的课；顺带拿到作者、定价与第 1 节 lesson。
    const course = await prisma.course.findFirst({
      where: { id: courseId, sharedStatus: "shared" },
      select: {
        id: true,
        title: true,
        authorUserId: true,
        priceCredits: true,
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

    const price = course.priceCredits ?? 0;

    // ============ 付费分支：走交易事务（扣款 + 作者入账 + 进书架原子） ============
    if (price > 0) {
      // 作者归属缺失（脏数据）时无法结算收益，拒绝交易（避免扣了买家钱、收益无处入账）。
      if (!course.authorUserId) throw new AppError("该课程缺少作者信息，暂无法购买", 400);

      // 事务外预检余额：不足直接 402 引导充值（事务内还会二次核验防 TOCTOU）。
      const balance = await getBalance(user.id);
      if (balance < price) {
        return fail("积分不足，充值后可购买本课", 402);
      }

      const result = await purchaseCourse({
        buyerId: user.id,
        authorId: course.authorUserId,
        courseId: course.id,
        firstLessonId: firstLesson.id,
        priceCredits: price,
        courseTitle: course.title,
      });

      if (result.status === "already_owned") {
        return ok({
          status: "collected",
          already: true,
          balance: result.balance,
          message: "这门课已在你的书架",
        });
      }

      await track({
        eventName: "course_purchase",
        userId: user.id,
        properties: { courseId: course.id, priceCredits: price, authorUserId: course.authorUserId },
      });

      return ok({
        status: "collected",
        already: false,
        balance: result.balance,
        spent: result.spent,
        message: `已购买《${course.title}》并放进你的书架`,
      });
    }

    // ============ 免费分支：原免费 fork + 作者小额创作激励 ============
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

    // 免费课被拿走：给作者小额创作激励（首次拿走才给，与起始记录同为幂等——上面 create 成功即首次）。
    // 独立于书架落地（earnFromSale 自有事务）：激励发放失败不应阻断用户已成功进书架的主流程，故容错吞掉。
    if (course.authorUserId && FREE_COLLECT_AUTHOR_BONUS > 0) {
      try {
        await earnFromSale(
          course.authorUserId,
          course.id,
          FREE_COLLECT_AUTHOR_BONUS,
          `《${course.title}》被拿走·创作激励`,
        );
      } catch (e) {
        console.error("[market/collect] free collect author bonus failed:", e);
      }
    }

    await track({ eventName: "course_collect", userId: user.id, properties: { courseId: course.id } });

    return ok({ status: "collected", already: false, message: `已把《${course.title}》放进你的书架` });
  });
}
