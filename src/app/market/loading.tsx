/**
 * 课程集市骨架屏（S5 三态审计）—— 点击瞬间反馈，匹配 /market 最终布局：
 * 头部 + 交易氛围条（三格）+ 排序行 + 橱窗商品网格（4 列）。
 * .skeleton 微光在 reduce-motion 下由全局规则自动静止。
 */
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6">
      {/* 头部 */}
      <div className="flex flex-col gap-2">
        <div className="skeleton h-3 w-28" />
        <div className="flex items-center gap-2.5">
          <div className="skeleton h-9 w-9 rounded-[11px]" />
          <div className="skeleton h-7 w-40" />
        </div>
        <div className="skeleton h-4 w-2/3 max-w-[420px]" />
      </div>

      {/* 交易氛围条 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            style={{ "--i": i } as React.CSSProperties}
            className="flex items-center gap-3 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
          >
            <div className="skeleton h-9 w-9 shrink-0 rounded-[10px]" />
            <div className="flex-1 space-y-1.5">
              <div className="skeleton h-2.5 w-16" />
              <div className="skeleton h-4 w-24" />
            </div>
          </div>
        ))}
      </div>

      {/* 排序行 */}
      <div className="flex items-center justify-between">
        <div className="skeleton h-4 w-28" />
        <div className="skeleton h-9 w-56 rounded-[11px]" />
      </div>

      {/* 橱窗商品网格 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            style={{ "--i": i } as React.CSSProperties}
            className="overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card)]"
          >
            {/* 封面 */}
            <div className="skeleton aspect-[16/10] w-full rounded-none" />
            <div className="space-y-3 p-4">
              <div className="skeleton h-4 w-4/5" />
              <div className="skeleton h-3.5 w-full" />
              <div className="flex items-center justify-between pt-1">
                <div className="skeleton h-3.5 w-16" />
                <div className="skeleton h-8 w-20 rounded-[10px]" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
