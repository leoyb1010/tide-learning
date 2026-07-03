import { notFound } from "next/navigation";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasPermission, primePermissionCache } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { CATEGORY_LABELS, relativeTime } from "@/lib/queries";
import { WEEKLY_VOTE_BUDGET, weekKey } from "@/lib/week";
import { renderMarkdown } from "@/lib/markdown";
import { Badge } from "@/components/ui";
import { TidalReveal } from "@/components/motion";
import { Confetti, ArrowRight, Waves } from "@phosphor-icons/react/dist/ssr";
import { VoteButton, DemandFollowButton } from "@/components/VoteButton";
import { DemandComments, type CommentView } from "@/components/DemandComments";
import { DemandStageTrack, type StageItem } from "@/components/DemandStageTrack";
import { TrackView } from "@/components/TrackView";
import { DEMAND_STATUS } from "@/lib/format";

export const dynamic = "force-dynamic";

type CommentWithAuthor = Prisma.CommentGetPayload<{
  include: { user: { select: { id: true; nickname: true; avatarUrl: true } } };
}>;

// 把扁平评论整理成「根楼 + 楼中楼」结构（官方置顶排前），复用 API 的视图形状。
function buildCommentTree(all: CommentWithAuthor[]): CommentView[] {
  const toView = (c: CommentWithAuthor, replies: CommentView[]): CommentView => {
    const deleted = c.deletedAt != null;
    return {
      id: c.id,
      contentMd: deleted ? "" : c.contentMd,
      contentHtml: renderMarkdown(deleted ? "_该评论已删除_" : c.contentMd),
      isOfficial: c.isOfficial,
      createdAt: c.createdAt.toISOString(),
      author: deleted ? { id: "", nickname: "已删除", avatarUrl: null } : c.user,
      replies,
    };
  };
  const childrenOf = new Map<string, CommentWithAuthor[]>();
  const roots: CommentWithAuthor[] = [];
  for (const c of all) {
    if (c.parentId) {
      const arr = childrenOf.get(c.parentId) ?? [];
      arr.push(c);
      childrenOf.set(c.parentId, arr);
    } else {
      roots.push(c);
    }
  }
  const buildReplies = (pid: string): CommentView[] =>
    (childrenOf.get(pid) ?? []).map((r) => toView(r, buildReplies(r.id)));
  return roots
    .map((r) => toView(r, buildReplies(r.id)))
    .sort((a, b) => {
      if (a.isOfficial !== b.isOfficial) return a.isOfficial ? -1 : 1;
      return a.createdAt.localeCompare(b.createdAt);
    });
}

