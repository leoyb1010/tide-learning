import { cache } from "react";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "./db";
import { AppError } from "./errors";
import type { LlmUsageCallback, LlmUsageInfo } from "./llm";
import { costWeightOf } from "./ai/models";

/**
 * 积分经济系统（v2.3 §6）—— 记账核心。
 *
 * 设计原则：
 *   - 流水（CreditLedger）不可变，是对账与审计的根；余额（CreditAccount.balance）是派生缓存。
 *   - 所有余额变更走 $transaction：读余额 → 校验 → 写流水 + 更新余额，原子提交，防并发越扣/越发。
 *   - 每条流水存 balanceAfter 快照，任何时刻可对账（sum(delta) === balance）。
 *   - LLM 消耗按实际 Token 折算；调用前预检余额，调用后按真实用量记账。
 */

// —— 换算与配置（后续可迁到 AppConfig 表）——
const TOKENS_PER_CREDIT = 1000; // 1000 token = 1 积分（基准）
// 场景权重表：每个 AI 出口一条键。改 as const 让键集合成为字面量类型，
// Scene 由此派生（keyof），call site 传入的 scene 编译期即校验，拼错/漏配无法通过 tsc。
const SCENE_WEIGHT = {
  generate_course: 1.0,
  generate_course_review: 1.0, // 整课发布终审：覆盖/推进/重复/capstone 对账
  generate_lesson: 1.0,
  generate_lesson_html: 1.5, // v3.3 HTML 课件 LLM 增强：token 重于逐节块生成，权重上调
  import_source: 1.0,
  generate_exam: 1.0,
  review_card: 0.8, // 复习卡批量生成（原借用 note_transform 权重，现独立成键）
  note_transform: 0.8,
  note_summary: 0.8,
  companion: 0.5, // 伴侣问答低价，鼓励多问
  search_expand: 0.2,
  generate_design_brief: 0.2, // v5 造课时一次小调用生成课级设计 brief（~1k token，便宜模型），低权重
} as const;

/** 记账场景：SCENE_WEIGHT 的键集合。新增出口须先在 SCENE_WEIGHT 补键，否则 call site 报错。 */
export type Scene = keyof typeof SCENE_WEIGHT;

export const DEFAULT_CREDIT_RESERVATION_TTL_MS = 30 * 60_000;
const MAX_CREDIT_RESERVATION_TTL_MS = 24 * 60 * 60_000;

/**
 * 单次供应商调用的耐久积分冻结。
 * estimatedCredits 已从 CreditAccount.balance 扣离可用余额；remainingCredits 是尚未结算/退款的冻结额。
 */
export interface CreditReservationSnapshot {
  id: string;
  reservationKey: string;
  operationKey: string | null;
  userId: string;
  scene: Scene;
  estimatedCredits: number;
  remainingCredits: number;
  actualCredits: number;
  maxAdditionalCredits: number;
  additionalCredits: number;
  status: "active" | "settled" | "refunded" | "expired" | "reversed";
  expiresAt: Date;
  reversedAt: Date | null;
  /** false 仅表示本调用创建了预占；true 表示同键已存在，调用方不得再发供应商请求。 */
  duplicate: boolean;
}

export interface ReserveCreditsInput {
  reservationKey: string;
  /** 同一次用户可见操作的稳定键；操作未交付时可整组冲正。 */
  operationKey?: string;
  userId: string;
  scene: Scene;
  estimatedCredits: number;
  /** 实耗超过预占时，最多允许再从可用余额补扣多少；默认 0，绝不无限透支。 */
  maxAdditionalCredits?: number;
  ttlMs?: number;
  /** 仅用于确定性测试/受控恢复。 */
  now?: Date;
}

export interface CreditSettlement {
  reservationId: string;
  usageId: string;
  idempotencyKey: string;
  actualCredits: number;
  chargedFromReservation: number;
  additionalCredits: number;
  refundedCredits: number;
  balanceAfter: number;
  duplicate: boolean;
}

export interface ReverseCreditOperationInput {
  operationKey: string;
  userId: string;
  scene: Scene;
  reason?: string;
  /** 仅用于确定性测试/受控恢复。 */
  now?: Date;
}

export interface CreditOperationReversalResult {
  operationKey: string;
  reversedReservations: number;
  refundedCredits: number;
  /** 墓碑已存在；本次没有再次改动账户或流水。 */
  duplicate: boolean;
  balanceAfter: number | null;
}

export type BillingReconciliationReason =
  | "provider_timeout"
  | "provider_network"
  | "provider_5xx"
  | "settlement_failed"
  | "empty_response";

export interface BillingReconciliationInput {
  attemptKey: string;
  reasonCode: BillingReconciliationReason;
  providerStatus?: number;
  providerRequestId?: string | null;
  /** 只允许 token 计数和 model；函数内部重新白名单序列化，不保存 prompt/content。 */
  usage?: LlmUsageInfo | null;
}

type CreditsDb = PrismaClient;

/**
 * 各场景「一次调用的典型输出 token 量」——仅用于预检门槛(estimateCredits/assertCanSpend)的最坏成本估算。
 * 修复(2026-07-12 P1-3)：此前预检写死 3000 token，严重低估逐节/HTML 精修的真实用量
 * （逐节 maxTokens 8000、bespoke HTML 16000），使门槛远低于实扣、放行超额免单。
 * 这里按各出口真实 maxTokens 量级取值，让门槛贴近真实成本；实际记账仍以真实 token 为准，此表不影响记账。
 */
const SCENE_TYPICAL_TOKENS: Record<Scene, number> = {
  generate_course: 4000, // 大纲
  generate_course_review: 3200, // 整课发布终审（按批复核 + 总编结论）
  generate_lesson: 8000, // 逐节块
  generate_lesson_html: 16000, // bespoke HTML 精修
  import_source: 6000,
  generate_exam: 4000,
  review_card: 3000,
  note_transform: 3000,
  note_summary: 3000,
  companion: 2000,
  search_expand: 1000,
  generate_design_brief: 400, // v5 设计 brief：极短 JSON 输出
};

