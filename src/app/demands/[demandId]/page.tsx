import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { CATEGORY_LABELS, relativeTime } from "@/lib/queries";
import { Badge } from "@/components/ui";
import { VoteButton } from "@/components/VoteButton";
import { TrackView } from "@/components/TrackView";
import { DEMAND_STATUS } from "@/lib/format";

export default async function DemandDetailPage({ params }: { params: Promise<{ demandId: string }> }) {
  const { demandId } = await params;
  const user = await getCurrentUser();
  const snapshot = await resolveEntitlement(user?.id ?? null);

  const demand = await prisma.demand.findUnique({
    where: { id: demandId },
    include: {
      votes: true,
      statusLogs: { orderBy: { createdAt: "asc" } },
      user: { select: { nickname: true } },
    },
  });
  if (!demand) notFound();

  const totalVotes = demand.votes.reduce((s, v) => s + v.voteCount, 0);
  const status = DEMAND_STATUS[demand.status] ?? { label: demand.status, tone: "muted" };
  const similar = await prisma.demand.findMany({
    where: { id: { not: demandId }, category: demand.category, status: { notIn: ["rejected", "merged"] } },
    take: 4,
    select: { id: true, title: true, status: true },
  });
  const launchedCourse = demand.launchedCourseId
    ? await prisma.course.findUnique({ where: { id: demand.launchedCourseId }, select: { slug: true, title: true } })
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-4">
      <TrackView event="demand_status_view" properties={{ demand_id: demandId, status: demand.status }} />
      <Link href="/demands" className="text-sm text-tide-700 hover:underline">← 需求广场</Link>

      <div className="rounded-2xl border border-ink-100 bg-paper-raised p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={status.tone}>{status.label}</Badge>
              <Badge tone="muted">{CATEGORY_LABELS[demand.category] ?? demand.category}</Badge>
            </div>
            <h1 className="mt-3 text-2xl font-semibold text-ink-950">{demand.title}</h1>
            {demand.description && <p className="prose-body mt-3 text-ink-800">{demand.description}</p>}
            <p className="mt-3 text-xs text-ink-400">由 {demand.user.nickname} 提出 · {relativeTime(demand.createdAt)}</p>
          </div>
          <VoteButton demandId={demand.id} initialVotes={totalVotes} canVote={snapshot.canVote} disabledReason={snapshot.canVote ? undefined : "订阅后可投票"} />
        </div>

        {demand.status === "launched" && launchedCourse && (
          <Link href={`/courses/${launchedCourse.slug}`} className="mt-4 flex items-center gap-2 rounded-xl bg-success/10 px-4 py-3 text-sm font-medium text-success">
            🎉 该需求已上线：{launchedCourse.title} →
          </Link>
        )}
      </div>

      {/* 官方反馈 */}
      {demand.officialReply && (
        <div className="rounded-2xl border border-tide-100 bg-tide-50 p-5">
          <p className="text-sm font-medium text-tide-700">官方反馈</p>
          <p className="mt-1.5 text-sm text-ink-800">{demand.officialReply}</p>
        </div>
      )}

      {/* 状态日志 */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-ink-950">处理进度</h2>
        <ol className="relative space-y-4 border-l border-ink-100 pl-5">
          {demand.statusLogs.map((log) => (
            <li key={log.id} className="relative">
              <span className="absolute -left-[1.45rem] top-1.5 h-2.5 w-2.5 rounded-full bg-tide-400 ring-4 ring-paper" />
              <div className="flex items-center gap-2">
                <span className="font-medium text-ink-950">{DEMAND_STATUS[log.toStatus]?.label ?? log.toStatus}</span>
                <span className="text-xs text-ink-400">{relativeTime(log.createdAt)}</span>
              </div>
              {log.reason && <p className="mt-0.5 text-sm text-ink-500">{log.reason}</p>}
            </li>
          ))}
        </ol>
      </section>

      {/* 相似需求 */}
      {similar.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-ink-950">相似需求</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {similar.map((s) => (
              <Link key={s.id} href={`/demands/${s.id}`} className="rounded-xl border border-ink-100 bg-paper-raised p-4 hover:border-tide-400">
                <div className="flex items-center gap-2">
                  <Badge tone={DEMAND_STATUS[s.status]?.tone ?? "muted"}>{DEMAND_STATUS[s.status]?.label ?? s.status}</Badge>
                </div>
                <p className="mt-2 text-sm font-medium text-ink-950">{s.title}</p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
