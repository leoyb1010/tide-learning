/**
 * /me/subscription 加载骨架 —— 贴合订阅管理（当前订阅卡 + 权益/账单表 + 订单历史）。
 */
export default function SubscriptionLoading() {
  return (
    <div className="mx-auto max-w-[880px] space-y-6">
      {/* 页头 */}
      <div className="space-y-2.5">
        <div className="skeleton h-8 w-32 rounded-lg" />
        <div className="skeleton h-4 w-64 rounded" />
      </div>
      {/* 当前订阅卡 */}
      <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--card)]">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="skeleton h-5 w-40 rounded" />
            <div className="skeleton h-3 w-56 rounded" />
          </div>
          <div className="skeleton h-9 w-24 rounded-[12px]" />
        </div>
        <div className="skeleton mt-5 h-2 w-full rounded-full" />
      </div>
      {/* 订单历史行 */}
      <div className="space-y-3">
        <div className="skeleton h-4 w-24 rounded" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]"
          >
            <div className="space-y-2">
              <div className="skeleton h-4 w-36 rounded" />
              <div className="skeleton h-3 w-24 rounded" />
            </div>
            <div className="skeleton h-4 w-16 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
