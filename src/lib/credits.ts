import { cache } from "react";
import { after } from "next/server";
import { prisma } from "./db";
import { AppError } from "./errors";
import type { LlmUsageInfo } from "./llm";
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
  generate_lesson: 1.0,
  generate_lesson_html: 1.5, // v3.3 HTML 课件 LLM 增强：token 重于逐节块生成，权重上调
  import_source: 1.0,
  generate_exam: 1.0,
  review_card: 0.8, // 复习卡批量生成（原借用 note_transform 权重，现独立成键）
  note_transform: 0.8,
  note_summary: 0.8,
  companion: 0.5, // 伴侣问答低价，鼓励多问
  search_expand: 0.2,
} as const;

/** 记账场景：SCENE_WEIGHT 的键集合。新增出口须先在 SCENE_WEIGHT 补键，否则 call site 报错。 */
export type Scene = keyof typeof SCENE_WEIGHT;

/**
 * 各场景「一次调用的典型输出 token 量」——仅用于预检门槛(estimateCredits/assertCanSpend)的最坏成本估算。
 * 修复(2026-07-12 P1-3)：此前预检写死 3000 token，严重低估逐节/HTML 精修的真实用量
 * （逐节 maxTokens 8000、bespoke HTML 16000），使门槛远低于实扣、放行超额免单。
 * 这里按各出口真实 maxTokens 量级取值，让门槛贴近真实成本；实际记账仍以真实 token 为准，此表不影响记账。
 */
const SCENE_TYPICAL_TOKENS: Record<Scene, number> = {
  generate_course: 4000, // 大纲
  generate_lesson: 8000, // 逐节块
  generate_lesson_html: 16000, // bespoke HTML 精修
  import_source: 6000,
  generate_exam: 4000,
  review_card: 3000,
  note_transform: 3000,
  note_summary: 3000,
  companion: 2000,
  search_expand: 1000,
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
 * 便捷 helper：把 llm.ts 的 onUsage 回调直接对接到记账。
 * P2-2：改用 Next 的 after()——onUsage 常在流式生成过程中触发，此时用 fire-and-forget 的 void
 * 记账可能随响应返回被打断而丢账。after() 保证「响应体返回后」仍在同一请求生命周期内落账。
 * 兜底：after() 仅在请求作用域内可用；若在无请求上下文（脚本/嵌套 after 的后台续跑等）被调用会抛，
 * 此时退回原 void 直发，保证任何调用点都不因 after 不可用而崩。
 */
export function creditingOnUsage(userId: string, scene: Scene) {
  return (usage: LlmUsageInfo) => {
    try {
      after(() => {
        void recordLlmSpend(userId, usage, scene);
      });
    } catch {
      // 非请求作用域：after() 不可用，退回直发（recordLlmSpend 内部已自带失败落 AuditLog 兜底）。
      void recordLlmSpend(userId, usage, scene);
    }
  };
}
