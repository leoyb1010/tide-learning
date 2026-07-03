/**
 * /me/settings 加载骨架 —— 贴合设置页（返回链 + 标题 + 若干设置分区卡）。
 */
export default function SettingsLoading() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 py-4">
      <div className="skeleton h-4 w-16 rounded" />
      <div className="skeleton h-8 w-24 rounded-lg" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)]"
        >
          <div className="skeleton mb-4 h-4 w-20 rounded" />
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, j) => (
              <div key={j} className="flex items-center justify-between">
                <div className="skeleton h-4 w-40 rounded" />
                <div className="skeleton h-5 w-9 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
