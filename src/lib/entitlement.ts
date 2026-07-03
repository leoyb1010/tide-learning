import { prisma } from "./db";

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
};

export async function resolveEntitlement(userId: string | null | undefined): Promise<EntitlementSnapshot> {
  if (!userId) return FREE_SNAPSHOT;
  const now = new Date();

  await prisma.subscription.updateMany({
    where: {
      userId,
      status: { in: ["active", "grace_period", "billing_retry", "canceled_but_active", "trial"] },
      currentPeriodEnd: { lt: now },
    },
    data: { status: "expired" },
  });

  const subs = await prisma.subscription.findMany({ where: { userId }, orderBy: { currentPeriodEnd: "desc" } });
  const activeSubs = subs.filter((s) => PREMIUM_STATUSES.has(s.status) && s.currentPeriodEnd >= now);

  if (activeSubs.length > 0) {
    // 覆盖赛道：任一全站订阅 → "all"，否则为各单赛道 scope 的并集
    const hasAll = activeSubs.some((s) => s.scope === "all");
    const accessibleTracks: "all" | string[] = hasAll
      ? "all"
      : Array.from(new Set(activeSubs.map((s) => s.scope)));

    // 主订阅（用于状态/有效期展示）：优先全站，其次有效期最长
    const primary = activeSubs.find((s) => s.scope === "all") ?? activeSubs[0];
    const meta = STATUS_LABELS[primary.status] ?? STATUS_LABELS.active;

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
    };
    await persistSnapshot(userId, primary.id, "active", snapshot);
    return snapshot;
  }

  const latest = subs[0];
  if (latest) {
    const status = latest.status;
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
}

async function persistSnapshot(userId: string, subscriptionId: string, status: string, snapshot: EntitlementSnapshot) {
  const existing = await prisma.entitlement.findFirst({ where: { userId, sourceSubscriptionId: subscriptionId } });
  const data = {
    status,
    accessLevel: snapshot.accessLevel,
    validUntil: snapshot.validUntil ? new Date(snapshot.validUntil) : null,
    snapshotJson: JSON.stringify(snapshot),
  };
  if (existing) await prisma.entitlement.update({ where: { id: existing.id }, data });
  else await prisma.entitlement.create({ data: { userId, sourceSubscriptionId: subscriptionId, ...data } });
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
