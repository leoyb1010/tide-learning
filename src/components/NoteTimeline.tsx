"use client";

import Link from "next/link";
import { Clock, Star, Trash, Scissors, Camera } from "@phosphor-icons/react";
import { motion } from "framer-motion";
import { Stagger, StaggerItem, EASE } from "@/components/motion";
import { Badge } from "@/components/ui";
import { mmss } from "@/lib/format";
import { renderMarkdown } from "@/lib/markdown";
import type { NoteRow } from "@/app/notes/page";

/** 笔记类型徽章元数据 */
const KIND_META: Record<string, { label: string; icon: typeof Camera }> = {
  capture: { label: "截帧", icon: Camera },
  clip: { label: "剪藏", icon: Scissors },
};

/** 按上海时区日期分组（YYYY-MM-DD） */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric", weekday: "short" });
}
function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

interface TimelineProps {
  notes: NoteRow[];
  onToggleStar: (n: NoteRow) => void;
  onDelete: (n: NoteRow) => void;
}

/**
 * 时间轴视图（B4）：按日期分组，左侧一条波形潮汐线穿起每天的笔记。
 */
export function NoteTimeline({ notes, onToggleStar, onDelete }: TimelineProps) {
  // 已按 updatedAt desc 到达；这里按 createdAt 分组以呈现"记录的那天"
  const groups = new Map<string, { label: string; items: NoteRow[] }>();
  for (const n of notes) {
    const k = dayKey(n.createdAt);
    const g = groups.get(k) ?? { label: dayLabel(n.createdAt), items: [] };
    g.items.push(n);
    groups.set(k, g);
  }

  return (
    <div className="space-y-10">
      {Array.from(groups.entries()).map(([k, { label, items }]) => (
        <section key={k}>
          <div className="mb-4 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-ink-800">{label}</h2>
            <span className="text-xs text-ink-400">{items.length} 条</span>
          </div>
          {/* 左侧波形潮汐线 */}
          <div className="relative pl-6">
            <span className="pointer-events-none absolute left-[7px] top-1 bottom-1 w-px bg-gradient-to-b from-accent-200 via-accent-300 to-transparent" />
            <Stagger className="space-y-3">
              {items.map((n) => {
                const meta = KIND_META[n.kind];
                const Icon = meta?.icon;
                return (
                  <StaggerItem key={n.id}>
                    <div className="relative">
                      {/* 潮汐节点 */}
                      <motion.span
                        className="absolute -left-[22px] top-4 h-2.5 w-2.5 rounded-full bg-accent-400 ring-2 ring-paper"
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ duration: 0.4, ease: EASE }}
                      />
                      <div className="group rounded-2xl border border-ink-100 bg-paper-raised p-4 transition-all hover:border-accent-400">
                        <div className="mb-1.5 flex items-center gap-2 text-xs text-ink-400">
                          <Link href={`/courses/${n.course.slug}`} className="truncate hover:text-accent-700">
                            {n.course.title}
                          </Link>
                          <span aria-hidden>·</span>
                          <span className="truncate">{n.lesson.title}</span>
                          {n.timestampSec != null && (
                            <Link
                              href={`/courses/${n.courseId}/learn/${n.lessonId}?t=${n.timestampSec}`}
                              className="num ml-auto inline-flex shrink-0 items-center gap-1 rounded bg-accent-50 px-1.5 text-accent-700 hover:bg-accent-100"
                            >
                              <Clock size={11} weight="fill" /> {mmss(n.timestampSec)}
                            </Link>
                          )}
                        </div>

                        <div className="flex items-start gap-3">
                          {n.kind === "capture" && n.captureUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={n.captureUrl}
                              alt={n.title ?? "截帧"}
                              loading="lazy"
                              className="h-16 w-24 shrink-0 rounded-lg object-cover"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              {meta && Icon && (
                                <span className="inline-flex items-center gap-0.5 rounded bg-ink-50 px-1.5 py-0.5 text-[10px] font-medium text-ink-500">
                                  <Icon size={11} weight="fill" /> {meta.label}
                                </span>
                              )}
                              {n.title && <p className="truncate font-medium text-ink-950">{n.title}</p>}
                            </div>
                            {n.kind === "clip" && n.sourceText && (
                              <blockquote className="mt-1 border-l-2 border-accent-200 pl-2 text-sm italic text-ink-600">
                                {n.sourceText}
                              </blockquote>
                            )}
                            {n.contentMd?.trim() && (
                              <div
                                className="tide-md mt-1 line-clamp-4 text-sm text-ink-800"
                                dangerouslySetInnerHTML={{ __html: renderMarkdown(n.contentMd) }}
                              />
                            )}
                            {n.tags.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {n.tags.map((t) => (
                                  <Badge key={t.id} tone={t.color}>
                                    {t.name}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* 悬浮操作 */}
                          <div className="flex shrink-0 flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              type="button"
                              onClick={() => onToggleStar(n)}
                              aria-label={n.starred ? "取消收藏" : "收藏"}
                              className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-50 hover:text-accent-600"
                            >
                              <Star size={16} weight={n.starred ? "fill" : "regular"} className={n.starred ? "text-accent-500" : ""} />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDelete(n)}
                              aria-label="删除"
                              className="rounded-lg p-1.5 text-ink-400 hover:bg-error/10 hover:text-error"
                            >
                              <Trash size={16} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </StaggerItem>
                );
              })}
            </Stagger>
          </div>
        </section>
      ))}
    </div>
  );
}
