import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { SubscriptionCard } from "@/components/SubscriptionCard";
import { TrackView } from "@/components/TrackView";

export const metadata = { title: "订阅方案" };

// §7.2 权益分层
const RIGHTS = [
  { name: "试看首章", free: "是", premium: "是", expired: "是" },
  { name: "课程目录", free: "是", premium: "是", expired: "是" },
  { name: "全站课程", free: "—", premium: "是", expired: "—" },
  { name: "本周上新", free: "可浏览", premium: "可学习", expired: "可浏览" },
  { name: "需求投票", free: "—", premium: "是", expired: "—" },
  { name: "笔记创建", free: "3 篇", premium: "无限", expired: "仅查看" },
];

export default async function PricingPage() {
  const user = await getCurrentUser();
  const snapshot = await resolveEntitlement(user?.id ?? null);
  const plans = await prisma.plan.findMany({ where: { isActive: true }, orderBy: { priceCents: "asc" } });
  // P1 主推：连续包月、年度；单月弱展示锚点（§7.1）
  const mainPlans = plans.filter((p) => p.billingPeriod !== "month");
  const anchorPlan = plans.find((p) => p.billingPeriod === "month");

  return (
    <div className="space-y-12 py-4">
      <TrackView event="paywall_view" properties={{ trigger: "pricing_page" }} />
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-ink-950">一次订阅，解锁全站课程</h1>
        <p className="mt-2 text-ink-500">持续更新的学习流 · 笔记永久保留 · 随时可取消</p>
        {snapshot.isSubscriber && (
          <p className="mt-3 inline-block rounded-full bg-success/10 px-4 py-1.5 text-sm text-success">
            你已是订阅用户，有效至 {snapshot.validUntil ? new Date(snapshot.validUntil).toLocaleDateString("zh-CN") : ""}
          </p>
        )}
      </div>

      <div className="mx-auto grid max-w-2xl gap-5 sm:grid-cols-2">
        {mainPlans.map((p) => (
          <SubscriptionCard key={p.id} plan={p} isLoggedIn={!!user} redirectTo="/me/subscription" />
        ))}
      </div>

      {anchorPlan && (
        <p className="text-center text-sm text-ink-400">
          也可选择单月 ¥{(anchorPlan.priceCents / 100).toFixed(0)}/月（不含首月优惠）· 家庭年卡、学生年卡将于后续上线
        </p>
      )}

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
