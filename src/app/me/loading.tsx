/**
 * 「我的」骨架屏 —— 点击瞬间反馈。
 * 仿个人页布局：用户信息卡 → 本周节奏（柱状）+ 数据卡 → 最近学习列表。
 */
export default function Loading() {
  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-5">
      {/* 用户信息卡 */}
      <section className="flex items-center gap-4 rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)]">
        <div className="skeleton h-14 w-14 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <div className="skeleton mb-2 h-5 w-40" />
          <div className="skeleton h-3 w-28" />
        </div>
        <div className="skeleton h-9 w-20 rounded-[10px]" />
      </section>

      {/* 本周节奏 + 数据卡 */}
      <section className="grid gap-5 md:grid-cols-[1.4fr_1fr]">
        {/* 本周节奏柱状 */}
        <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)]">
          <div className="skeleton mb-5 h-4 w-24" />
          <div className="flex h-32 items-end justify-between gap-3">
            {[60, 90, 45, 110, 70, 30, 85].map((h, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-2">
                <div className="skeleton w-full rounded-[6px]" style={{ height: h }} />
                <div className="skeleton h-3 w-4" />
              </div>
            ))}
          </div>
        </div>
        {/* 数据统计卡 */}
        <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)]">
          <div className="skeleton mb-5 h-4 w-20" />
          <div className="grid grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}>
                <div className="skeleton mb-2 h-7 w-16" />
                <div className="skeleton h-3 w-12" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 最近学习列表 */}
      <section className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)]">
        <div className="skeleton mb-4 h-4 w-24" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="skeleton h-12 w-16 shrink-0 rounded-[10px]" />
              <div className="min-w-0 flex-1">
                <div className="skeleton mb-2 h-4 w-2/5" />
                <div className="skeleton h-3 w-1/4" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
