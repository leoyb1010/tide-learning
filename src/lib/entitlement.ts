import { cache } from "react";
import { prisma } from "./db";
import { monthlyGrantForPlan } from "./credits";

/**
 * Entitlement 状态机与权益快照 — 计划书 v0.3 §7.3 + 有道融合（分赛道订阅）。
 *
 * 核心原则：
 *   - 权益判断只在服务端，客户端只展示 snapshot。
 *   - 订单/订阅/权益分表，从 subscriptions 归约出权益快照。
 *   - 支持"全站会员"与"单赛道会员"并存：accessibleTracks = "all" | 赛道 key 列表。
 */

export type SubscriptionStatus =
  | "trial" | "active" | "grace_period" | "billing_retry"
  | "canceled_but_active" | "expired" | "refunded" | "revoked";

// §6.7 订阅状态展示文案
export const STATUS_LABELS: Record<string, { label: string; tone: "ok" | "warn" | "muted" }> = {
  free: { label: "当前为免费用户", tone: "muted" },
  active: { label: "已订阅", tone: "ok" },
  trial: { label: "试用中，到期将自动续费", tone: "ok" },
  grace_period: { label: "续费处理中，权益暂时保留", tone: "warn" },
  billing_retry: { label: "扣款失败，请更新支付方式", tone: "warn" },
  canceled_but_active: { label: "已取消，权益保留至本周期结束", tone: "warn" },
  expired: { label: "订阅已到期，课程已锁定，笔记仍可查看", tone: "muted" },
  refunded: { label: "订单已退款，订阅权益已关闭", tone: "muted" },
  revoked: { label: "权益已撤销，如有疑问联系客服", tone: "muted" },
};

const PREMIUM_STATUSES = new Set(["trial", "active", "grace_period", "canceled_but_active"]);

export interface EntitlementSnapshot {
  isSubscriber: boolean;                      // 是否有任一有效订阅
  accessLevel: "free" | "premium" | "family_member";
  accessibleTracks: "all" | string[];         // 可学习的赛道（分赛道订阅）
  subscriptionStatus: string;
  statusLabel: string;
  statusTone: "ok" | "warn" | "muted";
  validUntil: string | null;
  canVote: boolean;
  canCreateNoteUnlimited: boolean;
  noteFreeLimit: number;
  canUseLLM: boolean;                          // AI 能力权益（当前 = isSubscriber，未来可细分套餐）
  monthlyGrant: number;                        // v3.0：当前档位每月赠送积分（免费=0）；订阅页/积分卡展示「每月赠 N 积分」
}

export const FREE_SNAPSHOT: EntitlementSnapshot = {
  isSubscriber: false,
  accessLevel: "free",
  accessibleTracks: [],
  subscriptionStatus: "free",
  statusLabel: STATUS_LABELS.free.label,
  statusTone: "muted",
  validUntil: null,
  canVote: false,
  canCreateNoteUnlimited: false,
  noteFreeLimit: 3,
  canUseLLM: false,
  monthlyGrant: 0,
};

/**
 * 过期订阅落库的「节流」表：userId → 上次 sweep 时间戳（毫秒）。
 * 同一用户 5 分钟内不重复写库；快照正确性不依赖此写（读时在内存判断过期），
 * 写库只是为了让持久化状态最终一致（DB status 收敛到 expired）。
 */
const SWEEP_THROTTLE_MS = 5 * 60 * 1000;
const lastSweepAt = new Map<string, number>();

/** 已过期但 DB 仍标为「有效态」的付费状态 —— 内存判断过期时视为 expired。 */
const SWEEPABLE_STATUSES = ["active", "grace_period", "billing_retry", "canceled_but_active", "trial"];

/**
 * 节流地把过期订阅落库为 expired。不 await 也不阻塞快照返回；
 * 5 分钟内同一用户只写一次，失败静默（下次请求再试）。
 */
function throttledSweepExpired(userId: string, now: Date): void {
  const nowMs = now.getTime();
  const last = lastSweepAt.get(userId) ?? 0;
  if (nowMs - last < SWEEP_THROTTLE_MS) return;
  lastSweepAt.set(userId, nowMs);
  prisma.subscription
    .updateMany({
      where: {
        userId,
        status: { in: SWEEPABLE_STATUSES },
        currentPeriodEnd: { lt: now },
      },
      data: { status: "expired" },
    })
    .catch(() => {
      // 落库失败不影响本次快照；重置节流让下次请求重试
      lastSweepAt.delete(userId);
    });
}

/**
 * 权益快照解析。用 React cache() 去重：同一请求内 layout 与 page 各调一次时只查一次库。
 * 关键：不再每次调用都写库 —— 过期判断在内存完成（currentPeriodEnd < now 即视为 expired），
 * 持久化落库改为节流（见 throttledSweepExpired）。canAccessLesson/snapshot 行为保持不变。
 */
