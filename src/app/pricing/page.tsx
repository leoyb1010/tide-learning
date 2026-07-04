import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { PricingPlans } from "@/components/PricingPlans";
import { TrackView } from "@/components/TrackView";
import { trackLabel, FUTURE_TRACKS } from "@/lib/tracks";

export const metadata = { title: "订阅方案" };

const NO = "✕";
const RIGHTS = [
  { name: "试看首章", free: "是", premium: "是", expired: "是" },
  { name: "课程目录", free: "是", premium: "是", expired: "是" },
  { name: "订阅赛道课程", free: NO, premium: "是", expired: NO },
  { name: "本周上新", free: "可浏览", premium: "可学习", expired: "可浏览" },
  { name: "直播小班课", free: NO, premium: "是", expired: NO },
  { name: "需求投票", free: NO, premium: "是", expired: NO },
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
    <div className="mx-auto max-w-[940px] space-y-16 py-4">
      <TrackView event="paywall_view" properties={{ trigger: "pricing_page" }} />

      {/* 居中头 */}
      <header className="studio-rise text-center">
        <p className="mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink4)]">SUBSCRIBE · 订阅方案</p>
        <h1 className="mt-2 text-[28px] font-bold leading-[1.25] tracking-tight text-[var(--ink)]">
          一个订阅，畅学不停
        </h1>
        <p className="mx-auto mt-3 max-w-[520px] text-[15px] leading-[1.7] text-[var(--ink2)]">
          全部赛道、持续更新、笔记与截帧永久保存。随时可取消。
        </p>
        {snapshot.isSubscriber && (
          <p className="mono mt-4 inline-flex items-center gap-1.5 rounded-full bg-[var(--ok-soft)] px-3 py-1.5 text-[12px] font-medium text-[var(--ok)]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--ok)]" />
            你已订阅（{snapshot.accessibleTracks === "all" ? "全站" : snapshot.accessibleTracks.map(trackLabel).join("、")}），有效至 {snapshot.validUntil ? new Date(snapshot.validUntil).toLocaleDateString("zh-CN") : ""}
          </p>
        )}
      </header>

      {/* 全站会员 + 单赛道会员（优惠券预览 + 折后价 + 三档卡，含 hot 卡选中态）*/}
      <section>
        <div className="mb-6 text-center">
          <h2 className="text-[18px] font-bold text-[var(--ink)]">全站会员</h2>
          <p className="mt-1 text-[13px] text-[var(--ink3)]">一次订阅，解锁全部赛道</p>
        </div>
        <PricingPlans fullPlans={fullPlans} trackPlans={trackPlans} isLoggedIn={!!user} />
        {anchor && (
          <p className="mono mt-5 text-center text-[13px] text-[var(--ink4)]">
            也可选择全站单月 ¥{(anchor.priceCents / 100).toFixed(0)}/月（不含首月优惠）
          </p>
        )}
      </section>

      {/* 未来赛道 */}
      <section className="text-center">
        <p className="text-[13px] text-[var(--ink4)]">即将上线更多赛道：</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {FUTURE_TRACKS.map((t) => (
            <span
              key={t.key}
              className="rounded-full border border-[var(--border)] bg-[var(--surface2)] px-3 py-1 text-[12px] text-[var(--ink3)]"
            >
              {t.label}
            </span>
          ))}
        </div>
      </section>

      {/* 权益对比：订阅列铺 --red-soft 竖带高亮，值用 --ok/中性语义区分 */}
      <section className="mx-auto max-w-[620px]">
        <h2 className="mb-4 text-center text-[18px] font-bold text-[var(--ink)]">权益对比</h2>
        <div className="overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card),var(--inner-hi)]">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="px-4 py-3 text-left text-[12px] font-medium text-[var(--ink3)]">权益</th>
                <th className="px-4 py-3 text-center text-[12px] font-medium text-[var(--ink4)]">免费</th>
                <th className="bg-[var(--red-soft)] px-4 py-3 text-center text-[12px] font-bold text-[var(--red-ink)]">订阅</th>
                <th className="px-4 py-3 text-center text-[12px] font-medium text-[var(--ink4)]">到期</th>
              </tr>
            </thead>
            <tbody>
              {RIGHTS.map((r, i) => (
                <tr key={r.name} className={i > 0 ? "border-t border-[var(--border)]" : ""}>
                  <td className="px-4 py-3 font-medium text-[var(--ink)]">{r.name}</td>
                  <td className="px-4 py-3 text-center"><Cell value={r.free} /></td>
                  <td className="bg-[var(--red-soft)] px-4 py-3 text-center"><Cell value={r.premium} strong /></td>
                  <td className="px-4 py-3 text-center"><Cell value={r.expired} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-center text-[12px] leading-[1.6] text-[var(--ink4)]">
          停订后课程锁定，但笔记永久保留、可查看。健康类内容仅供健康信息素养学习。
        </p>
      </section>

      {/* 底部已选回执 */}
      <div className="mono mx-auto flex max-w-[620px] flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-[13px] border border-[var(--border)] bg-[var(--surface-inset)] px-5 py-3.5 text-center text-[12px] text-[var(--ink3)] shadow-[var(--inner-hi)]">
        <span className="font-semibold text-[var(--ink)]">已选：</span>
        <span>全站会员 · 支持支付宝/微信 · 学生认证再享 8 折</span>
      </div>
    </div>
  );
}

/** 权益对比单元格：可用值用 --ok 语义色，不可用(✕)用中性弱化，其余文本值原样。 */
function Cell({ value, strong = false }: { value: string; strong?: boolean }) {
  if (value === "是") {
    return (
      <span
        className={`mono inline-flex items-center justify-center text-[var(--ok)] ${
          strong ? "text-[15px] font-bold" : "opacity-90"
        }`}
        aria-label="支持"
      >
        ✓
      </span>
    );
  }
  if (value === NO) {
    return (
      <span className="mono inline-flex items-center justify-center text-[var(--ink4)]" aria-label="不支持">
        ✕
      </span>
    );
  }
  return (
    <span className={`mono ${strong ? "font-bold text-[var(--red-ink)]" : "text-[var(--ink3)]"}`}>{value}</span>
  );
}
