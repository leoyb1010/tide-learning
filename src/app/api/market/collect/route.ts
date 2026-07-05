import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { track } from "@/lib/analytics";
import { ensureAccount } from "@/lib/credits";
import { collectFreeCourse, purchaseCourse, FREE_COLLECT_AUTHOR_BONUS } from "@/lib/credit-trade";

export const dynamic = "force-dynamic";

/**
 * POST /api/market/collect — 从课程集市「拿走 / 购买」一门课（S4 交易闭环 §问题⑪）。
 * 入参：{ courseId }
 *
 * 分支（按课程 priceCredits）：
 *   - 免费课（priceCredits null 或 0）：collectFreeCourse 事务——建 CoursePurchase(0) 所有权真值源、
 *     进书架、作者小额创作激励（FREE_COLLECT_AUTHOR_BONUS，走 course_sale_income）原子完成。
 *   - 付费课（priceCredits>0）：走 purchaseCourse 事务——买家扣积分、作者入账、建起始记录原子完成；
 *     余额不足返回 402 引导充值；已拥有幂等返回。
 *
 * 校验：
 *   - 登录（requireUser）。
 *   - 该课 sharedStatus="shared"（在集市在售）。
 *   - 非自己造的课（authorUserId !== user.id；自己的课在书架已属造课层）。
 *
 * 所有权 / 幂等真值源：CoursePurchase @@unique([userId, courseId])——一人一课一条，重复拿走/购买撞
 * 唯一约束即「已拥有」，不重复扣款 / 不重复发激励。进度 LearningProgress 只管「学到哪」，不再判所有权。
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
      // 用 ensureAccount 而非 getBalance：历史用户可能从未建账户，此处惰性补建并补发注册赠送，
      // 否则老用户余额恒 0、永远迈不过预检。
      const balance = (await ensureAccount(user.id)).balance;
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

    // ============ 免费分支：所有权真值源 CoursePurchase + 进书架 + 作者激励原子 ============
    // 幂等 / 所有权以 CoursePurchase 为唯一真值源；作者创作激励绑定「购买记录首次创建成功」，
    // 与进书架同事务原子（进了书架作者必到账，杜绝漏发）。免费预览进度不再参与判定。
    const result = await collectFreeCourse({
      collectorId: user.id,
      authorId: course.authorUserId,
      courseId: course.id,
      firstLessonId: firstLesson.id,
      authorBonus: FREE_COLLECT_AUTHOR_BONUS,
      courseTitle: course.title,
    });

    if (result.status === "already_owned") {
      return ok({ status: "collected", already: true, message: "这门课已在你的书架" });
    }

    await track({ eventName: "course_collect", userId: user.id, properties: { courseId: course.id } });

    return ok({ status: "collected", already: false, message: `已把《${course.title}》放进你的书架` });
  });
}

/**
 * DELETE /api/market/collect — 从书架「移除 / 隐藏」一门拿走的课（POST collect 的逆操作，S4 §问题⑪补齐）。
 * 入参：{ courseId }
 *
 * 「书架」口径（对齐 lib/shelf.getMyShelf）：一门拿来的课出现在书架，靠的是该课的 LearningProgress
 * 起始记录（collect/purchase 时 upsert 落地的 fork 起始记录）——learning/collected/completed 三层
 * 都据 LearningProgress 派生。故「移出书架」= 删掉该课名下我的 LearningProgress 行。
 *
 * 分支（按 CoursePurchase.priceCredits 快照——「我当时实付了多少」，比现价更可靠）：
 *   - 免费课（priceCredits===0）：真·逆操作——删 LearningProgress + 删免费 CoursePurchase。
 *     免费课随时可零成本再拿走（re-collect 走免费分支重建所有权与书架），删所有权凭证无损失。
 *   - 付费课（priceCredits>0）：**只从书架隐藏，保留所有权凭证 CoursePurchase**——只删 LearningProgress，
 *     绝不删 CoursePurchase（付费买断权益永久，删了=白扣钱）。用户仍拥有该课，重新学习任一节即可
 *     再落 LearningProgress 回到书架，全程不重复扣款（re-collect 撞 CoursePurchase 唯一约束→already_owned）。
 *
 * 幂等：deleteMany 天然幂等（无行不抛错）；未拿走过（无 CoursePurchase 且无 LearningProgress）返回 not_on_shelf。
 * 越权铁律：所有 where 带 userId=当前用户，只能移除自己书架里的课。
 * 自造/导入课不走此接口：它们在书架靠 authorUserId 归属（造课层），非 collect 而来，删进度也不会移出书架，故拒绝。
 * 埋点：course_uncollect。
 */
export async function DELETE(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req); // A2：写操作 CSRF 防护
    const user = await requireUser();
    // 防刷：与 collect 同额度，每小时最多 60 次移除操作。
    assertUserRateLimit(user.id, "market_uncollect", 60, 3_600_000);

    const body = (await req.json().catch(() => null)) as { courseId?: string } | null;
    const courseId = body?.courseId?.trim();
    if (!courseId) return fail("缺少课程参数");

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, title: true, authorUserId: true },
    });
    if (!course) throw new AppError("课程不存在", 404);
    // 自造/导入课（作者=我）在书架属造课层，非 collect 而来，不由本接口移除。
    if (course.authorUserId === user.id) return fail("这是你自己的课，无法从书架移除", 400);

    // 所有权凭证（免费拿走=priceCredits0 / 付费买断=售价快照）；无则说明从未拿走过。
    const purchase = await prisma.coursePurchase.findUnique({
      where: { userId_courseId: { userId: user.id, courseId } },
      select: { id: true, priceCredits: true },
    });

    const isPaid = (purchase?.priceCredits ?? 0) > 0;

    // 单事务原子移出：删该课名下我的全部 LearningProgress（=移出书架）；免费课再删所有权凭证。
    const result = await prisma.$transaction(async (tx) => {
      const removed = await tx.learningProgress.deleteMany({
        where: { userId: user.id, courseId },
      });
      // 付费课保留 CoursePurchase（买断权益永久）；仅免费课删所有权凭证做真逆操作。
      let purchaseDeleted = false;
      if (purchase && !isPaid) {
        await tx.coursePurchase.delete({ where: { id: purchase.id } });
        purchaseDeleted = true;
      }
      return { removedProgress: removed.count, purchaseDeleted };
    });

    // 既无所有权凭证、也没删到任何进度 → 本就不在书架，幂等返回。
    if (!purchase && result.removedProgress === 0) {
      return ok({ status: "not_on_shelf", message: "这门课不在你的书架" });
    }

    await track({
      eventName: "course_uncollect",
      userId: user.id,
      properties: { courseId: course.id, paid: isPaid, ownershipKept: isPaid },
    });

    return ok({
      status: "removed",
      // 付费课保留所有权（仅隐藏），免费课连所有权一并移除。
      ownershipKept: isPaid,
      message: isPaid
        ? `已从书架移除《${course.title}》，你仍拥有这门课，随时可重新学习`
        : `已把《${course.title}》移出书架`,
    });
  });
}