export const resolveEntitlement = cache(async (userId: string | null | undefined): Promise<EntitlementSnapshot> => {
  if (!userId) return FREE_SNAPSHOT;
  const now = new Date();

  const subs = await prisma.subscription.findMany({
    where: { userId },
    orderBy: { currentPeriodEnd: "desc" },
    // v3.0：带出 plan.billingPeriod 以派生档位月赠额度（scope 优先用订阅快照，plan 作兜底）。
    include: { plan: { select: { billingPeriod: true, scope: true } } },
  });

  // 读时内存判断：付费态且未过期才算有效；过期的付费态在下方 latest 分支按 expired 呈现。
  const activeSubs = subs.filter((s) => PREMIUM_STATUSES.has(s.status) && s.currentPeriodEnd >= now);

  // 节流落库（不阻塞返回）：把 DB 里过期的有效态收敛为 expired。
  throttledSweepExpired(userId, now);

  if (activeSubs.length > 0) {
    // 覆盖赛道：任一全站订阅 → "all"，否则为各单赛道 scope 的并集
    const hasAll = activeSubs.some((s) => s.scope === "all");
    const accessibleTracks: "all" | string[] = hasAll
      ? "all"
      : Array.from(new Set(activeSubs.map((s) => s.scope)));

    // 主订阅（用于状态/有效期展示）：优先全站，其次有效期最长
    const primary = activeSubs.find((s) => s.scope === "all") ?? activeSubs[0];
    const meta = STATUS_LABELS[primary.status] ?? STATUS_LABELS.active;

    // v3.0：档位月赠额度。scope 优先用订阅快照（更贴近购买当时），billingPeriod 取自 plan。
    const monthlyGrant = monthlyGrantForPlan({
      billingPeriod: primary.plan?.billingPeriod,
      scope: primary.scope ?? primary.plan?.scope,
    });

    const snapshot: EntitlementSnapshot = {
      isSubscriber: true,
      accessLevel: "premium",
      accessibleTracks,
      subscriptionStatus: primary.status,
      statusLabel: meta.label,
      statusTone: meta.tone,
      validUntil: primary.currentPeriodEnd.toISOString(),
      canVote: true,
      canCreateNoteUnlimited: true,
      noteFreeLimit: 3,
      canUseLLM: true,
      monthlyGrant,
    };
    await persistSnapshot(userId, primary.id, "active", snapshot);
    return snapshot;
  }

  const latest = subs[0];
  if (latest) {
    // 读时内存判断：DB 里仍是「有效付费态」但已过期的，对外呈现为 expired
    // （等价于旧逻辑先 updateMany 再读回的效果，但不写库）。
    const status =
      SWEEPABLE_STATUSES.includes(latest.status) && latest.currentPeriodEnd < now
        ? "expired"
        : latest.status;
    const meta = STATUS_LABELS[status] ?? STATUS_LABELS.expired;
    const snapshot: EntitlementSnapshot = {
      ...FREE_SNAPSHOT,
      subscriptionStatus: status,
      statusLabel: meta.label,
      statusTone: meta.tone,
      validUntil: latest.currentPeriodEnd.toISOString(),
    };
    await persistSnapshot(userId, latest.id, "expired", snapshot);
    return snapshot;
  }

  return FREE_SNAPSHOT;
});

async function persistSnapshot(userId: string, subscriptionId: string | null, status: string, snapshot: EntitlementSnapshot) {
  const data = {
    status,
    accessLevel: snapshot.accessLevel,
    validUntil: snapshot.validUntil ? new Date(snapshot.validUntil) : null,
    snapshotJson: JSON.stringify(snapshot),
  };
  // 非 null：靠 @@unique([userId, sourceSubscriptionId]) 复合唯一键原子 upsert，杜绝并发 check-then-act 写重复快照行。
  if (subscriptionId) {
    await prisma.entitlement.upsert({
      where: { userId_sourceSubscriptionId: { userId, sourceSubscriptionId: subscriptionId } },
      update: data,
      create: { userId, sourceSubscriptionId: subscriptionId, ...data },
    });
    return;
  }
  // null 分支：SQLite 唯一键不能用 NULL 定位（多 NULL 并存），退回 check-then-act。
  // 现有调用方 subscriptionId 恒非 null，此分支仅为防御性兜底。
  const existing = await prisma.entitlement.findFirst({ where: { userId, sourceSubscriptionId: null } });
  if (existing) await prisma.entitlement.update({ where: { id: existing.id }, data });
  else await prisma.entitlement.create({ data: { userId, sourceSubscriptionId: null, ...data } });
}

/** 是否可访问某赛道（全站 or 该赛道单订阅）。 */
export function canAccessTrack(track: string, snapshot: EntitlementSnapshot): boolean {
  if (snapshot.accessibleTracks === "all") return true;
  return snapshot.accessibleTracks.includes(track);
}

/** 服务端判断某章节是否可学：免费章节任何人可学；付费章节需订阅且覆盖该赛道。 */
export function canAccessLesson(track: string, isFree: boolean, snapshot: EntitlementSnapshot): boolean {
  return isFree || canAccessTrack(track, snapshot);
}
