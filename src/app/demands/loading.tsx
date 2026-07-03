/**
 * 共创广场骨架屏 —— 点击瞬间反馈。
 * 仿需求页布局：深色 Banner → 筛选行 → 需求排行列表（左投票按钮 + 右需求内容）。
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-[1000px] space-y-6">
      {/* 深色 Banner 占位 */}
      <section className="relative overflow-hidden rounded-[20px] bg-[var(--video-bg)] p-[26px] shadow-[var(--lift)]">
        <div className="grid grid-cols-1 items-center gap-6 md:grid-cols-[1fr_.8fr]">
          <div>
            <div className="skeleton h-3 w-32 bg-white/10" />
            <div className="skeleton mt-3 h-7 w-3/4 bg-white/10" />
            <div className="skeleton mt-3 h-4 w-full bg-white/10" />
            <div className="skeleton mt-2 h-4 w-2/3 bg-white/10" />
          </div>
          <div className="flex md:justify-end">
            <div className="skeleton h-12 w-36 rounded-[12px] bg-white/10" />
          </div>
        </div>
      </section>

      {/* 筛选行 */}
      <div className="flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="skeleton h-9 w-20 rounded-[10px]" />
        ))}
      </div>

      {/* 需求排行列表 */}
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]"
          >
            {/* 投票按钮占位 */}
            <div className="skeleton h-16 w-14 shrink-0 rounded-[12px]" />
            {/* 需求内容 */}
            <div className="min-w-0 flex-1">
              <div className="skeleton mb-2 h-4 w-3/5" />
              <div className="skeleton mb-3 h-3 w-4/5" />
              <div className="flex gap-2">
                <div className="skeleton h-5 w-16 rounded-full" />
                <div className="skeleton h-5 w-12 rounded-full" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
