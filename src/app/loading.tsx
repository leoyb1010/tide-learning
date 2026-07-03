/**
 * 首页骨架屏 —— 点击瞬间反馈，消除切换延迟感。
 * 仿首页布局：Hero（左文案块 + 右深色续播卡） → 课程赛道网格 → 共创/订阅 teaser。
 * 纯占位（.skeleton 微光扫过），无数据依赖。
 */
export default function Loading() {
  return (
    <div className="space-y-12">
      {/* Hero：左文案 / 右续播卡 */}
      <section className="grid items-stretch gap-5 lg:grid-cols-[1.1fr_.9fr]">
        <div className="flex flex-col justify-center gap-4 rounded-[20px] border border-[var(--border)] bg-[var(--surface)] p-7 shadow-[var(--card)]">
          <div className="skeleton h-3 w-32" />
          <div className="skeleton h-9 w-4/5" />
          <div className="skeleton h-9 w-3/5" />
          <div className="skeleton mt-2 h-4 w-2/3" />
          <div className="mt-3 flex gap-3">
            <div className="skeleton h-11 w-32 rounded-[12px]" />
            <div className="skeleton h-11 w-28 rounded-[12px]" />
          </div>
        </div>
        {/* 深色续播卡 */}
        <div className="relative overflow-hidden rounded-[20px] bg-[var(--video-bg)] p-6 shadow-[var(--lift)]">
          <div className="skeleton aspect-[16/9] w-full rounded-[14px] bg-white/10" />
          <div className="skeleton mt-4 h-4 w-1/2 bg-white/10" />
          <div className="skeleton mt-2 h-3 w-1/3 bg-white/10" />
        </div>
      </section>

      {/* 课程赛道网格 */}
      <section className="space-y-5">
        <div className="skeleton h-6 w-40" />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]"
            >
              <div className="skeleton mb-4 aspect-[16/10] w-full rounded-[12px]" />
              <div className="skeleton mb-2 h-4 w-3/4" />
              <div className="skeleton h-3 w-1/2" />
            </div>
          ))}
        </div>
      </section>

      {/* 共创 + 订阅 teaser */}
      <section className="grid gap-5 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--card)]"
          >
            <div className="skeleton mb-3 h-5 w-1/2" />
            <div className="skeleton mb-2 h-3 w-full" />
            <div className="skeleton h-3 w-2/3" />
          </div>
        ))}
      </section>
    </div>
  );
}
