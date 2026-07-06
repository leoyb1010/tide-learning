import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { AppError } from "./errors";
import { ensureAccount } from "./credits";

/**
 * 集市交易闭环（S4 §问题⑪）—— 积分作货币的课程买卖记账层（server-only）。
 *
 * 与 credits.ts 的分工：
 *   - credits.ts 管「用户 ↔ 系统」的单边流水（充值 / 月赠 / LLM 扣费 / 注册赠送）。
 *   - credit-trade.ts 管「买家 ↔ 作者」的**双边交易**：一次购买同时产生买家扣款(course_purchase)
 *     与作者入账(course_sale_income)两条流水，必须原子成对发生，否则出现「扣了钱作者没收到」
 *     或「作者收到了买家没扣」的对账黑洞。故核心 purchaseCourse 在**单个 $transaction** 内
 *     完成：建 CoursePurchase（所有权真值源）→ 买家扣款 → 作者入账 → 建学习起始记录，任一失败整体回滚。
 *
 * 记账铁律（对齐 credits.ts）：
 *   - CreditLedger 不可变，balanceAfter 存快照，sum(delta)===balance 可对账。
 *   - 越权：所有 where 带 userId；买家只能用自己的余额，作者入账落到 course.authorUserId。
 *   - 幂等 / 所有权：以 CoursePurchase（@@unique([userId,courseId])）为唯一真值源——事务内 create 撞
 *     唯一约束(P2002) 才算已购，回滚整笔、返回 already_owned；**不再**用免费节 LearningProgress 判所有权，
 *     杜绝「免费预览进度污染幂等 → 白拿付费课」。
 */

// —— 交易分成配置（后续可迁 AppConfig 表）——
/** 付费课作者分成比例：售价的 70% 归作者，30% 为平台抽成（不落任何账户，等于销毁=通缩）。 */
export const AUTHOR_REVENUE_SHARE = 0.7;
/** 免费课被拿走时给作者的小额创作激励（鼓励持续供给；走 course_sale_income，refId 关联课程）。 */
export const FREE_COLLECT_AUTHOR_BONUS = 2;

/** 流水类型常量（集中定义，避免各处拼写漂移；与 CreditLedger.type 字符串契约对齐）。 */
export const LEDGER_TYPE = {
  /** 买家购买付费课，扣积分（delta<0）。refId=courseId。 */
  COURSE_PURCHASE: "course_purchase",
  /** 作者售出收益 / 免费课被拿走的创作激励，入积分（delta>0）。refId=courseId。 */
  COURSE_SALE_INCOME: "course_sale_income",
} as const;

/** 据售价算作者应得收益（向下取整，保证平台抽成非负；免费课单独走 bonus 不经此）。 */
export function authorShareOf(priceCredits: number): number {
  return Math.max(0, Math.floor(priceCredits * AUTHOR_REVENUE_SHARE));
}

/** collectFreeCourse 结果：status 区分首次拿走 / 幂等命中（已在书架）。 */
export interface CollectResult {
  status: "collected" | "already_owned";
}

/**
 * 免费拿走一门课（**所有权 + 创作激励原子事务**）：建 CoursePurchase(priceCredits=0) 所有权真值源
 * + 建学习起始记录（进书架）+ 作者小额创作激励入账，单事务原子完成。
 *
 * 幂等 / 所有权：以 CoursePurchase（@@unique([userId, courseId])）为唯一真值源——事务内 create 撞唯一
 *   约束(P2002) 即「已拿走」，回滚整笔、返回 already_owned、**不重复给作者发激励**（修 P2/P3 激励重复/漏发）。
 *   不再用免费节 LearningProgress 判幂等（进度不再是所有权 / 激励发放的判据）。
 *
 * 激励绑定：作者创作激励绑定「CoursePurchase 首次创建成功」，与购买记录同事务原子——
 *   要么「进书架 + 作者到账」一起成功，要么一起回滚，杜绝「进了书架作者没到账」的漏发（修 P2/P3）。
 *
 * @param collectorId 拿走者 userId（越权铁律，进自己的书架）。
 * @param authorId 作者 userId（收益归属；null 则不发激励，仍建购买/起始记录）。
 * @param courseId 课程 id。
 * @param firstLessonId 课程第 1 节 lessonId（建学习起始记录 = 进书架）。
 * @param authorBonus 作者创作激励积分（>0 才发；免费课被拿走的小额鼓励）。
 * @param courseTitle 课程标题（激励流水展示文案）。
 */
