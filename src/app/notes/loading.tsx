/**
 * 笔记骨架屏：点击瞬间反馈。
 * v3.0：对齐首屏真实布局（「全部」视图）:
 *   头部（标题 + 记一条/导出）→ 视图切换胶囊行 + 搜索框 → 双列笔记卡网格骨架。
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-[1120px] space-y-7">
      {/* 头部：标题块 + 右上操作按钮 */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <div className="skeleton h-3 w-24 rounded" />
          <div className="skeleton h-7 w-28 rounded-[8px]" />
          <div className="skeleton h-4 w-72 max-w-full rounded" />
        </div>
        <div className="flex items-center gap-2.5">
          <div className="skeleton h-10 w-24 rounded-[12px]" />
          <div className="skeleton h-10 w-24 rounded-[12px]" />
        </div>
      </div>

      {/* 视图切换胶囊 + 筛选行 */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="skeleton h-9 w-[300px] max-w-full rounded-full" />
        <div className="skeleton h-8 w-16 rounded-full" />
        <div className="skeleton h-8 w-20 rounded-full" />
      </div>

      {/* 搜索框 */}
      <div className="skeleton h-11 w-full rounded-[14px]" />

      {/* 「全部」视图：双列笔记卡网格骨架 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]"
          >
            {/* 顶部元信息行 */}
            <div className="mb-2 flex items-center gap-2">
              <div className="skeleton h-3 w-20 rounded" />
              <div className="skeleton h-3 w-10 rounded" />
            </div>
            {/* 标题 */}
            <div className="skeleton mb-2 h-4 w-3/5 rounded" />
            {/* 正文预览两行 */}
            <div className="skeleton mb-1.5 h-3 w-full rounded" />
            <div className="skeleton mb-3 h-3 w-4/5 rounded" />
            {/* 标签 */}
            <div className="flex gap-1.5">
              <div className="skeleton h-5 w-14 rounded-full" />
              <div className="skeleton h-5 w-16 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
