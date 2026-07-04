"use client";

import type { CourseCardData } from "./CourseCard";

/* ============================================================
   课程库 · 网格视图外壳（client）
   v4.0：书架视图挪去书桌，课程库回归纯网格。
   移除了网格/书架视图切换器与 shelf 分支（不再 import CourseShelf）——
   本组件只做一件事：顶部课程计数 + server page 渲染好的网格（作为 grid prop 传入）。
   CourseShelf 组件本身保留（书桌书架能力沿用同一套书脊视觉），仅课程库不再引用它。
   边界：grid 卡片在 server page 已渲染好，本组件不引任何 server 链。
   ============================================================ */

export function CourseLibraryView({
  courses,
  grid,
}: {
  courses: CourseCardData[];
  /** server page 渲染好的网格视图（CourseCard 网格）。作为 children 传入以守住 client/server 边界。 */
  grid: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* 头部行：课程计数（书架切换器已移除，课程库只做网格） */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] text-[var(--ink3)]">
          共 <span className="mono num-pop font-semibold text-[var(--ink)]">{courses.length}</span> 门课程
        </span>
      </div>

      {grid}
    </div>
  );
}