export default async function DemandDetailPage({ params }: { params: Promise<{ demandId: string }> }) {
  const { demandId } = await params;
  const user = await getCurrentUser();
  const snapshot = await resolveEntitlement(user?.id ?? null);

  const demand = await prisma.demand.findUnique({
    where: { id: demandId },
    include: {
      votes: { select: { userId: true, voteCount: true, createdAt: true } },
      statusLogs: { orderBy: { createdAt: "asc" } },
      stages: true,
      user: { select: { nickname: true } },
      _count: { select: { follows: true } },
    },
  });
  if (!demand) notFound();

  const totalVotes = demand.votes.reduce((s, v) => s + v.voteCount, 0);
  const status = DEMAND_STATUS[demand.status] ?? { label: demand.status, tone: "muted" };

  // 并行拉取：讨论、相似需求、上线课程、当前用户投票额与关注态、共创名单。
  const [commentsRaw, similar, launchedCourse] = await Promise.all([
    prisma.comment.findMany({
      where: { demandId },
      include: { user: { select: { id: true, nickname: true, avatarUrl: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.demand.findMany({
      where: { id: { not: demandId }, category: demand.category, status: { notIn: ["rejected", "merged"] } },
      take: 4,
      select: { id: true, title: true, status: true },
    }),
    demand.launchedCourseId
      ? prisma.course.findUnique({ where: { id: demand.launchedCourseId }, select: { slug: true, title: true } })
      : Promise.resolve(null),
  ]);

  // 当前用户的关注态与本周剩余票额。
  let following = false;
  let weeklyRemaining: number | undefined;
  if (user) {
    const wk = weekKey(); // 服务端按 Asia/Shanghai 计算当前周界
    const [followRow, weekVotes] = await Promise.all([
      prisma.demandFollow.findUnique({
        where: { demandId_userId: { demandId, userId: user.id } },
        select: { id: true },
      }),
      prisma.demandVote.findMany({
        where: { userId: user.id, weekKey: wk },
        select: { voteCount: true },
      }),
    ]);
    following = !!followRow;
    const used = weekVotes.reduce((s, v) => s + v.voteCount, 0);
    weeklyRemaining = Math.max(0, WEEKLY_VOTE_BUDGET - used);
  }

  // 共创名单：该需求所有投票者（按票数聚合），上线后首位显示「首潮」感谢。
  const voterIds = Array.from(new Set(demand.votes.map((v) => v.userId)));
  const voters = voterIds.length
    ? await prisma.user.findMany({
        where: { id: { in: voterIds } },
        select: { id: true, nickname: true, avatarUrl: true },
      })
    : [];
  const voteByUser = new Map<string, number>();
  for (const v of demand.votes) voteByUser.set(v.userId, (voteByUser.get(v.userId) ?? 0) + v.voteCount);
  const coCreators = voters
    .map((u) => ({ ...u, votes: voteByUser.get(u.id) ?? 0 }))
    .sort((a, b) => b.votes - a.votes);

  const comments = buildCommentTree(commentsRaw);
  const stages: StageItem[] = demand.stages.map((s) => ({
    stage: s.stage,
    status: s.status,
    note: s.note,
    updatedAt: s.updatedAt.toISOString(),
  }));
  if (user) await primePermissionCache();
  const canModerate = user ? hasPermission(user.role, "demand:moderate") : false;
  const launched = demand.status === "launched";

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-4">
      <TrackView event="demand_status_view" properties={{ demand_id: demandId, status: demand.status }} />
      <Link href="/demands" className="text-sm text-accent-700 hover:underline">← 需求广场</Link>

      {/* 头部：标题 / 描述 / 关注 / 投票 */}
      <TidalReveal>
        <div className="rounded-2xl border border-ink-100 bg-paper-raised p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={status.tone}>{status.label}</Badge>
                <Badge tone="muted">{CATEGORY_LABELS[demand.category] ?? demand.category}</Badge>
              </div>
              <h1 className="mt-3 text-2xl font-semibold text-ink-950">{demand.title}</h1>
              {demand.description && <p className="prose-body mt-3 text-ink-800">{demand.description}</p>}
              <p className="mt-3 text-xs text-ink-400">
                由 {demand.user.nickname} 提出 · {relativeTime(demand.createdAt)}
              </p>
              <div className="mt-4">
                <DemandFollowButton
                  demandId={demand.id}
                  initialFollowing={following}
                  initialCount={demand._count.follows}
                  canFollow={!!user}
                  disabledReason={user ? undefined : "登录后可关注"}
                />
              </div>
            </div>
            <VoteButton
              demandId={demand.id}
              initialVotes={totalVotes}
              canVote={snapshot.canVote}
              disabledReason={snapshot.canVote ? undefined : "订阅后可投票"}
              weeklyRemaining={weeklyRemaining}
              weeklyBudget={WEEKLY_VOTE_BUDGET}
              showReset={snapshot.canVote}
            />
          </div>

          {launched && launchedCourse && (
            <Link
              href={`/courses/${launchedCourse.slug}`}
              className="mt-4 flex items-center gap-2 rounded-xl bg-success/10 px-4 py-3 text-sm font-medium text-success transition-colors hover:bg-success/15"
            >
              <Confetti size={17} weight="fill" className="shrink-0" />
              该需求已上线：{launchedCourse.title}
              <ArrowRight size={15} className="ml-auto" />
            </Link>
          )}
        </div>
      </TidalReveal>

      {/* 官方反馈 */}
      {demand.officialReply && (
        <div className="rounded-2xl border border-accent-100 bg-accent-50 p-5">
          <p className="text-sm font-medium text-accent-700">官方反馈</p>
          <p className="mt-1.5 text-sm text-ink-800">{demand.officialReply}</p>
        </div>
      )}

      {/* 制作进度剧场 */}
      {stages.length > 0 && <DemandStageTrack stages={stages} />}

      {/* 共创名单 */}
      {coCreators.length > 0 && (
        <TidalReveal>
          <section>
            <div className="mb-4 flex items-center gap-2">
              <Waves size={18} weight="fill" className="text-accent-500" />
              <h2 className="text-lg font-semibold text-ink-950">共创名单</h2>
              <span className="num text-sm text-ink-400">{coCreators.length} 位</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {coCreators.map((u, i) => (
                <span
                  key={u.id}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm ${
                    launched && i === 0
                      ? "bg-accent-600 text-white"
                      : "bg-paper text-ink-700 ring-1 ring-ink-100"
                  }`}
                >
                  {u.nickname}
                  {launched && i === 0 && (
                    <span className="rounded-full bg-[var(--surface)]/20 px-1.5 py-0.5 text-[0.65rem] font-medium">首潮</span>
                  )}
                  <span className="num text-xs opacity-70">{u.votes}票</span>
                </span>
              ))}
            </div>
          </section>
        </TidalReveal>
      )}

      {/* 讨论区 */}
      <DemandComments
        demandId={demand.id}
        initialComments={comments}
        currentUserId={user?.id ?? null}
        canModerate={canModerate}
        canComment={!!user}
      />

      {/* 状态日志 */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-ink-950">处理进度</h2>
        <ol className="relative space-y-4 border-l border-ink-100 pl-5">
          {demand.statusLogs.map((log) => (
            <li key={log.id} className="relative">
              <span className="absolute -left-[1.45rem] top-1.5 h-2.5 w-2.5 rounded-full bg-accent-400 ring-4 ring-paper" />
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
              <Link
                key={s.id}
                href={`/demands/${s.id}`}
                className="rounded-xl border border-ink-100 bg-paper-raised p-4 transition-colors hover:border-accent-400"
              >
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
