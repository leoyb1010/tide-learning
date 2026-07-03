import { cache } from "react";
import { prisma } from "./db";
import { AppError } from "./api";
import type { LlmUsageInfo } from "./llm";

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
const SCENE_WEIGHT: Record<string, number> = {
  generate_course: 1.0,
  generate_lesson: 1.0,
  import_source: 1.0,
  generate_exam: 1.0,
  note_transform: 0.8,
  note_summary: 0.8,
  companion: 0.5, // 伴侣问答低价，鼓励多问
  search_expand: 0.2,
};
export const SIGNUP_BONUS = 100; // 注册赠送
export const MONTHLY_GRANT = 500; // 订阅用户每月赠送

/** Token 用量 → 积分（向上取整，至少 1 分，避免零成本刷调用）。 */
export function tokensToCredits(usage: LlmUsageInfo, scene: string): number {
  const weight = SCENE_WEIGHT[scene] ?? 1.0;
  const raw = (usage.totalTokens / TOKENS_PER_CREDIT) * weight;
  return Math.max(1, Math.ceil(raw));
}

/** 预估某场景一次调用的积分（UI 展示"本次约消耗 ~N 积分"，按典型 token 量估算）。 */
export function estimateCredits(scene: string, approxTokens = 3000): number {
  return tokensToCredits({ promptTokens: 0, completionTokens: 0, totalTokens: approxTokens }, scene);
}

/** 读余额（React cache 去重）。无账户视为 0。 */
export const getBalance = cache(async (userId: string): Promise<number> => {
  const acc = await prisma.creditAccount.findUnique({ where: { userId }, select: { balance: true } });
  return acc?.balance ?? 0;
});

/** 确保账户存在（首次访问惰性创建 + 注册赠送）。返回账户。 */
export async function ensureAccount(userId: string) {
  const existing = await prisma.creditAccount.findUnique({ where: { userId } });
  if (existing) return existing;
  // 首建：送注册积分（记流水）
  return prisma.$transaction(async (tx) => {
    const created = await tx.creditAccount.create({
      data: { userId, balance: SIGNUP_BONUS, totalEarned: SIGNUP_BONUS },
    });
    await tx.creditLedger.create({
      data: { userId, delta: SIGNUP_BONUS, type: "signup_bonus", balanceAfter: SIGNUP_BONUS, reason: "注册赠送" },
    });
    return created;
  });
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
    const acc = await tx.creditAccount.findUniqueOrThrow({ where: { userId } });
    const balanceAfter = acc.balance + amount;
    await tx.creditAccount.update({
      where: { userId },
      data: { balance: balanceAfter, totalEarned: acc.totalEarned + amount },
    });
    await tx.creditLedger.create({
      data: { userId, delta: amount, type, refId: opts.refId, reason: opts.reason, balanceAfter },
    });
    return balanceAfter;
  });
}

/**
 * 预检余额。默认要求 > 0（有余额即可开始）；传 scene 时用该场景的最坏估算成本设门槛，
 * 堵住「余额 1 分换任意大额生成」的超额免单缺口（HIGH-1）。余额可为负（欠账），负数必被拦。
 */
export async function assertCanSpend(userId: string, scene?: string): Promise<void> {
  const balance = await getBalance(userId);
  // 场景已知则按最坏成本设门槛，否则最低 1 分
  const threshold = scene ? estimateCredits(scene) : 1;
  if (balance < threshold) {
    throw new AppError("积分不足，充值后可继续使用 AI 能力", 402);
  }
}

/**
 * 记录 LLM 用量并扣费（原子）。写 LlmUsage + 扣余额 + 写流水。
 * v2.3 修复：允许扣成负余额（欠账）——AI 已产生真实成本不能回滚已生成内容，
 * 记全额欠账，下次 assertCanSpend 因余额<门槛自然拦截（不再"超出部分免单"）。
 * 返回本次实扣积分。失败落 AuditLog 可对账（不再静默丢失）。
 */
export async function recordLlmSpend(userId: string, usage: LlmUsageInfo, scene: string): Promise<number> {
  const cost = tokensToCredits(usage, scene);
  try {
    return await prisma.$transaction(async (tx) => {
      const acc = await tx.creditAccount.findUnique({ where: { userId } });
      const balance = acc?.balance ?? 0;
      // 全额扣（允许负余额=欠账）：AI 已产生成本，不能免单；欠账下次被 assertCanSpend 拦。
      const balanceAfter = balance - cost;
      if (acc) {
        await tx.creditAccount.update({
          where: { userId },
          data: { balance: balanceAfter, totalSpent: acc.totalSpent + cost },
        });
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
        data: { userId, delta: -cost, type: "llm_spend", refId: scene, balanceAfter, reason: `AI·${scene}` },
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
 */
export async function ensureMonthlyGrant(userId: string, monthKey: string, isSubscriber: boolean): Promise<void> {
  if (!isSubscriber) return;
  const acc = await ensureAccount(userId);
  if (acc.monthlyGrantKey === monthKey) return; // 本月已发
  await prisma.$transaction(async (tx) => {
    // 事务内二次确认，防并发重复发放
    const fresh = await tx.creditAccount.findUniqueOrThrow({ where: { userId } });
    if (fresh.monthlyGrantKey === monthKey) return;
    const balanceAfter = fresh.balance + MONTHLY_GRANT;
    await tx.creditAccount.update({
      where: { userId },
      data: { balance: balanceAfter, totalEarned: fresh.totalEarned + MONTHLY_GRANT, monthlyGrantKey: monthKey },
    });
    await tx.creditLedger.create({
      data: { userId, delta: MONTHLY_GRANT, type: "monthly_grant", refId: monthKey, balanceAfter, reason: `${monthKey} 会员月度积分` },
    });
  });
}

/** 便捷 helper：把 llm.ts 的 onUsage 回调直接对接到记账。 */
export function creditingOnUsage(userId: string, scene: string) {
  return (usage: LlmUsageInfo) => {
    void recordLlmSpend(userId, usage, scene);
  };
}
