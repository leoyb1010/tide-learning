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
 * 时间轴视图（B4）：按日期分组，左侧一条潮汐线穿起每天的笔记。
 * 视觉换 STUDIO：白卡 + 软阴影 + 冷灰蓝墨色 + 品牌红节点。
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
            <h2 className="text-[14px] font-bold text-[var(--ink)]">{label}</h2>
            <span className="mono text-[12px] text-[var(--ink4)]">{items.length} 条</span>
          </div>
          {/* 左侧潮汐线 */}
          <div className="relative pl-6">
            <span className="pointer-events-none absolute left-[7px] bottom-1 top-1 w-px bg-gradient-to-b from-[var(--red)] via-[var(--red-soft-border)] to-transparent" />
            <Stagger className="space-y-3.5">
              {items.map((n) => {
                const meta = KIND_META[n.kind];
                const Icon = meta?.icon;
                const isCapture = n.kind === "capture";
                return (
                  <StaggerItem key={n.id}>
                    <div className="relative">
                      {/* 潮汐节点：截帧橙 / 其余红 */}
                      <motion.span
                        className="absolute -left-[22px] top-[18px] h-2.5 w-2.5 rounded-full ring-2 ring-[var(--bg)]"
                        style={{ background: isCapture ? "#f59e0b" : "var(--red)" }}
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ duration: 0.4, ease: EASE }}
                      />
                      <div className="studio-lift group rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]">
                        <div className="mb-1.5 flex items-center gap-2 text-[12px] text-[var(--ink4)]">
                          {/* 独立笔记(无课程)显示来源标识；课程内笔记可点跳课程 */}
                          {n.course ? (
                            <>
                              <Link href={`/courses/${n.course.slug}`} className="truncate transition-colors hover:text-[var(--red)]">
                                {n.course.title}
                              </Link>
                              {n.lesson && (
                                <>
                                  <span aria-hidden>·</span>
                                  <span className="truncate">{n.lesson.title}</span>
                                </>
                              )}
                            </>
                          ) : (
                            <span className="truncate">{n.source === "ai_transform" ? "AI 整理" : "独立笔记"}</span>
                          )}
                          {n.timestampSec != null && n.courseId && n.lessonId && (
                            <Link
                              href={`/courses/${n.courseId}/learn/${n.lessonId}?t=${n.timestampSec}`}
                              className="mono ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-2 py-0.5 text-[var(--red)] transition-colors"
                            >
                              <Clock size={11} weight="fill" /> {mmss(n.timestampSec)}
                            </Link>
                          )}
                        </div>

                        <div className="flex items-start gap-3">
                          {isCapture && n.captureUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={n.captureUrl}
                              alt={n.title ?? "截帧"}
                              loading="lazy"
                              className="h-16 w-24 shrink-0 rounded-[10px] object-cover"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              {meta && Icon && (
                                <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--surface-inset)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ink3)]">
                                  <Icon size={11} weight="fill" /> {meta.label}
                                </span>
                              )}
                              {n.title && <p className="truncate font-semibold text-[var(--ink)]">{n.title}</p>}
                            </div>
                            {n.kind === "clip" && n.sourceText && (
                              <blockquote className="mt-1.5 border-l-2 border-[var(--red-soft-border)] pl-2.5 text-[13px] italic leading-[1.6] text-[var(--ink3)]">
                                {n.sourceText}
                              </blockquote>
                            )}
                            {n.contentMd?.trim() && (
                              <div
                                className="tide-md mt-1 line-clamp-4 text-[14px] leading-[1.65] text-[var(--ink2)]"
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
                              title={n.starred ? "取消收藏" : "收藏"} aria-label={n.starred ? "取消收藏" : "收藏"}
                              className="rounded-[9px] p-1.5 text-[var(--ink4)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--red)]"
                            >
                              <Star size={16} weight={n.starred ? "fill" : "regular"} className={n.starred ? "text-[var(--red)]" : ""} />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDelete(n)}
                              title="删除" aria-label="删除"
                              className="rounded-[9px] p-1.5 text-[var(--ink4)] transition-colors hover:bg-[var(--red-soft)] hover:text-[var(--red)]"
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