/**
 * 取场景权重。缺键（理论上被 Scene 类型挡住，此处防御运行时脏数据 / 类型断言绕过）：
 * dev 环境显式 warn 暴露漏配，生产回落 1.0（按最贵计，宁多扣不漏扣）。
 */
function sceneWeight(scene: Scene): number {
  const w = SCENE_WEIGHT[scene];
  if (w === undefined) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[credits] 未配置场景权重：${String(scene)}，回落 1.0，请在 SCENE_WEIGHT 补键`);
    }
    return 1.0;
  }
  return w;
}

// —— 订阅月度积分：按档位差异化（v3.0 商业化）——
// 设计意图：更长周期 / 更高价档位 → 月赠更多积分，强化「年卡更划算」的锚点。
//   month(月卡)   → 300
//   quarter(季卡) → 500
//   year(年卡)    → 800
//   单赛道订阅     → 200（scope !== "all"，通常按月计费的窄权益）
// 拿不到具体 plan（异常/历史数据缺失）时用保守默认，宁少发不多发。
export const MONTHLY_GRANT_BY_PERIOD: Record<string, number> = {
  month: 300,
  month_recurring: 300,
  quarter: 500,
  year: 800,
};
export const SINGLE_TRACK_MONTHLY_GRANT = 200; // 单赛道订阅（scope !== "all"）
export const DEFAULT_MONTHLY_GRANT = 300; // 兜底：拿不到档位信息时的保守额度

/**
 * 据订阅档位返回该档「每月赠送积分」额度（v3.0 差异化联动）。
 * 优先级：单赛道(scope!=="all") → 固定 200；否则按 billingPeriod 查表；查不到 → 保守默认。
 * 入参允许 null/缺失（历史订阅或解析失败），一律回落到 DEFAULT_MONTHLY_GRANT。
 */
export function monthlyGrantForPlan(
  plan: { billingPeriod?: string | null; scope?: string | null } | null | undefined,
): number {
  if (!plan) return DEFAULT_MONTHLY_GRANT;
  // 单赛道订阅：窄权益，固定档，不随周期变化
  if (plan.scope && plan.scope !== "all") return SINGLE_TRACK_MONTHLY_GRANT;
  const period = plan.billingPeriod ?? "";
  return MONTHLY_GRANT_BY_PERIOD[period] ?? DEFAULT_MONTHLY_GRANT;
}

/**
 * Token 用量 → 积分（向上取整，至少 1 分，避免零成本刷调用）。
 * v3.2：叠乘模型计费权重（usage.model → costWeight，flash 基准=1，深思档更贵）。
 * 缺 model（如 estimate 预估）按权重 1 计。
 */
export function tokensToCredits(usage: { totalTokens: number; model?: string }, scene: Scene): number {
  const weight = sceneWeight(scene);
  const modelWeight = costWeightOf(usage.model);
  const raw = (usage.totalTokens / TOKENS_PER_CREDIT) * weight * modelWeight;
  return Math.max(1, Math.ceil(raw));
}

/**
 * 预估某场景一次调用的积分（UI 展示"本次约消耗 ~N 积分" / 预检门槛）。
 * approxTokens 缺省时用该场景的典型 token 量(SCENE_TYPICAL_TOKENS)，不再一律按 3000 估。
 * 传 model 则叠乘该模型计费权重(高级模型更贵)，让门槛贴近真实最坏成本。
 */
export function estimateCredits(scene: Scene, approxTokens?: number, model?: string): number {
  const tokens = approxTokens ?? SCENE_TYPICAL_TOKENS[scene] ?? 3000;
  return tokensToCredits({ totalTokens: tokens, model }, scene);
}

/** 读余额（React cache 去重）。无账户视为 0。 */
export const getBalance = cache(async (userId: string): Promise<number> => {
  const acc = await prisma.creditAccount.findUnique({ where: { userId }, select: { balance: true } });
  return acc?.balance ?? 0;
});

/**
 * 确保账户存在（首次访问惰性创建）。返回账户。
 *
 * 未验证邮箱/手机号不得自动获得可交易积分：仅靠 IP 限流无法阻止分布式批量注册套利。
 * 若未来恢复新客奖励，必须由“联系方式验证成功”事件显式调用 grantCredits，不能放回此通用入口。
 */
export async function ensureAccount(userId: string) {
  const existing = await prisma.creditAccount.findUnique({ where: { userId } });
  if (existing) return existing;
  try {
    return await prisma.creditAccount.create({
      data: { userId, balance: 0, totalEarned: 0 },
    });
  } catch (e) {
    // 并发首访：两请求同时建账，后到者撞 userId 唯一约束(P2002)——账户已被先到者建好，重读返回即可。
    if ((e as { code?: string })?.code === "P2002") {
      return prisma.creditAccount.findUniqueOrThrow({ where: { userId } });
    }
    throw e;
  }
}

/** 入账（赠送/充值/分享奖励/管理调账）。原子：写流水 + 更新余额。返回新余额。 */
export async function grantCredits(
  userId: string,
  amount: number,
  type: string,
  opts: { refId?: string; reason?: string } = {},
): Promise<number> {
  if (amount <= 0) throw new AppError("入账金额必须为正", 400);
  await ensureAccount(userId);
  return prisma.$transaction(async (tx) => {
    // 原子入账：balance/totalEarned 由 DB 侧 increment，避免「读-算-写」并发覆盖；update 返回更新后行。
    const updated = await tx.creditAccount.update({
      where: { userId },
      data: { balance: { increment: amount }, totalEarned: { increment: amount } },
    });
    const balanceAfter = updated.balance;
    await tx.creditLedger.create({
      data: { userId, delta: amount, type, refId: opts.refId, reason: opts.reason, balanceAfter },
    });
    return balanceAfter;
  });
}

/**
 * 预检余额。默认要求 > 0（有余额即可开始）；传 scene 时用该场景的最坏估算成本设门槛，
 * 堵住「余额 1 分换任意大额生成」的超额免单缺口（HIGH-1）。余额可为负（欠账），负数必被拦。
 * 传 model（P1-3 修复）则按所选模型的计费权重抬高门槛，避免高级模型下门槛仍按基准模型低估。
 */
export async function assertCanSpend(userId: string, scene?: Scene, model?: string): Promise<void> {
  const balance = await getBalance(userId);
  // 场景已知则按该场景典型 token × 所选模型权重估门槛，否则最低 1 分
  const threshold = scene ? estimateCredits(scene, undefined, model) : 1;
  if (balance < threshold) {
    throw new AppError("积分不足，充值后可继续使用 AI 能力", 402);
  }
}

/**
 * 读余额（不经 React cache，每次回源）。用于后台逐节生成循环等需要「实时余额」的场景——
 * cache 版 getBalance 在同一请求作用域内会返回首次快照，循环内看不到中途扣费。
 */
export async function getBalanceFresh(userId: string): Promise<number> {
  const acc = await prisma.creditAccount.findUnique({ where: { userId }, select: { balance: true } });
  return acc?.balance ?? 0;
}

/**
 * 原子冻结积分。余额条件与 decrement 位于同一条 UPDATE，两个进程争抢同一余额时至多一个成功。
 * reservationKey 已存在时只返回原快照：参数必须完全匹配，不会再次扣款，也不会借同键串单。
 */
export async function reserveCredits(
  input: ReserveCreditsInput,
  db: CreditsDb = prisma,
): Promise<CreditReservationSnapshot> {
  const reservationKey = requiredCreditKey(input.reservationKey, "reservationKey");
  const operationKey = input.operationKey === undefined
    ? null
    : requiredCreditKey(input.operationKey, "operationKey");
  const userId = requiredCreditKey(input.userId, "userId");
  const scene = validScene(input.scene);
  const estimatedCredits = positiveCreditAmount(input.estimatedCredits, "estimatedCredits");
  const maxAdditionalCredits = nonNegativeCreditAmount(input.maxAdditionalCredits ?? 0, "maxAdditionalCredits");
  if (!Number.isSafeInteger(estimatedCredits + maxAdditionalCredits)) {
    throw new TypeError("estimatedCredits + maxAdditionalCredits is too large");
  }
  const now = validCreditDate(input.now);
  const ttlMs = validCreditTtl(input.ttlMs);
  const expiresAt = new Date(now.getTime() + ttlMs);

  try {
    return await db.$transaction(async (tx) => {
      // 首操作就是条件 INSERT：SQLite 上它同时获得写锁，与冲正墓碑的 INSERT
      // 形成全序。若冲正先插入，迟到预占一行都不会创建；若预占先插入，
      // 冲正会在同一事务看见它并释放全部冻结。不依赖进程内锁或先读后写。
      const reservationId = randomUUID();
      const inserted = await tx.$executeRaw(Prisma.sql`
        INSERT INTO "CreditReservation" (
          "id", "reservationKey", "operationKey", "userId", "scene",
          "estimatedCredits", "remainingCredits", "actualCredits",
          "maxAdditionalCredits", "additionalCredits", "status",
          "expiresAt", "settledAt", "reversedAt", "createdAt", "updatedAt"
        )
        SELECT
          ${reservationId}, ${reservationKey}, ${operationKey}, ${userId}, ${scene},
          ${estimatedCredits}, ${estimatedCredits}, 0,
          ${maxAdditionalCredits}, 0, 'active',
          ${expiresAt}, NULL, NULL, ${now}, ${now}
        WHERE ${operationKey} IS NULL
           OR NOT EXISTS (
             SELECT 1 FROM "LlmBillingOperationReversal" reversal
             WHERE reversal."operationKey" = ${operationKey}
           )
        ON CONFLICT ("reservationKey") DO NOTHING
      `);
      if (inserted !== 1) {
        const existing = await tx.creditReservation.findUnique({ where: { reservationKey } });
        if (existing) {
          assertMatchingReservation(existing, { operationKey, userId, scene, estimatedCredits, maxAdditionalCredits });
          return normalizeReservation(existing, true);
        }
        throw new AppError("该 AI 操作已冲正，不能继续扣费", 409, false);
      }
      const reservation = await tx.creditReservation.findUniqueOrThrow({ where: { id: reservationId } });
      // 注销不删 User 行，而是保留匿名财务壳。因此外键存在不能证明账户仍可计费；
      // 这个检查必须放在本事务首个写之后，与注销事务的 User 行写形成 SQLite 全序。
      const billableUser = await tx.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { id: true },
      });
      if (!billableUser) throw new AppError("账号已注销，不能继续产生 AI 费用", 409, false);
      if (operationKey) {
        // 一个 operation 只能归属一个用户和一种计费场景。检查位于首个写之后，
        // 并发首笔也会串行；发现串组则整个事务回滚，不留预占行。
        const mismatched = await tx.creditReservation.findFirst({
          where: {
            operationKey,
            id: { not: reservationId },
            OR: [{ userId: { not: userId } }, { scene: { not: scene } }],
          },
          select: { id: true },
        });
        if (mismatched) throw new AppError("operationKey 已被不同用户或计费场景占用", 409, false);
      }
      // 条件扣减是余额闸门：绝不先读 balance 再无条件 decrement。
      const frozen = await tx.creditAccount.updateMany({
        where: { userId, balance: { gte: estimatedCredits } },
        data: { balance: { decrement: estimatedCredits } },
      });
      if (frozen.count !== 1) throw new AppError("积分不足，无法预占本次 AI 费用", 402);

      const account = await tx.creditAccount.findUniqueOrThrow({ where: { userId }, select: { balance: true } });
      await tx.creditLedger.create({
        data: {
          userId,
          delta: -estimatedCredits,
          type: "llm_reserve",
          refId: reservation.id,
          balanceAfter: account.balance,
          reason: `AI预占·${scene}·${reservationKey}`,
        },
      });
      return normalizeReservation(reservation, false);
    });
  } catch (error) {
    // 两个相同 reservationKey 并发：后者可能都在事务开始时看不到行，唯一约束由 DB 最终裁决。
    // 回读已提交 winner 并严格核对参数，实现可重试幂等；不同参数复用同键仍拒绝。
    if (isPrismaUniqueError(error)) {
      const existing = await db.creditReservation.findUnique({ where: { reservationKey } });
      if (existing) {
        assertMatchingReservation(existing, { operationKey, userId, scene, estimatedCredits, maxAdditionalCredits });
        return normalizeReservation(existing, true);
      }
    }
    throw error;
  }
}

/**
 * 结算一笔预占的真实 LLM usage。
 *
 * - usage idempotencyKey 由数据库 UNIQUE 保证只消费一次；重复调用返回相同结算结果；
 * - 实耗 <= 预占：消费实耗并把未用冻结额退回余额；
 * - 实耗 > 预占：只在 maxAdditionalCredits 上限内、且当前可用余额足够时原子补扣；否则整笔回滚；
 * - 余额永不为负，CreditAccount.totalSpent 只累计真实实耗，不累计冻结。
 */
export async function settleLlmUsage(
  reservationId: string,
  usage: LlmUsageInfo,
  idempotencyKey: string,
  db: CreditsDb = prisma,
  nowInput?: Date,
): Promise<CreditSettlement> {
  const id = requiredCreditKey(reservationId, "reservationId");
  const usageKey = requiredCreditKey(idempotencyKey, "idempotencyKey");
  const now = validCreditDate(nowInput);
  const normalizedUsage = validLlmUsage(usage);

  try {
    return await db.$transaction(async (tx) => {
      // 首操作即条件写，既是状态机 CAS，也是 SQLite 写锁；并发 settle/refund 只有一个能把 active
      // 推进到瞬时 settling。事务回滚时此状态也回滚，不会留下永久中间态。
      const claimed = await tx.creditReservation.updateMany({
        where: { id, status: "active", expiresAt: { gt: now } },
        data: { status: "settling", updatedAt: now },
      });
      if (claimed.count !== 1) {
        const duplicate = await readDuplicateSettlement(tx, id, usageKey);
        if (duplicate) return duplicate;
        const current = await tx.creditReservation.findUnique({ where: { id }, select: { status: true, expiresAt: true } });
        if (!current) throw new AppError("积分预占不存在", 404);
        if (current.status === "active" && current.expiresAt.getTime() <= now.getTime()) {
          throw new AppError("积分预占已过期", 409);
        }
        throw new AppError("积分预占已结算或失效", 409);
      }
      const reservation = await tx.creditReservation.findUniqueOrThrow({ where: { id } });
      const scene = validScene(reservation.scene);
      const actualCredits = tokensToCredits(normalizedUsage, scene);
      const chargedFromReservation = Math.min(actualCredits, reservation.remainingCredits);
      const additionalCredits = actualCredits - chargedFromReservation;
      if (additionalCredits > reservation.maxAdditionalCredits) {
        throw new AppError("实际 AI 费用超过本次预占上限", 402);
      }

      if (additionalCredits > 0) {
        const charged = await tx.creditAccount.updateMany({
          where: { userId: reservation.userId, balance: { gte: additionalCredits } },
          data: { balance: { decrement: additionalCredits } },
        });
        if (charged.count !== 1) throw new AppError("积分不足，无法结算超出预占的 AI 费用", 402);
      }

      const refundedCredits = reservation.remainingCredits - chargedFromReservation;
      const account = await tx.creditAccount.update({
        where: { userId: reservation.userId },
        data: {
          ...(refundedCredits > 0 ? { balance: { increment: refundedCredits } } : {}),
          totalSpent: { increment: actualCredits },
        },
      });
      const llmUsage = await tx.llmUsage.create({
        data: {
          userId: reservation.userId,
          scene,
          promptTokens: normalizedUsage.promptTokens,
          completionTokens: normalizedUsage.completionTokens,
          totalTokens: normalizedUsage.totalTokens,
          creditCost: actualCredits,
          idempotencyKey: usageKey,
          reservationId: reservation.id,
        },
      });
      await tx.creditReservation.update({
        where: { id: reservation.id },
        data: {
          remainingCredits: 0,
          actualCredits,
          additionalCredits,
          status: "settled",
          settledAt: now,
          updatedAt: now,
        },
      });

      // reserve 行已经扣掉 estimated；这里只记录实际消费说明与资金真正发生变化的补扣/退款。
      if (additionalCredits > 0) {
        await tx.creditLedger.create({
          data: {
            userId: reservation.userId,
            delta: -additionalCredits,
            type: "llm_settle_extra",
            refId: reservation.id,
            balanceAfter: account.balance,
            reason: `AI补扣·${scene}·${usageKey}`,
          },
        });
      }
      if (refundedCredits > 0) {
        await tx.creditLedger.create({
          data: {
            userId: reservation.userId,
            delta: refundedCredits,
            type: "llm_reserve_refund",
            refId: reservation.id,
            balanceAfter: account.balance,
            reason: `AI预占退款·${scene}·${usageKey}`,
          },
        });
      }

      return {
        reservationId: reservation.id,
        usageId: llmUsage.id,
        idempotencyKey: usageKey,
        actualCredits,
        chargedFromReservation,
        additionalCredits,
        refundedCredits,
        balanceAfter: account.balance,
        duplicate: false,
      };
    });
  } catch (error) {
    // 同一 usageKey 并发结算：数据库唯一约束只允许一个 winner；回读 winner 作为幂等成功。
    if (isPrismaUniqueError(error)) {
      const duplicate = await readDuplicateSettlement(db, id, usageKey);
      if (duplicate) return duplicate;
    }
    throw error;
  }
}

/**
 * 供应商未调用/失败时释放全部剩余冻结额。与 settle 互斥：仅 active 可退款；重复退款返回 false。
 */
export async function refundCreditReservation(
  reservationId: string,
  reason = "AI 调用未完成",
  db: CreditsDb = prisma,
  nowInput?: Date,
): Promise<boolean> {
  const id = requiredCreditKey(reservationId, "reservationId");
  const now = validCreditDate(nowInput);
  return db.$transaction(async (tx) => {
    // 与 settle 同一 CAS 状态机：谁先把 active 推走，谁拥有本次余额变更权。
    const claimed = await tx.creditReservation.updateMany({
      where: { id, status: "active" },
      data: { status: "refunding", updatedAt: now },
    });
    if (claimed.count !== 1) return false;
    const reservation = await tx.creditReservation.findUniqueOrThrow({ where: { id } });
    const refund = reservation.remainingCredits;
    const expired = reservation.expiresAt.getTime() <= now.getTime();
    const account = await tx.creditAccount.update({
      where: { userId: reservation.userId },
      data: refund > 0 ? { balance: { increment: refund } } : {},
    });
    await tx.creditReservation.update({
      where: { id },
      data: { remainingCredits: 0, status: expired ? "expired" : "refunded", settledAt: now, updatedAt: now },
    });
    if (refund > 0) {
      await tx.creditLedger.create({
        data: {
          userId: reservation.userId,
          delta: refund,
          type: "llm_reserve_refund",
          refId: reservation.id,
          balanceAfter: account.balance,
          reason: normalizeCreditReason(reason),
        },
      });
    }
    return true;
  });
}

/**
 * 整组冲正一次最终未交付的 AI 操作。
 *
 * - 先插入 operationKey 唯一墓碑，与 reserveCredits 的条件 INSERT 共用 SQLite
 *   写序，冲正开始后的迟到预占必然失败；
 * - active 预占只释放冻结，不改 totalSpent；
 * - settled 预占把已扣实耗退回余额并同额减少 totalSpent，LlmUsage 原始记录保留；
 * - refunded/expired/reversed 已无可退余额，是 no-op；
 * - 墓碑和全部账户/流水/预占状态在一个事务中，重试不会双退。
 */
export async function reverseCreditOperation(
  input: ReverseCreditOperationInput,
  db: CreditsDb = prisma,
): Promise<CreditOperationReversalResult> {
  const operationKey = requiredCreditKey(input.operationKey, "operationKey");
  const userId = requiredCreditKey(input.userId, "userId");
  const scene = validScene(input.scene);
  const reason = normalizeCreditReason(input.reason ?? "AI 操作未完整交付，积分已冲正");
  const now = validCreditDate(input.now);

  return db.$transaction(async (tx) => {
    // 首写与 reserveCredits 的首写互斥。ON CONFLICT 使丢包重试安全，
    // 同时保留原始墓碑的 user/scene/reason，不让重试改写审计事实。
    const inserted = await tx.$executeRaw(Prisma.sql`
      INSERT INTO "LlmBillingOperationReversal" (
        "operationKey", "userId", "scene", "reason", "createdAt"
      ) VALUES (${operationKey}, ${userId}, ${scene}, ${reason}, ${now})
      ON CONFLICT ("operationKey") DO NOTHING
    `);
    const tombstone = await tx.llmBillingOperationReversal.findUniqueOrThrow({ where: { operationKey } });
    if (tombstone.userId !== userId || tombstone.scene !== scene) {
      throw new AppError("operationKey 已被不同用户或计费场景占用", 409, false);
    }

    const reservations = await tx.creditReservation.findMany({
      where: { operationKey },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (reservations.some((row) => row.userId !== userId || row.scene !== scene)) {
      throw new AppError("operationKey 的历史预占归属不一致", 409, false);
    }

    let reversedReservations = 0;
    let refundedCredits = 0;
    let balanceAfter: number | null = null;
    for (const reservation of reservations) {
      if (["refunded", "expired", "reversed"].includes(reservation.status)) continue;
      if (reservation.status !== "active" && reservation.status !== "settled") {
        // settling/refunding 只是事务内瞬时态，不应出现在已提交数据。
        // 若出现就整笔回滚，不在账务不明时部分冲正。
        throw new AppError("积分预占状态异常，无法安全冲正", 409, false);
      }

      const refund = reservation.status === "settled"
        ? reservation.actualCredits
        : reservation.remainingCredits;
      if (refund < 0 || !Number.isSafeInteger(refund)) {
        throw new AppError("积分预占金额异常，无法安全冲正", 409, false);
      }

      if (reservation.status === "settled") {
        // totalSpent 是真实实耗统计，冲正时与余额同一条条件 UPDATE 反向修正；
        // gte 是损坏数据闸门，绝不允许把累计消耗减成负数。
        const corrected = await tx.creditAccount.updateMany({
          where: { userId, totalSpent: { gte: refund } },
          data: { balance: { increment: refund }, totalSpent: { decrement: refund } },
        });
        if (corrected.count !== 1) {
          throw new AppError("积分账户与用量账不一致，无法安全冲正", 409, false);
        }
      } else {
        await tx.creditAccount.update({
          where: { userId },
          data: refund > 0 ? { balance: { increment: refund } } : {},
        });
      }
      const account = await tx.creditAccount.findUniqueOrThrow({ where: { userId } });
      balanceAfter = account.balance;

      if (refund > 0) {
        await tx.creditLedger.create({
          data: {
            userId,
            delta: refund,
            type: "llm_operation_refund",
            refId: reservation.id,
            balanceAfter,
            reason: `AI操作冲正·${scene}·${reason}`.slice(0, 500),
          },
        });
      }
      const reversed = await tx.creditReservation.updateMany({
        where: { id: reservation.id, status: reservation.status },
        data: {
          remainingCredits: 0,
          status: "reversed",
          reversedAt: now,
          updatedAt: now,
        },
      });
      if (reversed.count !== 1) throw new AppError("积分冲正并发冲突", 409, false);
      reversedReservations += 1;
      refundedCredits += refund;
    }

    if (balanceAfter === null) {
      balanceAfter = (await tx.creditAccount.findUnique({ where: { userId }, select: { balance: true } }))?.balance ?? null;
    }
    return {
      operationKey,
      reversedReservations,
      refundedCredits,
      duplicate: inserted === 0,
      balanceAfter,
    };
  });
}

/**
 * 对“供应商可能已产生成本，但本地无法证明 usage”的 attempt，在一个事务内：
 * 1) 留下不含课程正文的耐久对账事件；2) 退回用户预占。
 * 事件写入失败时整个事务回滚，不会出现“已退款但无对账线索”。
 */
export async function refundCreditReservationForReconciliation(
  reservationId: string,
  input: BillingReconciliationInput,
  db: CreditsDb = prisma,
  nowInput?: Date,
): Promise<boolean> {
  const id = requiredCreditKey(reservationId, "reservationId");
  const attemptKey = requiredCreditKey(input.attemptKey, "attemptKey");
  const allowedReasons = new Set<BillingReconciliationReason>([
    "provider_timeout", "provider_network", "provider_5xx", "settlement_failed", "empty_response",
  ]);
  if (!allowedReasons.has(input.reasonCode)) throw new TypeError("unsupported billing reconciliation reason");
  if (input.providerStatus !== undefined &&
    (!Number.isSafeInteger(input.providerStatus) || input.providerStatus < 100 || input.providerStatus > 599)) {
    throw new TypeError("providerStatus must be a valid HTTP status");
  }
  const providerRequestId = typeof input.providerRequestId === "string"
    ? input.providerRequestId.replace(/[\u0000-\u001f\u007f]+/g, "").trim().slice(0, 200) || null
    : null;
  const usage = input.usage ? validLlmUsage(input.usage) : null;
  const usageJson = usage ? JSON.stringify({
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    model: usage.model,
  }) : null;
  const now = validCreditDate(nowInput);

  return db.$transaction(async (tx) => {
    const claimed = await tx.creditReservation.updateMany({
      where: { id, status: "active" },
      data: { status: "refunding", updatedAt: now },
    });
    if (claimed.count !== 1) return false;
    const reservation = await tx.creditReservation.findUniqueOrThrow({ where: { id } });
    const scene = validScene(reservation.scene);
    const refund = reservation.remainingCredits;
    const account = await tx.creditAccount.update({
      where: { userId: reservation.userId },
      data: refund > 0 ? { balance: { increment: refund } } : {},
    });
    await tx.llmBillingReconciliation.create({
      data: {
        reservationId: reservation.id,
        userId: reservation.userId,
        scene,
        attemptKey,
        reasonCode: input.reasonCode,
        providerStatus: input.providerStatus,
        providerRequestId,
        usageJson,
      },
    });
    await tx.creditReservation.update({
      where: { id },
      data: { remainingCredits: 0, status: "refunded", settledAt: now, updatedAt: now },
    });
    if (refund > 0) {
      await tx.creditLedger.create({
        data: {
          userId: reservation.userId,
          delta: refund,
          type: "llm_reserve_refund",
          refId: reservation.id,
          balanceAfter: account.balance,
          reason: `AI供应商用量待对账·${input.reasonCode}`,
        },
      });
    }
    return true;
  });
}

/**
 * 释放一小批已过期预占，供定时任务或请求顺手维护调用。
 * 每行仍走同一 CAS 退款事务，并发 sweep/settle 不会重复退还。
 */
export async function releaseExpiredCreditReservations(
  limit = 100,
  db: CreditsDb = prisma,
  nowInput?: Date,
): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new TypeError("limit must be an integer between 1 and 500");
  }
  const now = validCreditDate(nowInput);
  const rows = await db.creditReservation.findMany({
    where: { status: "active", expiresAt: { lte: now } },
    select: { id: true },
    orderBy: { expiresAt: "asc" },
    take: limit,
  });
  let released = 0;
  for (const row of rows) {
    if (await refundCreditReservation(row.id, "AI 预占过期自动退款", db, now)) released++;
  }
  return released;
}

/** 为 chat.onUsage 创建预占结算回调；idempotencyKey 必须对应这一笔供应商调用且可稳定重建。 */
export function createReservationChargingCallback(
  reservationId: string,
  idempotencyKey: string,
): LlmUsageCallback {
  return async (usage) => {
    await settleLlmUsage(reservationId, usage, idempotencyKey);
  };
}

/**
 * 记录 LLM 用量并扣费（原子）。写 LlmUsage + 扣余额 + 写流水。
 * v2.3 修复：允许扣成负余额（欠账）——AI 已产生真实成本不能回滚已生成内容，
 * 记全额欠账，下次 assertCanSpend 因余额<门槛自然拦截（不再"超出部分免单"）。
 * 返回本次实扣积分。失败落 AuditLog 可对账（不再静默丢失）。
 */
export async function recordLlmSpend(userId: string, usage: LlmUsageInfo, scene: Scene): Promise<number> {
  const cost = tokensToCredits(usage, scene);
  try {
    return await prisma.$transaction(async (tx) => {
      // 全额扣（允许负余额=欠账）：AI 已产生成本，不能免单；欠账下次被 assertCanSpend 拦。
      // 原子扣减：balance/totalSpent 由 DB 侧 decrement/increment，避免「读-算-写」并发越扣；
      // update 返回更新后行，balanceAfter 直接取自返回值（省一次读）。
      const acc = await tx.creditAccount.findUnique({ where: { userId }, select: { userId: true } });
      let balanceAfter: number;
      if (acc) {
        const updated = await tx.creditAccount.update({
          where: { userId },
          data: { balance: { decrement: cost }, totalSpent: { increment: cost } },
        });
        balanceAfter = updated.balance;
      } else {
        // 无账户（理论上调用前已 ensureAccount，此处防御）：视余额为 0，仅记欠账流水不建账。
        balanceAfter = 0 - cost;
      }
      await tx.llmUsage.create({
        data: {
          userId,
          scene,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          creditCost: cost,
        },
      });
      await tx.creditLedger.create({
        data: { userId, delta: -cost, type: "llm_spend", refId: scene, balanceAfter, reason: `AI·${scene}·${usage.model}` },
      });
      return cost;
    });
  } catch (e) {
    console.error("[credits] recordLlmSpend failed:", e);
    // MED-2：记账失败落 AuditLog 可对账（欠账待补），不静默丢失。独立写入 + 二次兜底。
    try {
      await prisma.auditLog.create({
        data: {
          operatorId: userId,
          action: "llm_spend_failed",
          targetType: "credit",
          targetId: userId,
          detail: JSON.stringify({ scene, cost, totalTokens: usage.totalTokens, error: e instanceof Error ? e.message : String(e) }),
        },
      });
    } catch {
      /* 二次失败仅日志 */
    }
    return 0;
  }
}

/**
 * 月度赠送（订阅用户）。惰性触发：每次需要时检查本月是否已发，未发则发。
 * monthKey 形如 "2026-07"（调用方传入 Asia/Shanghai 当月，保证 SSR 稳定）。
 *
 * v3.0：按档位差异化。grantAmount 由调用方据当前订阅档位传入
 * （见 entitlement 快照的 monthlyGrant 派生字段 / monthlyGrantForPlan）；
 * 缺省回落 DEFAULT_MONTHLY_GRANT，保证老调用点或拿不到档位时仍能保守发放。
 *
 * 幂等/防并发：monthlyGrantKey 作月度水位线——每人每月至多一次；金额在事务外先算好，
 * 事务内以「二次确认 monthlyGrantKey」为唯一放行闸门，杜绝并发重复发放。
 */
export async function ensureMonthlyGrant(
  userId: string,
  monthKey: string,
  isSubscriber: boolean,
  grantAmount: number = DEFAULT_MONTHLY_GRANT,
): Promise<void> {
  if (!isSubscriber) return;
  // 金额兜底：非正数（脏数据/未解析）一律回落保守默认，绝不发 0 或负数。
  const amount = grantAmount > 0 ? Math.floor(grantAmount) : DEFAULT_MONTHLY_GRANT;
  const acc = await ensureAccount(userId);
  if (acc.monthlyGrantKey === monthKey) return; // 本月已发
  await prisma.$transaction(async (tx) => {
    // 事务内二次确认，防并发重复发放
    const fresh = await tx.creditAccount.findUniqueOrThrow({ where: { userId } });
    if (fresh.monthlyGrantKey === monthKey) return;
    // 原子发放：balance/totalEarned 由 DB 侧 increment，同时推进 monthlyGrantKey 水位线；update 返回更新后行。
    const updated = await tx.creditAccount.update({
      where: { userId },
      data: { balance: { increment: amount }, totalEarned: { increment: amount }, monthlyGrantKey: monthKey },
    });
    const balanceAfter = updated.balance;
    await tx.creditLedger.create({
      // type 保留 "monthly_grant" 不变（对账/历史流水兼容）；档位差异记在 reason 里。
      data: { userId, delta: amount, type: "monthly_grant", refId: monthKey, balanceAfter, reason: `${monthKey} 会员月度积分 (+${amount})` },
    });
  });
}

/**
 * 蓝图 D5（审查 P1-9）：免费用户月度体验积分——解「不订阅→没体验过造课→不订阅」的冷启动死锁。
 * 额度走 env FREE_MONTHLY_CREDITS（默认 100 分 ≈ 一门 standard 课），水位线复用 monthlyGrantKey
 * 列、键前缀 "free:" 与会员月赠区分。月中升级订阅时会员月赠仍可发（键不同），双发上限一次、金额小，
 * 属可接受的宽松侧取舍。发放幂等/防并发与 ensureMonthlyGrant 同款事务二次确认。
 */
export function freeMonthlyCreditAmount(): number {
  const n = Number(process.env.FREE_MONTHLY_CREDITS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 100;
}

export async function ensureFreeMonthlyGrant(userId: string, monthKey: string): Promise<void> {
  const amount = freeMonthlyCreditAmount();
  if (amount <= 0) return; // 运营可用 FREE_MONTHLY_CREDITS=0 关闭免费体验
  const freeKey = `free:${monthKey}`;
  await ensureAccount(userId);
  // 审计修复：水位线改用不可变台账 (type, refId) 查重，**不写 monthlyGrantKey**——
  // 此前与会员月赠共用该列互相覆盖，订阅态每翻转一次即可再领一轮（月度幂等被打穿）。
  const already = await prisma.creditLedger.findFirst({
    where: { userId, type: "monthly_grant", refId: freeKey },
    select: { id: true },
  });
  if (already) return;
  await prisma.$transaction(async (tx) => {
    const fresh = await tx.creditLedger.findFirst({ where: { userId, type: "monthly_grant", refId: freeKey }, select: { id: true } });
    if (fresh) return; // 事务内二次确认防并发双发
    const updated = await tx.creditAccount.update({
      where: { userId },
      data: { balance: { increment: amount }, totalEarned: { increment: amount } },
    });
    await tx.creditLedger.create({
      data: { userId, delta: amount, type: "monthly_grant", refId: freeKey, balanceAfter: updated.balance, reason: `${monthKey} 免费体验积分 (+${amount})` },
    });
  });
}

/**
 * 便捷 helper：把 llm.ts 的 onUsage 回调直接对接到记账。
 * 记账直接返回 Promise 给 chat await：请求路由、脚本以及 Next after() 内的后台生成都走同一
 * 可等待契约。这里不能再把主记账注册进 after()——after 回调要等响应结束才运行，而响应又在
 * 等 chat 返回，会形成等待环；退回 void fire-and-forget 则会在进程冻结/回收时丢账。
 */
export function creditingOnUsage(userId: string, scene: Scene): LlmUsageCallback {
  return async (usage: LlmUsageInfo) => {
    const charged = await recordLlmSpend(userId, usage, scene);
    // tokensToCredits 最少为 1；0 只可能表示 recordLlmSpend 已失败并落了 AuditLog。
    // 抛给 chat 的独立 usage catch 做第二层可观测日志，但绝不触发上游重试。
    if (charged <= 0) throw new Error(`LLM usage accounting failed (${scene})`);
  };
}

function requiredCreditKey(value: string, name: string): string {
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${name} must not be empty`);
  if (normalized.length > 512) throw new TypeError(`${name} is too long`);
  return normalized;
}

