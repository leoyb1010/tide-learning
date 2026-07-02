import { prisma } from "./db";

/**
 * Entitlement 状态机与权益快照 — 对应计划书 v0.3 §7.3。
 *
 * 核心原则（§17 技术要求 4 / §19 技术验收）：
 *   - 权益判断只在服务端，客户端只展示 snapshot。
 *   - 订单 / 订阅 / 权益分表，此处从 subscriptions 归约出 entitlement 快照。
 */

export type SubscriptionStatus =
  | "trial"
  | "active"
  | "grace_period"
  | "billing_retry"
  | "canceled_but_active"
  | "expired"
  | "refunded"
  | "revoked";

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

// 仍享有 premium 学习权益的状态
const PREMIUM_STATUSES = new Set(["trial", "active", "grace_period", "canceled_but_active"]);

export interface EntitlementSnapshot {
  isSubscriber: boolean;      // 是否可学习付费章节
  accessLevel: "free" | "premium" | "family_member";
  subscriptionStatus: string; // free / active / expired ...
  statusLabel: string;
  statusTone: "ok" | "warn" | "muted";
  validUntil: string | null;
  canVote: boolean;           // §7.2：仅订阅用户可投票
  canCreateNoteUnlimited: boolean;
  noteFreeLimit: number;      // 免费用户 3 篇（§7.2）
}

export const FREE_SNAPSHOT: EntitlementSnapshot = {
  isSubscriber: false,
  accessLevel: "free",
  subscriptionStatus: "free",
  statusLabel: STATUS_LABELS.free.label,
  statusTone: "muted",
  validUntil: null,
  canVote: false,
  canCreateNoteUnlimited: false,
  noteFreeLimit: 3,
};

/**
 * 归约用户当前权益：先把过期订阅落地为 expired，再取最优活跃订阅生成快照。
 * 每次读取都会顺带修正过期状态，保证客户端拿到的快照是权威的。
 */
export async function resolveEntitlement(userId: string | null | undefined): Promise<EntitlementSnapshot> {
  if (!userId) return FREE_SNAPSHOT;

  const now = new Date();

  // 到期但仍标记为 active/grace 的订阅 → expired
  await prisma.subscription.updateMany({
    where: {
      userId,
      status: { in: ["active", "grace_period", "billing_retry", "canceled_but_active", "trial"] },
      currentPeriodEnd: { lt: now },
    },
    data: { status: "expired" },
  });

  const subs = await prisma.subscription.findMany({
    where: { userId },
    orderBy: { currentPeriodEnd: "desc" },
  });

  const activeSub = subs.find(
    (s) => PREMIUM_STATUSES.has(s.status) && s.currentPeriodEnd >= now,
  );

  if (activeSub) {
    const snapshot: EntitlementSnapshot = {
      isSubscriber: true,
      accessLevel: "premium",
      subscriptionStatus: activeSub.status,
      statusLabel: (STATUS_LABELS[activeSub.status] ?? STATUS_LABELS.active).label,
      statusTone: (STATUS_LABELS[activeSub.status] ?? STATUS_LABELS.active).tone,
      validUntil: activeSub.currentPeriodEnd.toISOString(),
      canVote: true,
      canCreateNoteUnlimited: true,
      noteFreeLimit: 3,
    };
    await persistSnapshot(userId, activeSub.id, "active", snapshot);
    return snapshot;
  }

  // 无活跃订阅：区分 expired / refunded / revoked / 从未订阅
  const latest = subs[0];
  if (latest) {
    const status = latest.status; // expired / refunded / revoked
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

async function persistSnapshot(
  userId: string,
  subscriptionId: string,
  status: string,
  snapshot: EntitlementSnapshot,
) {
  const existing = await prisma.entitlement.findFirst({
    where: { userId, sourceSubscriptionId: subscriptionId },
  });
  const data = {
    status,
    accessLevel: snapshot.accessLevel,
    validUntil: snapshot.validUntil ? new Date(snapshot.validUntil) : null,
    snapshotJson: JSON.stringify(snapshot),
  };
  if (existing) {
    await prisma.entitlement.update({ where: { id: existing.id }, data });
  } else {
    await prisma.entitlement.create({
      data: { userId, sourceSubscriptionId: subscriptionId, ...data },
    });
  }
}

/** 服务端判断某章节是否可学：免费章节任何人可学，付费章节需订阅。 */
export function canAccessLesson(isFree: boolean, snapshot: EntitlementSnapshot): boolean {
  return isFree || snapshot.isSubscriber;
}
