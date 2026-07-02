import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { SubscriptionCard } from "@/components/SubscriptionCard";
import { TrackView } from "@/components/TrackView";
import { trackLabel, FUTURE_TRACKS } from "@/lib/tracks";
import { Badge } from "@/components/ui";

export const metadata = { title: "订阅方案" };

const RIGHTS = [
  { name: "试看首章", free: "是", premium: "是", expired: "是" },
  { name: "课程目录", free: "是", premium: "是", expired: "是" },
  { name: "订阅赛道课程", free: "—", premium: "是", expired: "—" },
  { name: "本周上新", free: "可浏览", premium: "可学习", expired: "可浏览" },
  { name: "直播小班课", free: "—", premium: "是", expired: "—" },
  { name: "需求投票", free: "—", premium: "是", expired: "—" },
  { name: "笔记创建", free: "3 篇", premium: "无限", expired: "仅查看" },
];

export default async function PricingPage() {
  const user = await getCurrentUser();
  const snapshot = await resolveEntitlement(user?.id ?? null);
  const plans = await prisma.plan.findMany({ where: { isActive: true }, orderBy: { priceCents: "asc" } });

  // 全站会员：主推连续包月 + 年卡 + 季卡；单月弱锚点
  const fullPlans = plans.filter((p) => p.scope === "all" && p.billingPeriod !== "month");
  const anchor = plans.find((p) => p.scope === "all" && p.billingPeriod === "month");
  const trackPlans = plans.filter((p) => p.scope !== "all");

  return (
    <div className="space-y-14 py-4">
      <TrackView event="paywall_view" properties={{ trigger: "pricing_page" }} />
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-ink-950">按需订阅，自由组合</h1>
        <p className="mt-2 text-ink-500">全站畅学，或只订你要的赛道 · 笔记永久保留 · 随时可取消</p>
        {snapshot.isSubscriber && (
          <p className="mt-3 inline-block rounded-full bg-success/10 px-4 py-1.5 text-sm text-success">
            你已订阅（{snapshot.accessibleTracks === "all" ? "全站" : snapshot.accessibleTracks.map(trackLabel).join("、")}），有效至 {snapshot.validUntil ? new Date(snapshot.validUntil).toLocaleDateString("zh-CN") : ""}
          </p>
        )}
      </div>

      {/* 全站会员 */}
      <section>
        <div className="mb-5 text-center">
          <h2 className="text-xl font-semibold text-ink-950">全站会员</h2>
          <p className="mt-1 text-sm text-ink-500">一次订阅，解锁全部赛道</p>
        </div>
        <div className="mx-auto grid max-w-3xl gap-5 sm:grid-cols-3">
          {fullPlans.map((p) => <SubscriptionCard key={p.id} plan={p} isLoggedIn={!!user} redirectTo="/me/subscription" />)}
        </div>
        {anchor && (
          <p className="mt-4 text-center text-sm text-ink-400">
            也可选择全站单月 ¥{(anchor.priceCents / 100).toFixed(0)}/月（不含首月优惠）
          </p>
        )}
      </section>

      {/* 单赛道会员 */}
      <section>
        <div className="mb-5 text-center">
          <h2 className="text-xl font-semibold text-ink-950">单赛道会员</h2>
          <p className="mt-1 text-sm text-ink-500">低门槛切入，只学你需要的方向</p>
        </div>
        <div className="mx-auto grid max-w-3xl gap-5 sm:grid-cols-3">
          {trackPlans.map((p) => <SubscriptionCard key={p.id} plan={p} isLoggedIn={!!user} redirectTo="/me/subscription" />)}
        </div>
      </section>

      {/* 未来赛道 */}
      <section className="text-center">
        <p className="text-sm text-ink-400">即将上线更多赛道：</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {FUTURE_TRACKS.map((t) => <Badge key={t.key} tone="muted">{t.label}</Badge>)}
        </div>
      </section>

      {/* 权益对比 */}
      <section className="mx-auto max-w-2xl">
        <h2 className="mb-4 text-center text-xl font-semibold text-ink-950">权益对比</h2>
        <div className="overflow-hidden rounded-2xl border border-ink-100 bg-paper-raised">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100 text-ink-500">
                <th className="px-4 py-3 text-left font-medium">权益</th>
                <th className="px-4 py-3 text-center font-medium">免费</th>
                <th className="px-4 py-3 text-center font-medium text-tide-700">订阅</th>
                <th className="px-4 py-3 text-center font-medium">到期</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {RIGHTS.map((r) => (
                <tr key={r.name}>
                  <td className="px-4 py-3 text-ink-800">{r.name}</td>
                  <td className="px-4 py-3 text-center text-ink-400">{r.free}</td>
                  <td className="px-4 py-3 text-center font-medium text-tide-700">{r.premium}</td>
                  <td className="px-4 py-3 text-center text-ink-400">{r.expired}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-center text-xs text-ink-400">
          停订后课程锁定，但笔记永久保留、可查看。健康类内容仅供健康信息素养学习。
        </p>
      </section>
    </div>
  );
}
