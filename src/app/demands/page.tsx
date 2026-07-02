import Link from "next/link";
import { listRankedDemands } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { DemandCard } from "@/components/DemandCard";
import { Button, EmptyState } from "@/components/ui";

export const metadata = { title: "需求广场" };

export default async function DemandsPage() {
  const user = await getCurrentUser();
  const snapshot = await resolveEntitlement(user?.id ?? null);
  const demands = await listRankedDemands(["collecting", "evaluating", "scheduled", "producing", "launched"]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-950">需求广场</h1>
          <p className="mt-1 text-ink-500">你投票，决定平台下一批课程 · 综合排行榜</p>
        </div>
        <Button href="/demands/new" variant="primary">＋ 提交需求</Button>
      </div>

      {!snapshot.canVote && (
        <div className="rounded-xl bg-tide-50 px-4 py-3 text-sm text-tide-700">
          订阅用户每周有 5 票，可对同一需求最多投 3 票。<Link href="/pricing" className="font-medium underline">订阅后即可投票</Link>
        </div>
      )}

      {demands.length === 0 ? (
        <EmptyState title="还没有需求" hint="成为第一个提出想学内容的人" action={<Button href="/demands/new">提交需求</Button>} />
      ) : (
        <div className="space-y-3">
          {demands.map((d, i) => (
            <DemandCard key={d.id} demand={d} rank={i + 1} canVote={snapshot.canVote} disabledReason={snapshot.canVote ? undefined : "订阅后可投票"} />
          ))}
        </div>
      )}
    </div>
  );
}
