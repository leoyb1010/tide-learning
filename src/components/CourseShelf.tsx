"use client";

import Link from "next/link";
import { PlayCircle, Sparkle, Books } from "@phosphor-icons/react";
import type { CourseCardData } from "./CourseCard";
import { TRACKS } from "@/lib/tracks";

/* ============================================================
   课程库 · 书架视图（shelf）
   每门课 = 竖立的一本书；书脊显示课名 + 赛道色 + 厚度按课时。
   按赛道分层（每条赛道一格隔板，横向排开）。
   hover 抽书前倾（CSS .book-spine 3D），进场逐本落位（--i 递延）。
   纯展示：课程数据由 server page 作 props 传入，本组件不触任何 server 链。
   ============================================================ */

/** 赛道 → 书脊双色（实色端点，取自 --track-* 渐变色，避免直接用 gradient 变量做单色）。 */
const SPINE_COLORS: Record<string, { a: string; b: string; ink: string }> = {
  ai_skill: { a: "#7b5cf0", b: "#4a2fc0", ink: "#f4f0ff" },
  english_oral: { a: "#2ba578", b: "#166849", ink: "#eafff6" },
  english_foundation: { a: "#2ba578", b: "#166849", ink: "#eafff6" },
  silver_english: { a: "#e0843c", b: "#b0501f", ink: "#fff4ea" },
  life: { a: "#3b8dd6", b: "#245a97", ink: "#eaf4ff" },
  default: { a: "#5b6474", b: "#2d3440", ink: "#eef1f6" },
};

function spineFor(category?: string) {
  return SPINE_COLORS[category ?? "default"] ?? SPINE_COLORS.default;
}

/** 书脊厚度：按课时数在 44–128px 间映射（触达下限 ≥44px），课时越多书越厚。 */
function spineWidth(lessonsCount: number): number {
  const min = 44;
  const max = 128;
  const w = min + Math.min(lessonsCount, 24) * 3.6;
  return Math.round(Math.max(min, Math.min(max, w)));
}

/** 书脊高度：轻微随厚度浮动，让书架高低错落有真实藏书感（非等高呆板）。 */
function spineHeight(lessonsCount: number): number {
  const base = 232;
  const jitter = (lessonsCount % 5) * 8;
  return base + jitter;
}

