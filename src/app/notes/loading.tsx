/**
 * 笔记骨架屏 —— 点击瞬间反馈。
 * 仿笔记页布局：顶部（视图切换 + 搜索）→ 时间轴列表骨架（左时间轴 + 右笔记条）。
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      {/* 头部：视图切换 tab + 搜索框 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton h-9 w-20 rounded-[10px]" />
          ))}
        </div>
        <div className="skeleton h-9 w-56 rounded-[10px]" />
      </div>

      {/* 时间轴列表骨架 */}
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-4">
            {/* 左侧时间轴刻度 */}
            <div className="flex w-16 shrink-0 flex-col items-center gap-2">
              <div className="skeleton h-3 w-12" />
              <div className="skeleton h-3 w-3 rounded-full" />
            </div>
            {/* 右侧笔记卡 */}
            <div className="flex-1 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]">
              <div className="skeleton mb-3 h-4 w-2/5" />
              <div className="skeleton mb-2 h-3 w-full" />
              <div className="skeleton mb-4 h-3 w-4/5" />
              <div className="flex gap-2">
                <div className="skeleton h-5 w-14 rounded-full" />
                <div className="skeleton h-5 w-16 rounded-full" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
