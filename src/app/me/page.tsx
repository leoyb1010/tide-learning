import Link from "next/link";
import { redirect } from "next/navigation";
import { Flame, Trophy } from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement, STATUS_LABELS } from "@/lib/entitlement";
import { getGamificationSummary } from "@/lib/gamification";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui";
import { LogoutButton } from "@/components/AccountActions";
import { TideCalendar } from "@/components/TideCalendar";
import { formatDurationSec } from "@/lib/format";
import { shanghaiDayKey } from "@/lib/week";

export const metadata = { title: "我的" };

export default async function MePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/me");

  const [snapshot, progressAgg, notesCount, votesAgg, recent, gamification] = await Promise.all([
    resolveEntitlement(user.id),
    prisma.learningProgress.aggregate({ where: { userId: user.id }, _sum: { progressSec: true } }),
    prisma.note.count({ where: { userId: user.id, deletedAt: null } }),
    prisma.demandVote.aggregate({ where: { userId: user.id }, _sum: { voteCount: true } }),
    prisma.learningProgress.findMany({
      where: { userId: user.id },
      orderBy: { lastPlayedAt: "desc" },
      take: 3,
      include: { course: { select: { slug: true, title: true } }, lesson: { select: { id: true, title: true } } },
    }),
    getGamificationSummary(user.id),
  ]);

  const meta = STATUS_LABELS[snapshot.subscriptionStatus] ?? STATUS_LABELS.free;

  return (
    <div className="space-y-6">
      {/* 用户信息 */}
      <section className="flex items-center gap-4 rounded-2xl border border-ink-100 bg-paper-raised p-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-600 text-xl font-semibold text-white">
          {user.nickname.slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold text-ink-950">{user.nickname}</p>
          <p className="text-sm text-ink-400">{user.email ?? user.phone}</p>
        </div>
        <Badge tone={meta.tone === "ok" ? "success" : meta.tone === "warn" ? "warning" : "muted"}>{meta.label}</Badge>
      </section>

      {/* 学习数据 */}
      <section className="grid grid-cols-3 gap-4">
        <StatBox value={formatDurationSec(progressAgg._sum.progressSec ?? 0)} label="累计学习" />
        <StatBox value={`${notesCount}`} label="笔记" />
        <StatBox value={`${votesAgg._sum.voteCount ?? 0}`} label="投票" />
      </section>

      {/* 连续学习 streak */}
      <section className="grid grid-cols-2 gap-4">
        <div className="flex items-center gap-3 rounded-2xl border border-ink-100 bg-paper-raised p-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-50 text-accent-600">
            <Flame size={22} weight="fill" />
          </div>
          <div>
            <div className="num text-2xl font-semibold text-ink-950">{gamification.currentStreak}<span className="ml-1 text-sm font-normal text-ink-400">天</span></div>
            <div className="text-xs text-ink-400">连续学习</div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-ink-100 bg-paper-raised p-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink-50 text-ink-500">
            <Trophy size={22} weight="fill" />
          </div>
          <div>
            <div className="num text-2xl font-semibold text-ink-950">{gamification.longestStreak}<span className="ml-1 text-sm font-normal text-ink-400">天</span></div>
            <div className="text-xs text-ink-400">最长连续记录</div>
          </div>
        </div>
      </section>

      {/* 潮汐日历：当前日基准由服务端按 Asia/Shanghai 算好传入，保证 SSR/CSR 一致 */}
      <TideCalendar calendar={gamification.calendar} todayKey={shanghaiDayKey()} />

      {/* 成就徽章 */}
      {gamification.achievements.length > 0 && (
        <section>
          <h2 className="mb-3 font-medium text-ink-950">成就徽章</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {gamification.achievements.map((a) => (
              <div key={a.key} className="flex items-center gap-3 rounded-xl border border-ink-100 bg-paper-raised p-3.5">
                <span className="text-2xl" aria-hidden>{a.icon || "🌊"}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-950">{a.name}</p>
                  {a.description && <p className="truncate text-xs text-ink-400">{a.description}</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 继续学习 */}
      {recent.length > 0 && (
        <section>
          <h2 className="mb-3 font-medium text-ink-950">继续学习</h2>
          <div className="space-y-2">
            {recent.map((r) => (
              <Link key={r.lessonId} href={`/courses/${r.course.slug}/learn/${r.lesson.id}`} className="flex items-center justify-between rounded-xl border border-ink-100 bg-paper-raised p-4 hover:border-accent-400">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-950">{r.course.title}</p>
                  <p className="truncate text-xs text-ink-400">{r.lesson.title}</p>
                </div>
                <span className="shrink-0 text-sm text-accent-700">继续 →</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 菜单 */}
      <section className="space-y-2">
        <MenuLink href="/me/subscription" label="订阅管理" hint={meta.label} />
        <MenuLink href="/notes" label="我的笔记" hint={`${notesCount} 条`} />
        <MenuLink href="/me/settings" label="设置（长辈模式 / 字号）" />
        <MenuLink href="/demands" label="我的共创需求" />
        {user.role !== "user" && <MenuLink href="/admin" label="运营后台" hint="管理" />}
      </section>

      <section className="space-y-2 pt-4">
        <div className="rounded-xl border border-ink-100 bg-paper-raised p-4 text-sm text-ink-500">
          <p className="font-medium text-ink-950">客服与反馈</p>
          <p className="mt-1">遇到问题？发送邮件到 support@tide.learning，或在需求广场留言。</p>
        </div>
        <LogoutButton />
        <button className="w-full rounded-xl px-4 py-3 text-left text-sm text-ink-400 hover:text-error">注销账号</button>
      </section>
    </div>
  );
}

function StatBox({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-paper-raised p-4 text-center">
      <div className="text-lg font-semibold text-ink-950 tabular">{value}</div>
      <div className="mt-0.5 text-xs text-ink-400">{label}</div>
    </div>
  );
}
function MenuLink({ href, label, hint }: { href: string; label: string; hint?: string }) {
  return (
    <Link href={href} className="flex items-center justify-between rounded-xl border border-ink-100 bg-paper-raised px-4 py-3.5 hover:border-accent-400">
      <span className="text-sm font-medium text-ink-950">{label}</span>
      <span className="flex items-center gap-2 text-sm text-ink-400">{hint}<span className="text-ink-300">›</span></span>
    </Link>
  );
}
