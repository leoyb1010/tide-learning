/**
 * /me/settings 内容区加载骨架。
 * 渲染于共享 layout 的右内容区（layout 的返回链/标题/导航已在壳内），
 * 故此处只画一张分区卡骨架，贴合子路由内容形状。
 */
export default function SettingsLoading() {
  return (
    <div className="space-y-6">
      <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)] sm:p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="skeleton h-9 w-9 rounded-[10px]" />
          <div className="space-y-1.5">
            <div className="skeleton h-4 w-24 rounded" />
            <div className="skeleton h-3 w-32 rounded" />
          </div>
        </div>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, j) => (
            <div key={j} className="flex items-center justify-between">
              <div className="skeleton h-4 w-40 rounded" />
              <div className="skeleton h-5 w-16 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
