/**
 * /demands/[demandId] 加载骨架 —— 贴合需求详情（标题卡 + 阶段轨 + 正文 + 投票 + 评论区）。
 */
export default function DemandDetailLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 py-4">
      {/* 标题 + 状态卡 */}
      <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--card)]">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-3">
            <div className="flex gap-2">
              <div className="skeleton h-5 w-16 rounded-full" />
              <div className="skeleton h-5 w-20 rounded-full" />
            </div>
            <div className="skeleton h-7 w-3/4 rounded-lg" />
            <div className="skeleton h-4 w-full rounded" />
            <div className="skeleton h-4 w-2/3 rounded" />
          </div>
          <div className="skeleton h-16 w-16 shrink-0 rounded-[14px]" />
        </div>
      </div>
      {/* 阶段轨 */}
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-9 flex-1 rounded-[10px]" />
        ))}
      </div>
      {/* 评论区 */}
      <div className="space-y-4">
        <div className="skeleton h-5 w-24 rounded" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]"
          >
            <div className="mb-2 flex items-center gap-2">
              <div className="skeleton h-7 w-7 rounded-full" />
              <div className="skeleton h-3 w-20 rounded" />
            </div>
            <div className="skeleton h-4 w-full rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
