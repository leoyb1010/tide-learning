import Link from "next/link";
import { Info, Sparkle, Plus } from "@phosphor-icons/react/dist/ssr";
import { listRankedDemands } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { VoteLeaderboard } from "@/components/VoteLeaderboard";
import { CommunityTabs } from "@/components/CommunityTabs";

export const metadata = { title: "社区广场" };

const FILTERS = ["热门", "最新", "已排期"];

export default async function DemandsPage() {
  const user = await getCurrentUser();
  const snapshot = await resolveEntitlement(user?.id ?? null);
  const demands = await listRankedDemands([
    "collecting",
    "evaluating",
    "scheduled",
    "producing",
    "launched",
  ]);

  // 课程共创投票 Tab：本周之星大卡 + 生命周期轨 + 增强需求卡列表。
  const leaderboard = (
    <div className="space-y-6">
      {!snapshot.canVote && (
        <div className="flex items-start gap-2.5 rounded-[12px] border border-[var(--info-soft)] bg-[var(--info-soft)] px-4 py-3 text-[13px] leading-[1.6] text-[var(--info)]">
          <Info size={16} weight="fill" className="mt-0.5 shrink-0" />
          <span>
            订阅用户每周有 <span className="mono font-semibold">5</span> 票，可对同一需求最多投 <span className="mono font-semibold">3</span> 票。
            <Link href="/pricing" className="ml-1 font-semibold text-[var(--info)] underline underline-offset-2">
              订阅后即可投票
            </Link>
          </span>
        </div>
      )}

      {/* 排序说明：默认按热度排序，用静态标签呈现（非可切换控件，避免伪装可点） */}
      <div className="flex flex-wrap items-center gap-2" aria-label="当前排序：热门">
        {FILTERS.map((f, i) => (
          <span
            key={f}
            aria-current={i === 0 ? "true" : undefined}
            className={`mono rounded-full px-3.5 py-1.5 text-[12px] ${
              i === 0
                ? "bg-[var(--ink)] text-[var(--surface)]"
                : "border border-[var(--border)] bg-[var(--surface)] text-[var(--ink4)]"
            }`}
          >
            {f}
          </span>
        ))}
      </div>

      {demands.length === 0 ? (
        // 空态：图形徽章 + 引导文案 + 发光 CTA，有设计感的构图
        <div className="flex flex-col items-center justify-center gap-4 rounded-[16px] border border-dashed border-[var(--border2)] bg-[var(--surface)] px-6 py-16 text-center shadow-[var(--inner-hi)]">
          <span className="grid h-14 w-14 place-items-center rounded-[16px] bg-[var(--red-soft)] text-[var(--red)]">
            <Sparkle size={26} weight="fill" />
          </span>
          <div>
            <p className="text-[16px] font-bold text-[var(--ink)]">还没有需求</p>
            <p className="mt-1.5 text-[13px] leading-[1.6] text-[var(--ink3)]">
              成为第一个提出想学内容的人，让社区投票把它排上日程。
            </p>
          </div>
          <Link
            href="/demands/new"
            className="cta-glow studio-press inline-flex items-center gap-2 rounded-[14px] bg-[var(--red)] px-6 py-3 text-[14px] font-bold text-white transition-all hover:brightness-105"
          >
            <Plus size={16} weight="bold" />
            提交需求
          </Link>
        </div>
      ) : (
        <VoteLeaderboard
          demands={demands}
          canVote={snapshot.canVote}
          disabledReason={snapshot.canVote ? undefined : "订阅后可投票"}
        />
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-[1120px] space-y-6">
      {/* 深色 Banner：渐变材质替代死黑平面 + 右上柔光装饰 */}
      <section
        className="studio-rise relative overflow-hidden rounded-[18px] p-[26px] text-white shadow-[var(--lift)]"
        style={{ background: "var(--video-grad)" }}
      >
        {/* 右上红圆装饰 */}
        <div
          className="pointer-events-none absolute -right-14 -top-14 h-44 w-44 rounded-full bg-[var(--red)] opacity-30 blur-[2px]"
          aria-hidden
        />
        <div className="relative grid grid-cols-1 items-center gap-6 md:grid-cols-[1fr_.8fr]">
          <div>
            <div className="mono text-[10px] uppercase tracking-[0.14em] text-white/55">
              CO-CREATE · 需求共创
            </div>
            <h1 className="mt-2 text-[25px] font-bold leading-[1.25]">
              你想学的课，投票决定
            </h1>
            <p className="mt-2 max-w-[420px] text-[14px] leading-[1.7] text-white/70">
              把想学的内容提出来，让社区一起投票。票数越高越靠前，排期后你能一路追进度。
            </p>
          </div>
          <div className="flex md:justify-end">
            <Link
              href="/demands/new"
              className="cta-glow studio-press inline-flex items-center gap-2 rounded-[12px] bg-[var(--red)] px-5 py-3 text-[14px] font-bold text-white transition-all hover:brightness-105"
            >
              <Plus size={16} weight="bold" />
              发起新需求
            </Link>
          </div>
        </div>
      </section>

      {/* §7 社区广场双 Tab：课程共创（排行榜）/ 自习室广场（轻社区） */}
      <CommunityTabs
        leaderboard={leaderboard}
        canPost={snapshot.canUseLLM || snapshot.isSubscriber}
        isLoggedIn={Boolean(user)}
      />
    </div>
  );
}
