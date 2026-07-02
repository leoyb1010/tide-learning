"use client";

import Link from "next/link";
import { Clock } from "@phosphor-icons/react";
import { Stagger, StaggerItem } from "@/components/motion";
import { EmptyTide } from "@/components/TideIllustration";
import { Badge } from "@/components/ui";
import { mmss } from "@/lib/format";
import type { NoteRow } from "@/app/notes/page";

/**
 * 画廊视图（B4）：截帧笔记瀑布流。
 * 用 CSS columns 实现自然高度瀑布，卡片入场用 Stagger 涨潮。
 */
export function NoteGallery({ notes }: { notes: NoteRow[] }) {
  const captures = notes.filter((n) => n.kind === "capture" && n.captureUrl);
  if (captures.length === 0) {
    return <EmptyTide variant="notes" description="用播放器的截帧按钮，把画面钉进笔记馆" />;
  }
  return (
    <Stagger className="[column-fill:balance] gap-4 [columns:1] sm:[columns:2] lg:[columns:3]">
      {captures.map((n) => (
        <StaggerItem key={n.id} className="mb-4 inline-block w-full break-inside-avoid">
          <Link
            href={`/courses/${n.courseId}/learn/${n.lessonId}${n.timestampSec != null ? `?t=${n.timestampSec}` : ""}`}
            className="group block overflow-hidden rounded-2xl border border-ink-100 bg-paper-raised transition-all hover:border-accent-400 hover:shadow-sm"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={n.captureUrl ?? ""}
              alt={n.title ?? "截帧"}
              loading="lazy"
              className="w-full object-cover transition-transform duration-500 [transition-timing-function:var(--ease-out-expo)] group-hover:scale-[1.02]"
            />
            <div className="space-y-1.5 p-3">
              <div className="flex items-center gap-2 text-xs text-ink-400">
                <span className="truncate">{n.lesson.title}</span>
                {n.timestampSec != null && (
                  <span className="num ml-auto inline-flex shrink-0 items-center gap-1 rounded bg-accent-50 px-1.5 text-accent-700">
                    <Clock size={11} weight="fill" /> {mmss(n.timestampSec)}
                  </span>
                )}
              </div>
              {n.title && <p className="line-clamp-1 text-sm font-medium text-ink-950">{n.title}</p>}
              {n.contentMd?.trim() && <p className="line-clamp-2 text-xs text-ink-600">{n.contentMd}</p>}
              {n.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {n.tags.map((t) => (
                    <Badge key={t.id} tone={t.color}>
                      {t.name}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </Link>
        </StaggerItem>
      ))}
    </Stagger>
  );
}
