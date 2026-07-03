/**
 * /me/courses 加载骨架 —— 贴合「我的课」网格布局（页头 + 课程卡网格）。
 */
export default function MyCoursesLoading() {
  return (
    <div className="mx-auto max-w-[1080px] space-y-6">
      {/* 页头 */}
      <div className="space-y-2.5">
        <div className="skeleton h-3 w-24 rounded" />
        <div className="skeleton h-8 w-40 rounded-lg" />
        <div className="skeleton h-4 w-72 rounded" />
      </div>
      {/* 课程卡网格 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card)]"
          >
            <div className="skeleton aspect-[16/10] w-full" />
            <div className="space-y-2.5 p-4">
              <div className="skeleton h-3 w-16 rounded" />
              <div className="skeleton h-5 w-3/4 rounded" />
              <div className="skeleton h-1.5 w-full rounded-full" />
              <div className="skeleton h-3 w-24 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
