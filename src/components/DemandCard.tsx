import Link from "next/link";
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
}

// §6.6 需求卡：标题、票数、状态、投票
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
  return (
    <div className="flex items-start gap-4 rounded-2xl border border-ink-100 bg-paper-raised p-4 transition-shadow hover:shadow-[var(--shadow-soft)]">
      {rank != null && (
        <div className={`mt-0.5 w-6 shrink-0 text-center text-lg font-semibold ${rank <= 3 ? "text-dawn-500" : "text-ink-200"}`}>
          {rank}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <Link href={`/demands/${demand.id}`} className="block">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-ink-950 hover:text-tide-700">{demand.title}</h3>
            <Badge tone={status.tone}>{status.label}</Badge>
            <Badge tone="muted">{demand.categoryLabel}</Badge>
          </div>
          {demand.description && <p className="mt-1 line-clamp-2 text-sm text-ink-500">{demand.description}</p>}
        </Link>
        {demand.status === "launched" && demand.launchedCourseId && (
          <Link href={`/courses/${demand.launchedCourseId}`} className="mt-2 inline-block text-xs font-medium text-success">
            该需求已上线 → 查看课程
          </Link>
        )}
      </div>
      <VoteButton demandId={demand.id} initialVotes={demand.totalVotes} canVote={canVote} disabledReason={disabledReason} />
    </div>
  );
}