export async function collectFreeCourse(args: {
  collectorId: string;
  authorId: string | null;
  courseId: string;
  firstLessonId: string;
  authorBonus: number;
  courseTitle: string;
}): Promise<CollectResult> {
  const { collectorId, authorId, courseId, firstLessonId, authorBonus, courseTitle } = args;

  // 作者账户先确保存在（事务外惰性建账，含注册赠送；避免事务内触发多写）。
  const willReward = Boolean(authorId) && authorId !== collectorId && authorBonus > 0;
  if (willReward && authorId) await ensureAccount(authorId);

  try {
    await prisma.$transaction(async (tx) => {
      // —— 所有权 / 幂等真值源：先建 CoursePurchase(priceCredits=0)。撞唯一约束(P2002)=已拿走 → 回滚整笔。
      await tx.coursePurchase.create({
        data: { userId: collectorId, courseId, priceCredits: 0 },
      });

      // —— 建学习起始记录 = 进书架（并发下可能已被免费预览占用，upsert 幂等落地不覆盖进度）——
      await tx.learningProgress.upsert({
        where: { userId_lessonId: { userId: collectorId, lessonId: firstLessonId } },
        update: {},
        create: { userId: collectorId, courseId, lessonId: firstLessonId, progressSec: 0 },
      });

      // —— 作者创作激励（同事务原子，绑定 CoursePurchase 首次创建成功；漏发修复）——
      if (willReward && authorId) {
        // 原子入账：balance/totalEarned 由 DB 侧 increment，避免「读-算-写」并发覆盖；update 返回更新后行。
        const acc = await tx.creditAccount.update({
          where: { userId: authorId },
          data: { balance: { increment: authorBonus }, totalEarned: { increment: authorBonus } },
        });
        const balanceAfter = acc.balance;
        await tx.creditLedger.create({
          data: {
            userId: authorId,
            delta: authorBonus,
            type: LEDGER_TYPE.COURSE_SALE_INCOME,
            refId: courseId,
            reason: `《${courseTitle}》被拿走·创作激励`,
            balanceAfter,
          },
        });
      }
    });
    return { status: "collected" };
  } catch (e) {
    // 幂等 / 并发：仅 CoursePurchase 唯一约束(P2002) 命中才视作已拿走（回滚整笔，激励也不发）。
    // 其余异常一律 rethrow，交 handle 折叠 500，前端提示失败请重试而非假成功。
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const owned = await prisma.coursePurchase.findUnique({
        where: { userId_courseId: { userId: collectorId, courseId } },
        select: { id: true },
      });
      if (owned) return { status: "already_owned" };
    }
    throw e;
  }
}

/** purchaseCourse 结果：status 区分首次成交 / 幂等命中；balance 为买家操作后余额（UI 回显）。 */
export interface PurchaseResult {
  status: "purchased" | "already_owned";
  /** 买家操作后余额（幂等命中时为当前余额，未扣款）。 */
  balance: number;
  /** 本次实扣积分（幂等命中为 0）。 */
  spent: number;
  /** 关联的学习起始记录所在 lessonId（供 collect 复用书架落地逻辑）。 */
  firstLessonId: string;
}

