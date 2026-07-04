"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SquaresFour, Books } from "@phosphor-icons/react";
import type { CourseCardData } from "./CourseCard";
import { CourseShelf } from "./CourseShelf";

/* ============================================================
   课程库 · 视图切换外壳（client）
   两种布局：grid（网格，server 渲染的卡片，作为 children 传入）
            shelf（书架，client 渲染 CourseShelf）
   偏好记忆：localStorage("courses:view") + URL ?view= 同步（可分享/回退）。
   切换控件复用 v3.1 segmented（.seg-track/.seg-thumb/.seg-btn/.seg-dot，当前项红点睛）。
   边界：grid 卡片在 server page 已渲染好，本组件只决定「显示哪个」——
        不引任何 server 链，shelf 数据由 props 传入。
   ============================================================ */

type View = "grid" | "shelf";
const STORAGE_KEY = "courses:view";
const OPTIONS: { key: View; label: string; Icon: typeof SquaresFour }[] = [
  { key: "grid", label: "网格", Icon: SquaresFour },
  { key: "shelf", label: "书架", Icon: Books },
];

export function CourseLibraryView({
  courses,
  grid,
}: {
  courses: CourseCardData[];
  /** server page 渲染好的网格视图（CourseCard 网格）。作为 children 传入以守住 client/server 边界。 */
  grid: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // URL ?view= 优先；否则待挂载后读 localStorage。SSR 首帧统一走 URL/网格，避免 hydration 抖动。
  const urlView = params.get("view") === "shelf" ? "shelf" : params.get("view") === "grid" ? "grid" : null;
  const [view, setView] = useState<View>(urlView ?? "grid");

  // 挂载后：无 URL 指定时采用上次偏好（localStorage）。
  useEffect(() => {
    if (urlView) return;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "shelf" || saved === "grid") setView(saved);
    } catch {
      /* localStorage 不可用（隐私模式等）时静默保持默认 */
    }
    // 仅首次挂载读取一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function choose(next: View) {
    if (next === view) return;
    setView(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* 忽略写入失败 */
    }
    // 浅同步 URL（replace，不新增历史项、不触发服务端重取）——保持可分享与前进后退一致。
    const sp = new URLSearchParams(params.toString());
    if (next === "shelf") sp.set("view", "shelf");
    else sp.delete("view");
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // —— segmented 滑块几何：测量当前项按钮位置，驱动 --seg-x/--seg-w ——
  const trackRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [thumb, setThumb] = useState<{ x: number; w: number }>({ x: 0, w: 0 });

  useLayoutEffect(() => {
    const activeIdx = OPTIONS.findIndex((o) => o.key === view);
    const btn = btnRefs.current[activeIdx];
    const track = trackRef.current;
    if (!btn || !track) return;
    setThumb({ x: btn.offsetLeft - 4, w: btn.offsetWidth });
  }, [view]);

  return (
    <div className="flex flex-col gap-4">
      {/* 头部行：左侧计数，右侧视图切换（右对齐，克制不喧宾夺主） */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] text-[var(--ink3)]">
          共 <span className="mono num-pop font-semibold text-[var(--ink)]">{courses.length}</span> 门课程
        </span>

        <div
          ref={trackRef}
          className="seg-track"
          role="tablist"
          aria-label="课程库视图切换"
          style={{ ["--seg-x" as string]: `${thumb.x}px`, ["--seg-w" as string]: `${thumb.w}px` }}
        >
          <span className="seg-thumb" aria-hidden />
          {OPTIONS.map((o, i) => (
            <button
              key={o.key}
              ref={(el) => {
                btnRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={view === o.key}
              data-active={view === o.key}
              onClick={() => choose(o.key)}
              className="seg-btn"
            >
              <o.Icon size={16} weight={view === o.key ? "fill" : "regular"} aria-hidden />
              {o.label}
              <span className="seg-dot" aria-hidden />
            </button>
          ))}
        </div>
      </div>

      {/* 视图区：网格用 server 传入的 children；书架用 client CourseShelf。
          用 hidden 保留两者 DOM 亦可，但书架 3D 层较重——按需只渲染当前视图。 */}
      {view === "grid" ? grid : <CourseShelf courses={courses} />}
    </div>
  );
}
