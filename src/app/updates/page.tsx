import Link from "next/link";
import { listUpdates } from "@/lib/queries";
import { Badge, EmptyState } from "@/components/ui";
import { UPDATE_TYPE_LABELS } from "@/lib/format";

export const metadata = { title: "本周上新" };
export const dynamic = "force-dynamic";

export default async function UpdatesPage() {
  const updates = await listUpdates(40);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-950">本周上新</h1>
        <p className="mt-1 text-ink-500">滚动更新的学习流 · 每条更新都有日志和责任人</p>
      </div>
      {updates.length === 0 ? (
        <EmptyState title="暂无更新" hint="课程正在制作中，很快就有新内容" />
      ) : (
        <div className="space-y-3">
          {updates.map((u) => (
            <Link key={u.id} href={`/courses/${u.courseSlug}`} className="flex items-start gap-4 rounded-2xl border border-ink-100 bg-paper-raised p-4 transition-shadow hover:shadow-[var(--shadow-soft)]">
              <div className="mt-0.5"><Badge tone="success">{UPDATE_TYPE_LABELS[u.updateType]}</Badge></div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink-950">{u.courseTitle}</span>
                  <span className="text-xs text-ink-400">{u.relativeTime}</span>
                </div>
                <p className="mt-1 text-sm text-ink-800">{u.title}</p>
                {u.description && <p className="mt-0.5 text-sm text-ink-500">{u.description}</p>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