/**
 * 购买付费课（**核心交易事务**）：买家扣款 + 作者入账 + 建学习起始记录，单事务原子完成。
 *
 * 前置校验（调用方已做的不重复，此处只做与「钱」强相关的）：
 *   - 课付费（price>0）由调用方判定；免费课不走此函数（走 collect 免费分支）。
 *   - 余额充足由调用方先用 assertCanAfford 预检并返回 402（本函数事务内也二次核验，防 TOCTOU）。
 *
 * 幂等 / 所有权：以 CoursePurchase（@@unique([userId, courseId])）为唯一真值源。事务内先 create
 *   CoursePurchase——撞唯一约束(P2002) 即「真已购」，回滚整笔、返回 already_owned、不扣款、不重复
 *   给作者入账（对账安全）。**不再**用免费节 LearningProgress 判所有权（免费预览不再污染幂等）。
 *
 * 越权：买家扣款 where userId=buyerId；作者入账 where userId=authorId（作者≠买家由调用方保证）。
 *
 * 并发：CoursePurchase @@unique([userId, courseId]) 是最终防线——两条并发购买请求，事务提交时唯一
 *   约束只会让一条建成购买记录；另一条 create 撞 P2002 被外层捕获视作 already_owned，保证「至多扣一次款」。
 *
 * @param buyerId 买家 userId（用自己的余额，越权铁律）。
 * @param authorId 作者 userId（收益归属；调用方已保证 !== buyerId）。
 * @param courseId 课程 id。
 * @param firstLessonId 课程第 1 节 lessonId（建学习起始记录 = 进书架）。
 * @param priceCredits 售价（正整数，调用方已判定 >0）。
 * @param courseTitle 课程标题（流水展示文案）。
 */
export async function purchaseCourse(args: {
  buyerId: string;
  authorId: string;
  courseId: string;
  firstLessonId: string;
  priceCredits: number;
  courseTitle: string;
}): Promise<PurchaseResult> {
  const { buyerId, authorId, courseId, firstLessonId, priceCredits, courseTitle } = args;
  if (priceCredits <= 0) throw new AppError("付费课售价必须为正", 400);
  if (buyerId === authorId) throw new AppError("不能购买自己的课", 400);

  const authorShare = authorShareOf(priceCredits);

  // 两账户先确保存在（事务外惰性建账，含注册赠送；避免事务内触发多写）。
  await ensureAccount(buyerId);
  await ensureAccount(authorId);

  try {
    return await prisma.$transaction(async (tx) => {
      // —— 所有权 / 幂等真值源：先建 CoursePurchase。撞唯一约束(P2002)=已购 → 回滚整笔，
      //    由外层 catch 折叠为 already_owned（不扣款、不重复给作者入账）。免费预览进度不再参与判定。
      await tx.coursePurchase.create({
        data: { userId: buyerId, courseId, priceCredits },
      });

      // —— 买家扣款（TOCTOU 二次核验余额，不足抛 402 回滚整笔）——
      const buyerAcc = await tx.creditAccount.findUniqueOrThrow({ where: { userId: buyerId } });
      if (buyerAcc.balance < priceCredits) {
        throw new AppError("积分不足，充值后可购买本课", 402);
      }
      // 原子扣款：balance/totalSpent 由 DB 侧 decrement/increment，避免「读-算-写」并发越扣；
      // TOCTOU 二次核验保留在前（余额不足即回滚）。update 返回更新后行，取 balanceAfter。
      const buyerUpdated = await tx.creditAccount.update({
        where: { userId: buyerId },
        data: { balance: { decrement: priceCredits }, totalSpent: { increment: priceCredits } },
      });
      const buyerBalanceAfter = buyerUpdated.balance;
      await tx.creditLedger.create({
        data: {
          userId: buyerId,
          delta: -priceCredits,
          type: LEDGER_TYPE.COURSE_PURCHASE,
          refId: courseId,
          reason: `购买《${courseTitle}》`,
          balanceAfter: buyerBalanceAfter,
        },
      });

      // —— 作者入账（同事务，与扣款成对；分成的 30% 平台抽成不入任何账户）——
      if (authorShare > 0) {
        // 原子入账：balance/totalEarned 由 DB 侧 increment，避免「读-算-写」并发覆盖；update 返回更新后行。
        const authorAcc = await tx.creditAccount.update({
          where: { userId: authorId },
          data: { balance: { increment: authorShare }, totalEarned: { increment: authorShare } },
        });
        const authorBalanceAfter = authorAcc.balance;
        await tx.creditLedger.create({
          data: {
            userId: authorId,
            delta: authorShare,
            type: LEDGER_TYPE.COURSE_SALE_INCOME,
            refId: courseId,
            reason: `售出《${courseTitle}》收益`,
            balanceAfter: authorBalanceAfter,
          },
        });
      }

      // —— 成交计数（销量真值口径：仅付费成交 +1）——
      await tx.course.update({
        where: { id: courseId },
        data: { salesCount: { increment: 1 } },
      });

      // —— 建学习起始记录 = 进买家书架（供续读/进度；不再是所有权判据，所有权看 CoursePurchase）——
      //    并发下 LearningProgress 的 @@unique([userId,lessonId]) 可能已被免费预览占用；
      //    用 upsert 幂等落地（已存在则不动进度），避免与免费预览进度撞唯一约束误折叠为已购。
      await tx.learningProgress.upsert({
        where: { userId_lessonId: { userId: buyerId, lessonId: firstLessonId } },
        update: {},
        create: { userId: buyerId, courseId, lessonId: firstLessonId, progressSec: 0 },
      });

      return {
        status: "purchased" as const,
        balance: buyerBalanceAfter,
        spent: priceCredits,
        firstLessonId,
      };
    });
  } catch (e) {
    if (e instanceof AppError) throw e; // 402/400 等业务错误照常上抛
    // 幂等 / 并发窗口：仅当 CoursePurchase 唯一约束(P2002) 命中才视作已购——另一条购买已建购买记录，
    // 本条 create 撞唯一约束回滚（扣款一并撤销）。其余异常一律 rethrow，交 handle 折叠 500，
    // 前端提示「购买失败请重试」而非假成功（修 P1 假成功）。
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // 二次确认 CoursePurchase 确存在，杜绝把非「已购」的唯一冲突误判为已拥有。
      const owned = await prisma.coursePurchase.findUnique({
        where: { userId_courseId: { userId: buyerId, courseId } },
        select: { id: true },
      });
      if (owned) {
        const acc = await prisma.creditAccount.findUnique({
          where: { userId: buyerId },
          select: { balance: true },
        });
        return { status: "already_owned", balance: acc?.balance ?? 0, spent: 0, firstLessonId };
      }
    }
    throw e; // 非「已购」唯一冲突或其他异常：上抛，不假成功
  }
}

