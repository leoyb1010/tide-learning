/**
 * 订阅方案骨架屏 —— 点击瞬间反馈。
 * 仿定价页布局：居中头部 → 全站会员三档价卡 → 权益对比表。
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-[1120px] space-y-16 py-4">
      {/* 居中头部 */}
      <header className="flex flex-col items-center">
        <div className="skeleton h-3 w-40" />
        <div className="skeleton mt-3 h-8 w-64" />
        <div className="skeleton mt-4 h-4 w-96 max-w-full" />
      </header>

      {/* 全站会员：三档价卡 */}
      <section>
        <div className="mb-6 flex flex-col items-center">
          <div className="skeleton h-5 w-28" />
          <div className="skeleton mt-2 h-3 w-40" />
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--card)]"
            >
              <div className="skeleton mb-3 h-4 w-1/2" />
              <div className="skeleton mb-2 h-8 w-24" />
              <div className="skeleton mb-6 h-3 w-1/3" />
              <div className="mb-6 space-y-2">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="skeleton h-3 w-full" />
                ))}
              </div>
              <div className="skeleton h-11 w-full rounded-[12px]" />
            </div>
          ))}
        </div>
      </section>

      {/* 权益对比表 */}
      <section className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)]">
        <div className="skeleton mb-5 h-5 w-28" />
        <div className="space-y-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="grid grid-cols-4 gap-3">
              <div className="skeleton h-4 w-full" />
              <div className="skeleton h-4 w-2/3" />
              <div className="skeleton h-4 w-2/3" />
              <div className="skeleton h-4 w-2/3" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