function validScene(value: string): Scene {
  if (!Object.prototype.hasOwnProperty.call(SCENE_WEIGHT, value)) {
    throw new TypeError(`unsupported credit scene: ${value}`);
  }
  return value as Scene;
}

function positiveCreditAmount(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`);
  return value;
}

function nonNegativeCreditAmount(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative integer`);
  return value;
}

function validCreditDate(value?: Date): Date {
  const date = value ? new Date(value.getTime()) : new Date();
  if (!Number.isFinite(date.getTime())) throw new TypeError("now must be a valid Date");
  return date;
}

function validCreditTtl(value = DEFAULT_CREDIT_RESERVATION_TTL_MS): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_CREDIT_RESERVATION_TTL_MS) {
    throw new TypeError(`ttlMs must be an integer between 1 and ${MAX_CREDIT_RESERVATION_TTL_MS}`);
  }
  return value;
}

function validLlmUsage(usage: LlmUsageInfo): LlmUsageInfo {
  const integers = [usage.promptTokens, usage.completionTokens, usage.totalTokens];
  if (integers.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new TypeError("LLM usage tokens must be non-negative integers");
  }
  if (usage.totalTokens < usage.promptTokens || usage.totalTokens < usage.completionTokens) {
    throw new TypeError("LLM totalTokens must cover prompt and completion tokens");
  }
  return { ...usage, model: requiredCreditKey(usage.model, "usage.model") };
}