function BookSpine({ course, index }: { course: CourseCardData; index: number }) {
  const spine = spineFor(course.category);
  const width = spineWidth(course.lessonsCount ?? 0);
  const height = spineHeight(course.lessonsCount ?? 0);
  const isFree = course.freeLessonsCount > 0;

  return (
    <Link
      href={`/courses/${course.slug}`}
      aria-label={`${course.title}，${course.categoryLabel}，${course.lessonsCount ?? 0} 节`}
      className="book-spine group/book relative flex shrink-0 flex-col overflow-hidden rounded-t-[6px] rounded-b-[3px] focus:outline-none"
      style={
        {
          width,
          height,
          "--i": index,
          "--spine-a": spine.a,
          "--spine-b": spine.b,
        } as React.CSSProperties
      }
    >
      {/* 书脊顶部：赛道标 + 免费/NEW 点睛（横排小徽，克制） */}
      <div className="relative flex items-center justify-between gap-1 px-2 pt-2.5">
        <span
          className="mono truncate text-[8.5px] font-semibold uppercase tracking-[0.1em]"
          style={{ color: spine.ink, opacity: 0.72 }}
        >
          {course.categoryLabel}
        </span>
        {course.isNew && (
          <Sparkle size={11} weight="fill" style={{ color: spine.ink }} aria-hidden />
        )}
      </div>

      {/* 书名：纵向排版（书脊上的竖排书名），是书架的灵魂。
          writing-mode 竖排 + 上下居中，长标题自动截断。 */}
      <div className="relative flex flex-1 items-center justify-center px-1 py-2">
        <span
          className="line-clamp-4 max-h-full text-[15px] font-bold leading-[1.15] tracking-tight"
          style={{
            writingMode: "vertical-rl",
            textOrientation: "mixed",
            color: spine.ink,
            textShadow: "0 1px 2px rgba(0,0,0,.28)",
          }}
        >
          {course.title}
        </span>
      </div>

      {/* 书脊下端：课时数（书的「厚度」实证）+ 免费点。底部一条烫金色描边作书脊装饰线。 */}
      <div className="relative px-2 pb-2.5">
        <div
          className="mb-1.5 h-px w-full"
          style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,.42), transparent)" }}
        />
        <div className="flex items-center justify-between">
          <span
            className="mono text-[9px] font-semibold tracking-wide"
            style={{ color: spine.ink, opacity: 0.68 }}
          >
            {course.lessonsCount ?? 0} 节
          </span>
          {isFree && (
            <>
              <PlayCircle
                size={13}
                weight="fill"
                aria-hidden
                className="text-[var(--red)] drop-shadow-[0_1px_2px_rgba(0,0,0,.35)]"
              />
              <span className="sr-only">含免费试学</span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}

export function CourseShelf({ courses }: { courses: CourseCardData[] }) {
  // 按赛道分组（TRACKS 顺序为准）；未归入任何赛道的落到「其他」隔板末尾。
  const known = new Set(TRACKS.map((t) => t.key));
  const groups = TRACKS.map((t) => ({
    key: t.key,
    label: t.label,
    blurb: t.blurb,
    items: courses.filter((c) => c.category === t.key),
  })).filter((g) => g.items.length > 0);

  const others = courses.filter((c) => !c.category || !known.has(c.category));
  if (others.length > 0) {
    groups.push({ key: "__other", label: "其他课程", blurb: "更多板块持续上架", items: others });
  }

  // 全局递增序号：跨隔板连续，让整面书架从上到下「一本本落位」形成一条节奏线。
  let globalIndex = 0;

  return (
    <div className="flex flex-col gap-7">
      {groups.map((g) => {
        const spine = spineFor(g.key === "__other" ? "default" : g.key);
        return (
          <section key={g.key} aria-label={`${g.label} 书架`} className="flex flex-col">
            {/* 隔板标题：赛道名 + 一句人群说明 + 本层册数。左侧一枚赛道色书脊小标做视觉锚。 */}
            <div className="mb-2 flex items-end justify-between gap-3 px-0.5">
              <div className="flex items-center gap-2.5">
                <span
                  className="h-4 w-1.5 rounded-full"
                  style={{ background: `linear-gradient(180deg, ${spine.a}, ${spine.b})` }}
                  aria-hidden
                />
                <div className="flex flex-col">
                  <h2 className="text-[15px] font-bold leading-tight tracking-tight text-[var(--ink)]">
                    {g.label}
                  </h2>
                  <span className="text-[12px] leading-tight text-[var(--ink3)]">{g.blurb}</span>
                </div>
              </div>
              <span className="mono shrink-0 text-[11px] tracking-wide text-[var(--ink4)]">
                <span className="num font-semibold text-[var(--ink2)]">{g.items.length}</span> 册
              </span>
            </div>

            {/* 隔板本体：透视容器 + 底托。书靠底对齐、横向可滚动（书多时像翻找书架）。 */}
            <div className="shelf-row">
              <div className="shelf-plank overflow-x-auto overflow-y-visible px-4 pb-3.5 pt-6 [scrollbar-width:thin]">
                <div className="flex items-end gap-2.5" style={{ minHeight: 240 }}>
                  {g.items.map((c) => (
                    <BookSpine key={c.id} course={c} index={globalIndex++} />
                  ))}
                </div>
              </div>
            </div>
          </section>
        );
      })}

      {groups.length === 0 && (
        <div className="elev-1 flex flex-col items-center justify-center rounded-[18px] px-6 py-16 text-center">
          <Books size={30} weight="light" className="text-[var(--ink3)]" aria-hidden />
          <p className="mt-3 text-[15px] font-semibold text-[var(--ink)]">书架空空</p>
          <p className="mt-1 text-[13px] text-[var(--ink3)]">换个筛选条件，或看看全部课程。</p>
        </div>
      )}
    </div>
  );
}
