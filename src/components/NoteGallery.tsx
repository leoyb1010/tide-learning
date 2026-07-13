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
 * 用 CSS columns 实现自然高度瀑布，卡片视觉换 STUDIO（白卡 + 软阴影 + 上浮）。
 */
export function NoteGallery({ notes }: { notes: NoteRow[] }) {
  const captures = notes.filter((n) => n.kind === "capture" && n.captureUrl);
  if (captures.length === 0) {
    return <EmptyTide variant="notes" description="用播放器的截帧按钮，把画面钉进笔记馆" />;
  }
  return (
    <Stagger className="gap-3.5 [column-fill:balance] [columns:1] sm:[columns:2] lg:[columns:3]">
      {captures.map((n) => (
        <StaggerItem key={n.id} className="mb-3.5 inline-block w-full break-inside-avoid">
          <Link
            href={n.courseId && n.lessonId
              ? `/courses/${n.courseId}/learn/${n.lessonId}${n.timestampSec != null ? `?t=${n.timestampSec}` : ""}`
              : `/notes/${n.id}`}
            className="studio-lift group block overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card),var(--inner-hi)]"
          >
            {/* 顶部标记点：截帧橙 */}
            { }
            <img
              src={n.captureUrl ?? ""}
              alt={n.title ?? "截帧"}
              loading="lazy"
              className="w-full object-cover transition-transform duration-500 [transition-timing-function:var(--ease-out-expo)] group-hover:scale-[1.02]"
            />
            <div className="space-y-1.5 p-3.5">
              <div className="flex items-center gap-2 text-[12px] text-[var(--ink4)]">
                <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--warn)" }} />
                <span className="truncate">{n.lesson?.title ?? "截帧笔记"}</span>
                {n.timestampSec != null && (
                  // 时间戳只是「第几秒」的中性元数据，改中性胶囊——把红留给 CTA/进度/到期这类关键信号
                  <span className="mono ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface2)] px-2 py-0.5 text-[var(--ink3)]">
                    <Clock size={11} weight="fill" /> {mmss(n.timestampSec)}
                  </span>
                )}
              </div>
              {n.title && <p className="line-clamp-1 text-[14px] font-semibold text-[var(--ink)]">{n.title}</p>}
              {n.contentMd?.trim() && (
                <p className="line-clamp-2 text-[13px] leading-[1.6] text-[var(--ink2)]">{n.contentMd}</p>
              )}
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
