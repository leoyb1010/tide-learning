import Link from "next/link";
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

// §6.3：免费章节显式标记；付费用户"继续学习"，非付费"试学/订阅"
export function LessonList({ courseSlug, lessons }: { courseSlug: string; lessons: LessonRow[] }) {
  return (
    <ul className="divide-y divide-ink-100 overflow-hidden rounded-2xl border border-ink-100 bg-paper-raised">
      {lessons.map((l, i) => (
        <li key={l.id}>
          <Link
            href={`/courses/${courseSlug}/learn/${l.id}`}
            className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-tide-50"
          >
            <span className="w-6 shrink-0 text-center text-sm tabular text-ink-400">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-ink-950">{l.title}</span>
                {l.isFree && <Badge tone="tide">免费试学</Badge>}
                {l.contentType === "article" && <Badge tone="muted">图文</Badge>}
              </div>
              {l.summary && <p className="mt-0.5 truncate text-sm text-ink-400">{l.summary}</p>}
            </div>
            <span className="shrink-0 text-xs text-ink-400 tabular">{formatDurationSec(l.durationSec)}</span>
            <span className="w-5 shrink-0 text-center text-ink-300">
              {l.canAccess ? "▶" : "🔒"}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
