"use client";

import { useState } from "react";
import Link from "next/link";
import { CaretRight, Play, Check, ListChecks } from "@phosphor-icons/react/dist/ssr";
import { CoverBg } from "@/components/ui";

/**
 * HistoryGroups —— /me/history 分组列表（client：仅承载「展开/折叠」交互 + 懒挂载章节）。
 * 数据由 Server Component 预取并拍平传入（越权已在服务端 where userId 保证）。
 * 每个课程卡：封面渐变 + 课名/赛道 + 总进度条 + 最近学习 + 已学章节数；点击展开其全部章节进度。
 * 展开时才渲染章节列表（chapters 已在数据里，展开为纯 UI 显隐，无额外请求）。
 */

export interface HistoryLesson {
  lessonId: string;
  title: string;
  sortOrder: number;
  pct: number;
  done: boolean;
  lastPlayedLabel: string;
}

export interface HistoryCourse {
  courseId: string;
  slug: string;
  title: string;
  trackLabel: string;
  coverColor: string;
  coverSrc: string | null;
  totalLessons: number; // 课程总章节数（含未学）
  learnedLessons: number; // 有进度记录的章节数
  doneLessons: number; // 已完成章节数
  coursePct: number; // 总进度（完成章节 / 课程总章节）
  lastPlayedLabel: string;
  lessons: HistoryLesson[]; // 该用户在此课程有进度的章节，按 sortOrder
}

export function HistoryGroups({ courses }: { courses: HistoryCourse[] }) {
  // 首个课程默认展开，其余折叠，减少首屏视觉噪音。
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    courses.length > 0 ? { [courses[0].courseId]: true } : {},
  );

  return (
    <ul className="stagger flex flex-col gap-3.5">
      {courses.map((c, i) => {
        const isOpen = open[c.courseId] ?? false;
        const panelId = `history-lessons-${c.courseId}`;
        return (
          <li
            key={c.courseId}
            style={{ "--i": i } as React.CSSProperties}
            className="studio-lift overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card),var(--inner-hi)]"
          >
            {/* 课程头：整行是「展开/折叠」触发器（≥44px 触达）。课名点进课程详情由展开区内提供，
                此处头行专注分组开合，避免嵌套链接。 */}
            <button
              type="button"
              onClick={() => setOpen((o) => ({ ...o, [c.courseId]: !o[c.courseId] }))}
              aria-expanded={isOpen}
              aria-controls={panelId}
              className="flex w-full items-center gap-3.5 p-3.5 text-left transition-colors hover:bg-[var(--surface2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]/40"
            >
              {/* 封面缩略（渐变兜底，有图覆盖） */}
              <CoverBg
                color={c.coverColor}
                imageSrc={c.coverSrc}
                alt={c.title}
                className="h-14 w-[84px] shrink-0 rounded-[11px]"
              />
              <div className="min-w-0 flex-1">
                <div className="mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink4)]">
                  {c.trackLabel}
                </div>
                <p className="mt-0.5 truncate text-[15px] font-bold leading-snug text-[var(--ink)]">
                  {c.title}
                </p>
                {/* 总进度条 + 百分比 */}
                <div className="mt-2 flex items-center gap-2.5">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-inset)]">
                    <div
                      className={`h-full rounded-full ${c.coursePct >= 100 ? "bg-[var(--ok)]" : "bg-[var(--red)]"}`}
                      style={{ width: `${c.coursePct}%` }}
                    />
                  </div>
                  <span
                    className={`mono shrink-0 text-[11px] font-semibold ${c.coursePct >= 100 ? "text-[var(--ok)]" : "text-[var(--ink3)]"}`}
                  >
                    {c.coursePct}%
                  </span>
                </div>
                <p className="mono mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--ink4)]">
                  <span className="inline-flex items-center gap-1">
                    <ListChecks size={12} weight="bold" />
                    已学 {c.learnedLessons}/{c.totalLessons} 节
                  </span>
                  <span aria-hidden>·</span>
                  <span>最近 {c.lastPlayedLabel}</span>
                </p>
              </div>
              {/* 展开箭头（旋转指示，reduce-motion 由全局过渡降级） */}
              <CaretRight
                size={16}
                weight="bold"
                className={`shrink-0 text-[var(--ink4)] transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
                aria-hidden
              />
            </button>

            {/* 章节列表（展开区）：每节独立进度点，可从其进度「继续」/「重温」 */}
            {isOpen && (
              <div
                id={panelId}
                className="studio-rise border-t border-[var(--border)] bg-[var(--surface2)] px-3.5 py-3"
              >
                <ul className="flex flex-col">
                  {c.lessons.map((l, li) => (
                    <li
                      key={l.lessonId}
                      className={`flex items-center gap-3 py-2.5 ${li > 0 ? "border-t border-[var(--border)]" : ""}`}
                    >
                      {/* 状态点：完成绿勾 / 进行中序号 */}
                      <span
                        className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                          l.done
                            ? "bg-[var(--ok-soft)] text-[var(--ok)]"
                            : "bg-[var(--surface-inset)] text-[var(--ink3)]"
                        }`}
                        aria-hidden
                      >
                        {l.done ? <Check size={13} weight="bold" /> : l.sortOrder + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-semibold text-[var(--ink)]">
                          {l.title}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          <div className="h-1 w-24 overflow-hidden rounded-full bg-[var(--surface-inset)]">
                            <div
                              className={`h-full rounded-full ${l.done ? "bg-[var(--ok)]" : "bg-[var(--red)]"}`}
                              style={{ width: `${l.pct}%` }}
                            />
                          </div>
                          <span className="mono text-[10px] text-[var(--ink4)]">
                            {l.pct}% · {l.lastPlayedLabel}
                          </span>
                        </div>
                      </div>
                      {/* 从该章节进度「继续/重温」 */}
                      <Link
                        href={`/courses/${c.slug}/learn/${l.lessonId}`}
                        className="studio-press inline-flex h-9 shrink-0 items-center gap-1 rounded-[10px] bg-[var(--red)] px-3 text-[12.5px] font-semibold text-white transition-[filter] hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]/50"
                      >
                        <Play size={11} weight="fill" /> {l.done ? "重温" : "继续"}
                      </Link>
                    </li>
                  ))}
                </ul>
                {/* 进入课程详情（脱离头行的分组交互，放在展开区底部） */}
                <Link
                  href={`/courses/${c.slug}`}
                  className="mt-1 inline-flex items-center gap-1 py-1.5 text-[12px] font-semibold text-[var(--ink3)] transition-colors hover:text-[var(--red)]"
                >
                  查看课程详情
                  <CaretRight size={11} weight="bold" />
                </Link>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
