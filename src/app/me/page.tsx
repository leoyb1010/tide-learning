import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement, STATUS_LABELS } from "@/lib/entitlement";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui";
import { LogoutButton } from "@/components/AccountActions";
import { formatDurationSec } from "@/lib/format";

export const metadata = { title: "我的" };

export default async function MePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/me");

  const [snapshot, progressAgg, notesCount, votesAgg, recent] = await Promise.all([
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
  ]);

  const meta = STATUS_LABELS[snapshot.subscriptionStatus] ?? STATUS_LABELS.free;

  return (
    <div className="space-y-6">
      {/* 用户信息 */}
      <section className="flex items-center gap-4 rounded-2xl border border-ink-100 bg-paper-raised p-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-tide-600 text-xl font-semibold text-white">
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

      {/* 继续学习 */}
      {recent.length > 0 && (
        <section>
          <h2 className="mb-3 font-medium text-ink-950">继续学习</h2>
          <div className="space-y-2">
            {recent.map((r) => (
              <Link key={r.lessonId} href={`/courses/${r.course.slug}/learn/${r.lesson.id}`} className="flex items-center justify-between rounded-xl border border-ink-100 bg-paper-raised p-4 hover:border-tide-400">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-950">{r.course.title}</p>
                  <p className="truncate text-xs text-ink-400">{r.lesson.title}</p>
                </div>
                <span className="shrink-0 text-sm text-tide-700">继续 →</span>
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
    <Link href={href} className="flex items-center justify-between rounded-xl border border-ink-100 bg-paper-raised px-4 py-3.5 hover:border-tide-400">
      <span className="text-sm font-medium text-ink-950">{label}</span>
      <span className="flex items-center gap-2 text-sm text-ink-400">{hint}<span className="text-ink-300">›</span></span>
    </Link>
  );
}