function normalizeReservation(row: {
  id: string;
  reservationKey: string;
  operationKey: string | null;
  userId: string;
  scene: string;
  estimatedCredits: number;
  remainingCredits: number;
  actualCredits: number;
  maxAdditionalCredits: number;
  additionalCredits: number;
  status: string;
  expiresAt: Date;
  reversedAt: Date | null;
}, duplicate: boolean): CreditReservationSnapshot {
  const status = row.status;
  if (status !== "active" && status !== "settled" && status !== "refunded" && status !== "expired" && status !== "reversed") {
    throw new Error(`Invalid CreditReservation status: ${status}`);
  }
  return {
    id: row.id,
    reservationKey: row.reservationKey,
    operationKey: row.operationKey,
    userId: row.userId,
    scene: validScene(row.scene),
    estimatedCredits: row.estimatedCredits,
    remainingCredits: row.remainingCredits,
    actualCredits: row.actualCredits,
    maxAdditionalCredits: row.maxAdditionalCredits,
    additionalCredits: row.additionalCredits,
    status,
    expiresAt: row.expiresAt,
    reversedAt: row.reversedAt,
    duplicate,
  };
}

function assertMatchingReservation(
  row: { operationKey: string | null; userId: string; scene: string; estimatedCredits: number; maxAdditionalCredits: number },
  expected: { operationKey: string | null; userId: string; scene: Scene; estimatedCredits: number; maxAdditionalCredits: number },
): void {
  if (
    row.operationKey !== expected.operationKey
    || row.userId !== expected.userId
    || row.scene !== expected.scene
    || row.estimatedCredits !== expected.estimatedCredits
    || row.maxAdditionalCredits !== expected.maxAdditionalCredits
  ) {
    throw new AppError("reservationKey 已被不同参数占用", 409);
  }
}

