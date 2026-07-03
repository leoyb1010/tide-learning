/**
 * 课程详情骨架屏 —— 点击瞬间反馈。
 * 仿详情页 1.55/.92 双栏：左列（预告视频 + 大纲列表），右列（订阅/信息卡）。
 */
export default function Loading() {
  return (
    <div className="space-y-12">
      <div className="grid items-start gap-5 lg:grid-cols-[1.55fr_.92fr]">
        {/* 左列 */}
        <div className="flex flex-col gap-[18px]">
          {/* 预告视频占位 */}
          <div className="skeleton aspect-[16/9] w-full rounded-[20px]" />

          {/* 标题 + 元信息 */}
          <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)]">
            <div className="skeleton mb-3 h-7 w-3/4" />
            <div className="skeleton mb-2 h-4 w-full" />
            <div className="skeleton h-4 w-2/3" />
          </div>

          {/* 大纲列表 */}
          <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)]">
            <div className="skeleton mb-4 h-5 w-24" />
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="skeleton h-8 w-8 shrink-0 rounded-full" />
                  <div className="skeleton h-4 flex-1" style={{ maxWidth: `${80 - i * 6}%` }} />
                  <div className="skeleton h-3 w-10 shrink-0" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 右列：订阅/信息卡 */}
        <aside className="flex flex-col gap-4">
          <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)]">
            <div className="skeleton mb-3 h-6 w-1/2" />
            <div className="skeleton mb-2 h-4 w-full" />
            <div className="skeleton mb-5 h-4 w-3/4" />
            <div className="skeleton h-11 w-full rounded-[12px]" />
          </div>
          <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)]">
            <div className="skeleton mb-3 h-4 w-1/3" />
            <div className="skeleton mb-2 h-3 w-full" />
            <div className="skeleton h-3 w-2/3" />
          </div>
        </aside>
      </div>
    </div>
  );
}
