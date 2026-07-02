import Link from "next/link";
import { Play, LockSimple } from "@phosphor-icons/react/dist/ssr";
import { Badge } from "./ui";
import { formatDurationSec } from "@/lib/format";

interface LessonRow {
  id: string;
  title: string;
  summary?: string | null;
  contentType?: string;
  durationSec: number;
  isFree: boolean;
  canAccess: boolean;
}

export function LessonList({ courseSlug, lessons }: { courseSlug: string; lessons: LessonRow[] }) {
  return (
    <ul className="divide-y divide-ink-100 overflow-hidden rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised">
      {lessons.map((l, i) => (
        <li key={l.id}>
          <Link
            href={`/courses/${courseSlug}/learn/${l.id}`}
            className="group flex items-center gap-4 px-5 py-4 transition-colors duration-200 hover:bg-accent-50/60"
          >
            <span className="num w-6 shrink-0 text-center text-sm text-ink-400">{String(i + 1).padStart(2, "0")}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-medium text-ink-950 group-hover:text-accent-700">{l.title}</span>
                {l.isFree && <Badge tone="accent">免费试学</Badge>}
                {l.contentType === "article" && <Badge tone="muted">图文</Badge>}
                {l.contentType === "live" && <Badge tone="warning">直播小班</Badge>}
              </div>
              {l.summary && <p className="mt-0.5 truncate text-sm text-ink-400">{l.summary}</p>}
            </div>
            <span className="num shrink-0 text-xs text-ink-400">{formatDurationSec(l.durationSec)}</span>
            <span className="w-5 shrink-0 text-ink-300">
              {l.canAccess ? <Play size={16} weight="fill" className="text-accent-600" /> : <LockSimple size={15} />}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
