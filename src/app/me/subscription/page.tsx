import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  CrownSimple,
  Receipt,
  Sparkle,
  WarningCircle,
  ShieldCheck,
} from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement, STATUS_LABELS } from "@/lib/entitlement";
import { prisma } from "@/lib/db";
import { CancelSubscription, RestoreButton } from "@/components/AccountActions";
import { ChangePlanButton } from "@/components/SubscriptionManager";
import { RedeemBox } from "@/components/RedeemBox";
import { WaveProgress, TidalReveal } from "@/components/motion";
import { yuan, PLAN_PERIOD_LABELS } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "订阅管理" };

/** 状态语义 tone 到功能色的映射（完课/成功→ok，警示→warn，其余→中性）。 */
function toneStyles(tone: string): { bg: string; text: string; dot: string } {
  if (tone === "ok") return { bg: "bg-[var(--ok-soft)]", text: "text-[var(--ok)]", dot: "bg-[var(--ok)]" };
  if (tone === "warn") return { bg: "bg-[var(--warn-soft)]", text: "text-[var(--warn)]", dot: "bg-[var(--warn)]" };
  return { bg: "bg-[var(--surface-inset)]", text: "text-[var(--ink3)]", dot: "bg-[var(--ink4)]" };
}

export default async function SubscriptionPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/me/subscription");

  const [snapshot, subscription, orders, plans] = await Promise.all([
    resolveEntitlement(user.id),
    prisma.subscription.findFirst({ where: { userId: user.id }, orderBy: { currentPeriodEnd: "desc" }, include: { plan: true } }),
    prisma.order.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, include: { plan: true } }),
    prisma.plan.findMany({ where: { isActive: true }, orderBy: { priceCents: "asc" } }),
  ]);

  const meta = STATUS_LABELS[snapshot.subscriptionStatus] ?? STATUS_LABELS.free;
  const statusTone = toneStyles(meta.tone);
  const canCancel = ["active", "trial", "grace_period"].includes(snapshot.subscriptionStatus);
  const canChange = ["active", "trial", "grace_period", "canceled_but_active"].includes(snapshot.subscriptionStatus);

  // 周期已过占比（WaveProgress 展示剩余），0~100
  let elapsedPct = 0;
  let daysLeft = 0;
  if (subscription) {
    const start = new Date(subscription.currentPeriodStart).getTime();
    const end = new Date(subscription.currentPeriodEnd).getTime();
    const now = Date.now();
    const total = Math.max(1, end - start);
    elapsedPct = Math.min(100, Math.max(0, Math.round(((now - start) / total) * 100)));
    daysLeft = Math.max(0, Math.ceil((end - now) / 864e5));
  }
  const switchablePlans = plans
    .filter((p) => p.id !== subscription?.planId)
    .map((p) => ({ id: p.id, name: p.name, billingPeriod: p.billingPeriod, priceCents: p.priceCents, scope: p.scope }));

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-4">
      <Link
        href="/me"
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--ink3)] transition-colors hover:text-[var(--ink)]"
      >
        <ArrowLeft size={14} weight="bold" /> 成长档案
      </Link>
      <h1 className="text-[24px] font-bold text-[var(--ink)]">订阅管理</h1>

      {/* 当前状态：主卡用 --card + 内顶高光材质，订阅中头部铺深色渐变叙事 */}
      <TidalReveal>
        <section className="studio-rise overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card),var(--inner-hi)]">
          {subscription ? (
            <>
              {/* 深色权益头：渐变 + 柔光，不是死黑平面 */}
              <div className="relative overflow-hidden px-6 py-5 text-white" style={{ background: "var(--video-grad)" }}>
                <div
                  className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full bg-[var(--red)] opacity-25 blur-[2px]"
                  aria-hidden
                />
                <div className="relative flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-9 w-9 place-items-center rounded-[12px] bg-white/12 text-[var(--red)] ring-1 ring-white/10">
                      <CrownSimple size={18} weight="fill" />
                    </span>
                    <div>
                      <div className="mono text-[10px] uppercase tracking-[0.14em] text-white/50">MEMBERSHIP</div>
                      <div className="text-[16px] font-bold leading-tight">{subscription.plan.name}</div>
                    </div>
                  </div>
                  <span className="mono inline-flex items-center gap-1.5 rounded-full bg-white/12 px-2.5 py-1 text-[11px] font-semibold text-white ring-1 ring-white/10">
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${meta.tone === "ok" ? "bg-[var(--ok)] brightness-125" : meta.tone === "warn" ? "bg-[var(--warn)] brightness-125" : "bg-white/60"}`} />
                    {meta.label}
                  </span>
                </div>

                {/* 周期剩余可视化（涨潮进度） */}
                <div className="relative mt-5">
                  <div className="mb-1.5 flex items-center justify-between text-[12px] text-white/60">
                    <span>本周期进度</span>
                    <span className="mono">还剩 {daysLeft} 天</span>
                  </div>
                  <WaveProgress value={elapsedPct} height={10} />
                </div>
              </div>

              {/* 明细行 */}
              <div className="space-y-1 p-6 pt-5">
                <Row label="套餐" value={subscription.plan.name} />
                <Row label="周期" value={PLAN_PERIOD_LABELS[subscription.plan.billingPeriod] ?? subscription.plan.billingPeriod} />
                <Row label="有效至" value={new Date(subscription.currentPeriodEnd).toLocaleDateString("zh-CN")} mono />
                <Row label="到期后自动续费" value={subscription.cancelAtPeriodEnd ? "否" : "是"} />

                {canChange && switchablePlans.length > 0 && (
                  <div className="mt-5 border-t border-[var(--border)] pt-4">
                    <ChangePlanButton
                      currentPriceCents={subscription.plan.priceCents}
                      currentPlanId={subscription.planId}
                      plans={switchablePlans}
                    />
                  </div>
                )}

                {snapshot.subscriptionStatus === "billing_retry" && (
                  <div className="mt-4 flex items-start gap-2 rounded-[12px] border border-[var(--warn-soft)] bg-[var(--warn-soft)] p-3 text-[13px] text-[var(--warn)]">
                    <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0" />
                    扣款失败，请更新支付方式后重试。
                  </div>
                )}

                {/* 取消 / 恢复（§6.7） */}
                <div className="mt-5 flex items-center justify-between border-t border-[var(--border)] pt-4">
                  <RestoreButton />
                  {canCancel && <CancelSubscription />}
                </div>
              </div>
            </>
          ) : (
            // 无订阅：有设计感的引导构图（图形 + 语义色徽章 + CTA），非灰图标一行字
            <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
              <span className="grid h-16 w-16 place-items-center rounded-[18px] bg-[var(--red-soft)] text-[var(--red)] shadow-[var(--inner-hi)]">
                <CrownSimple size={30} weight="fill" />
              </span>
              <div>
                <div className="mb-2 flex items-center justify-center gap-2">
                  <span className={`mono inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusTone.bg} ${statusTone.text}`}>
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusTone.dot}`} />
                    {meta.label}
                  </span>
                </div>
                <p className="text-[16px] font-bold text-[var(--ink)]">你还没有订阅</p>
                <p className="mx-auto mt-1.5 max-w-[300px] text-[13px] leading-[1.6] text-[var(--ink3)]">
                  订阅后解锁全站课程与投票权益，随时可取消，笔记永久保留。
                </p>
              </div>
              <Link
                href="/pricing"
                className="cta-glow studio-press inline-flex items-center gap-2 rounded-[14px] bg-[var(--red)] px-6 py-3 text-[14px] font-bold text-white transition-all hover:brightness-105"
              >
                <Sparkle size={16} weight="fill" />
                查看订阅方案
              </Link>
            </div>
          )}
        </section>
      </TidalReveal>

      {/* 停订承诺：用 info 语义色柔性提示，而非灰底 */}
      <p className="flex items-start gap-2 rounded-[14px] border border-[var(--info-soft)] bg-[var(--info-soft)] px-4 py-3 text-[13px] leading-[1.6] text-[var(--info)]">
        <ShieldCheck size={16} weight="fill" className="mt-0.5 shrink-0" />
        取消订阅后：课程锁定，但笔记永久保留、可继续查看和导出。这是我们的承诺。
      </p>

      {/* 兑换码入口 */}
      <RedeemBox />

      {/* 账单历史 */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-[15px] font-bold text-[var(--ink)]">
          <Receipt size={16} weight="fill" className="text-[var(--ink3)]" />
          账单历史
        </h2>
        {orders.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed border-[var(--border2)] bg-[var(--surface)] px-6 py-10 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-[14px] bg-[var(--surface-inset)] text-[var(--ink4)]">
              <Receipt size={20} weight="light" />
            </span>
            <p className="text-[13px] text-[var(--ink3)]">暂无订单，订阅后账单会出现在这里</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card)]">
            <ul className="stagger divide-y divide-[var(--border)]">
              {orders.map((o, i) => {
                const paid = o.status === "paid";
                const refunded = o.status === "refunded";
                const badge = paid
                  ? { bg: "bg-[var(--ok-soft)]", text: "text-[var(--ok)]", label: "已支付" }
                  : refunded
                    ? { bg: "bg-[var(--surface-inset)]", text: "text-[var(--ink3)]", label: "已退款" }
                    : o.status === "pending"
                      ? { bg: "bg-[var(--warn-soft)]", text: "text-[var(--warn)]", label: "待支付" }
                      : { bg: "bg-[var(--red-soft)]", text: "text-[var(--red-ink)]", label: "失败" };
                return (
                  <li
                    key={o.id}
                    style={{ "--i": i } as React.CSSProperties}
                    className="flex items-center justify-between gap-4 px-4 py-3.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-semibold text-[var(--ink)]">{o.plan.name}</p>
                      <p className="mono mt-0.5 text-[11px] text-[var(--ink4)]">
                        {new Date(o.createdAt).toLocaleString("zh-CN")} · {o.channel}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="mono text-[15px] font-bold text-[var(--ink)]">¥{yuan(o.amountCents)}</p>
                      <span className={`mono mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.bg} ${badge.text}`}>
                        {badge.label}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-[13px] text-[var(--ink3)]">{label}</span>
      <span className={`text-[14px] font-semibold text-[var(--ink)] ${mono ? "mono" : ""}`}>{value}</span>
    </div>
  );
}
