import Link from "next/link";
import { listRankedDemands } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { VoteButton } from "@/components/VoteButton";
import { DEMAND_STATUS } from "@/lib/format";

export const metadata = { title: "共创广场" };

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

  const topVotes = demands.reduce((m, d) => Math.max(m, d.totalVotes), 0) || 1;

  return (
    <div className="mx-auto max-w-[1000px] space-y-6">
      {/* 深色 Banner */}
      <section className="studio-rise relative overflow-hidden rounded-[20px] bg-[var(--video-bg)] p-[26px] text-white shadow-[var(--lift)]">
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
              className="studio-press inline-flex items-center gap-2 rounded-[12px] bg-[var(--red)] px-5 py-3 text-[14px] font-bold text-white shadow-[0_2px_10px_rgba(0,0,0,0.25)] transition-all hover:brightness-105"
            >
              ＋ 发起新需求
            </Link>
          </div>
        </div>
      </section>

      {!snapshot.canVote && (
        <div className="rounded-[12px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-4 py-3 text-[13px] text-[var(--red)]">
          订阅用户每周有 5 票，可对同一需求最多投 3 票。
          <Link href="/pricing" className="ml-1 font-semibold underline">
            订阅后即可投票
          </Link>
        </div>
      )}

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f, i) => (
          <span
            key={f}
            className={`mono cursor-default rounded-full px-3.5 py-1.5 text-[12px] transition-colors ${
              i === 0
                ? "bg-[var(--ink)] text-[var(--surface)]"
                : "border border-[var(--border)] bg-[var(--surface)] text-[var(--ink3)]"
            }`}
          >
            {f}
          </span>
        ))}
      </div>

      {/* 列表 */}
      {demands.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[16px] border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-20 text-center">
          <p className="font-semibold text-[var(--ink)]">还没有需求</p>
          <p className="mt-1.5 text-[13px] text-[var(--ink3)]">
            成为第一个提出想学内容的人
          </p>
          <Link
            href="/demands/new"
            className="studio-press mt-6 inline-flex items-center rounded-[13px] bg-[var(--ink)] px-5 py-3 text-[14px] font-bold text-[var(--surface)]"
          >
            提交需求
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {demands.map((d, i) => {
            const rank = i + 1;
            const isTop = rank === 1;
            const status = DEMAND_STATUS[d.status] ?? { label: d.status, tone: "muted" };
            const scheduled = ["scheduled", "producing"].includes(d.status);
            const pct = Math.round((d.totalVotes / topVotes) * 100);
            return (
              <div
                key={d.id}
                className="studio-lift flex items-center gap-5 rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]"
              >
                {/* 排名 */}
                <div
                  className={`mono w-7 shrink-0 text-center text-[20px] font-extrabold ${
                    isTop ? "text-[var(--red)]" : "text-[var(--ink4)]"
                  }`}
                >
                  {String(rank).padStart(2, "0")}
                </div>

                {/* 中间内容 */}
                <div className="min-w-0 flex-1">
                  <Link href={`/demands/${d.id}`} className="block">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-[15px] font-bold text-[var(--ink)]">
                        {d.title}
                      </h3>
                      <span className="rounded-full border border-[var(--border)] bg-[var(--surface-inset)] px-2.5 py-0.5 text-[11px] text-[var(--ink3)]">
                        {d.categoryLabel}
                      </span>
                      {scheduled && (
                        <span className="rounded-full border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--red)]">
                          {status.label}
                        </span>
                      )}
                      {d.status === "launched" && (
                        <span className="rounded-full border border-[var(--border)] bg-[var(--new-bg)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--new-ink)]">
                          {status.label}
                        </span>
                      )}
                    </div>
                    {d.description && (
                      <p className="mt-1 line-clamp-1 text-[13px] leading-[1.55] text-[var(--ink3)]">
                        {d.description}
                      </p>
                    )}
                  </Link>

                  {/* 票占比进度条 red */}
                  <div className="mt-2.5 flex items-center gap-2.5">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-inset)]">
                      <div
                        className="h-full rounded-full bg-[var(--red)] transition-all duration-500"
                        style={{ width: `${Math.max(4, pct)}%` }}
                        aria-hidden
                      />
                    </div>
                    <span className="mono shrink-0 text-[11px] text-[var(--ink4)]">
                      {d.totalVotes} 票
                    </span>
                  </div>

                  {d.status === "launched" && d.launchedCourseId && (
                    <Link
                      href={`/courses/${d.launchedCourseId}`}
                      className="mt-2 inline-block text-[12px] font-medium text-[var(--red)] hover:underline"
                    >
                      该需求已上线 → 查看课程
                    </Link>
                  )}
                </div>

                {/* 右侧投票按钮 */}
                <div className="shrink-0">
                  <VoteButton
                    demandId={d.id}
                    initialVotes={d.totalVotes}
                    canVote={snapshot.canVote}
                    disabledReason={snapshot.canVote ? undefined : "订阅后可投票"}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