/**
 * 作者收益概览（「我的收益」数据查询，UI 由 Phase2 做）。越权铁律：where userId=authorId。
 *
 * 返回：
 *   - totalIncome: 累计售课收益（course_sale_income 流水 delta 求和）。
 *   - salesCount: 累计成交笔数（付费成交，Course.salesCount 求和）。
 *   - courses: 每门已上架课的 { courseId, title, priceCredits, salesCount, income }。
 *
 * 注：income 按流水精确求和（含免费课 bonus），非用 salesCount*share 估算，保证与账本一致。
 */
export async function getAuthorEarnings(authorId: string): Promise<{
  totalIncome: number;
  totalSales: number;
  courses: Array<{
    courseId: string;
    slug: string;
    title: string;
    priceCredits: number | null;
    salesCount: number;
    income: number;
  }>;
}> {
  // 作者已上架的课（含 slug/定价与成交计数）。slug 供收益卡链接回商品页。
  const courses = await prisma.course.findMany({
    where: { authorUserId: authorId, sharedStatus: "shared" },
    select: { id: true, slug: true, title: true, priceCredits: true, salesCount: true },
  });
  // 售课收益流水（越权铁律：userId=authorId）；按 refId(courseId) 归集到每门课。
  const incomeRows = await prisma.creditLedger.groupBy({
    by: ["refId"],
    where: { userId: authorId, type: LEDGER_TYPE.COURSE_SALE_INCOME },
    _sum: { delta: true },
  });
  const incomeByCourse = new Map<string, number>();
  for (const r of incomeRows) {
    if (r.refId) incomeByCourse.set(r.refId, r._sum.delta ?? 0);
  }

  const courseRows = courses.map((c) => ({
    courseId: c.id,
    slug: c.slug,
    title: c.title,
    priceCredits: c.priceCredits,
    salesCount: c.salesCount,
    income: incomeByCourse.get(c.id) ?? 0,
  }));
  const totalIncome = courseRows.reduce((s, c) => s + c.income, 0);
  const totalSales = courseRows.reduce((s, c) => s + c.salesCount, 0);
  return { totalIncome, totalSales, courses: courseRows };
}
