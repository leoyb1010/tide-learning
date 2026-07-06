/**
 * /checkout 加载骨架 —— 贴合 mock 收银台卡片形状（页头 + 二维码占位 + 订单摘要 + 支付按钮）。
 * 纯占位（.skeleton 微光扫过），无数据依赖；消除跳转收银台时的白屏感。
 */
export default function CheckoutLoading() {
  return (
    <div className="mx-auto max-w-md py-8">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--card)]">
        {/* 页头 */}
        <div className="flex flex-col items-center gap-2">
          <div className="skeleton h-4 w-24 rounded" />
          <div className="skeleton h-3 w-40 rounded" />
        </div>

        {/* 二维码占位 */}
        <div className="skeleton mx-auto mt-6 h-44 w-44 rounded-xl" />

        {/* 订单摘要 */}
        <div className="mt-6 space-y-3 border-t border-[var(--border)] pt-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="skeleton h-4 w-16 rounded" />
              <div className="skeleton h-4 w-24 rounded" />
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-[var(--border)] pt-3">
            <div className="skeleton h-4 w-12 rounded" />
            <div className="skeleton h-8 w-24 rounded-lg" />
          </div>
        </div>

        {/* 支付按钮 */}
        <div className="mt-6 space-y-3">
          <div className="skeleton h-12 w-full rounded-xl" />
          <div className="skeleton h-10 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