interface DuplicateSettlementRow {
  usageId: unknown;
  reservationId: unknown;
  actualCredits: unknown;
  estimatedCredits: unknown;
  additionalCredits: unknown;
  balanceAfter: unknown;
}

async function readDuplicateSettlement(
  db: Pick<PrismaClient, "$queryRaw">,
  reservationId: string,
  idempotencyKey: string,
): Promise<CreditSettlement | null> {
  const rows = await db.$queryRaw<DuplicateSettlementRow[]>(Prisma.sql`
    SELECT
      u."id" AS "usageId",
      u."reservationId" AS "reservationId",
      u."creditCost" AS "actualCredits",
      r."estimatedCredits" AS "estimatedCredits",
      r."additionalCredits" AS "additionalCredits",
      COALESCE(
        MAX(CASE WHEN l."type" IN ('llm_settle_extra', 'llm_reserve_refund') THEN l."balanceAfter" END),
        MAX(CASE WHEN l."type" = 'llm_reserve' THEN l."balanceAfter" END)
      ) AS "balanceAfter"
    FROM "LlmUsage" u
    JOIN "CreditReservation" r ON r."id" = u."reservationId"
    JOIN "CreditLedger" l ON l."refId" = r."id"
    WHERE u."idempotencyKey" = ${idempotencyKey}
    GROUP BY u."id", u."reservationId", u."creditCost", r."estimatedCredits", r."additionalCredits"
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  if (String(row.reservationId) !== reservationId) {
    throw new AppError("idempotencyKey 已被另一笔预占使用", 409);
  }
  const actualCredits = Number(row.actualCredits);
  const estimatedCredits = Number(row.estimatedCredits);
  const additionalCredits = Number(row.additionalCredits);
  const chargedFromReservation = actualCredits - additionalCredits;
  return {
    reservationId,
    usageId: String(row.usageId),
    idempotencyKey,
    actualCredits,
    chargedFromReservation,
    additionalCredits,
    refundedCredits: estimatedCredits - chargedFromReservation,
    // 必须返回首次结算时的不可变快照，不能回读当前账户余额；
    // 否则结算后的任意充值/消费都会让同一 idempotencyKey 返回不同 DTO。
    balanceAfter: Number(row.balanceAfter),
    duplicate: true,
  };
}

function isPrismaUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function normalizeCreditReason(value: string): string {
  if (typeof value !== "string") throw new TypeError("reason must be a string");
  const normalized = value.trim();
  return (normalized || "AI 调用未完成").slice(0, 500);
}
