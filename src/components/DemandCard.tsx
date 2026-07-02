import Link from "next/link";
import { Waves } from "@phosphor-icons/react/dist/ssr";
import { Badge } from "./ui";
import { VoteButton } from "./VoteButton";
import { DEMAND_STATUS } from "@/lib/format";

export interface DemandCardData {
  id: string;
  title: string;
  description: string | null;
  categoryLabel: string;
  status: string;
  totalVotes: number;
  launchedCourseId?: string | null;
  followerCount?: number;
  /** 热度水位 0–1（相对榜首票数），用于卡片底部水位条 */
  heat?: number;
}

// §6.6 需求卡：标题、票数、状态、投票（v1.0：对比度与热度水位优化）
export function DemandCard({
  demand,
  rank,
  canVote,
  disabledReason,
}: {
  demand: DemandCardData;
  rank?: number;
  canVote: boolean;
  disabledReason?: string;
}) {
  const status = DEMAND_STATUS[demand.status] ?? { label: demand.status, tone: "muted" };
  const heat = Math.max(0, Math.min(1, demand.heat ?? 0));
  return (
    <div className="group relative overflow-hidden rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-5 transition-all duration-[var(--dur-normal)] [transition-timing-function:var(--ease-tide)] hover:-translate-y-0.5 hover:border-accent-200 hover:shadow-[var(--shadow-soft)]">
      <div className="flex items-start gap-4">
        {rank != null && (
          // A11y：rank>3 由浅灰改 ink-600，提升数字对比度
          <div
            className={`num mt-0.5 w-7 shrink-0 text-center text-lg ${
              rank <= 3 ? "text-accent-600" : "text-ink-600"
            }`}
          >
            {String(rank).padStart(2, "0")}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <Link href={`/demands/${demand.id}`} className="block">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-ink-950 transition-colors group-hover:text-accent-700">
                {demand.title}
              </h3>
              <Badge tone={status.tone}>{status.label}</Badge>
              <Badge tone="muted">{demand.categoryLabel}</Badge>
            </div>
            {demand.description && (
              <p className="mt-1 line-clamp-2 text-sm text-ink-500">{demand.description}</p>
            )}
          </Link>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-400">
            {demand.followerCount != null && demand.followerCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <Waves size={13} weight="fill" className="text-accent-400" />
                {demand.followerCount} 人关注进度
              </span>
            )}
            {demand.status === "launched" && demand.launchedCourseId && (
              <Link
                href={`/courses/${demand.launchedCourseId}`}
                className="font-medium text-success hover:underline"
              >
                该需求已上线 → 查看课程
              </Link>
            )}
          </div>
        </div>

        <VoteButton
          demandId={demand.id}
          initialVotes={demand.totalVotes}
          canVote={canVote}
          disabledReason={disabledReason}
        />
      </div>

      {/* 热度水位：卡片底部随票数占比涨落的一条水线 */}
      {heat > 0 && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-accent-300/60 to-accent-500/80 transition-all duration-[var(--dur-slow)]"
          style={{ width: `${Math.round(heat * 100)}%` }}
          aria-hidden
        />
      )}
    </div>
  );
}
