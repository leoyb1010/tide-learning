/**
 * 学习台骨架屏（S5 三态审计 · 主学习流）
 * ------------------------------------------------------------------
 * 学习台是核心学习流，进页要等 getLessonForUser 查库(课/权益/进度)才渲染 <Player>。
 * 无骨架时是白屏，尤其从课程卡/集市点进来的首刷体感差。此骨架匹配 Player 布局：
 *   双栏(stage / 320-360px 大纲轨)：
 *     stage —— 顶部标题条 + aspect-video 播放器 + 控制条 + 章节信息
 *     大纲轨 —— 章节列表（lg 起显示；窄屏 Player 折叠为抽屉，此处随之隐藏）
 * 全用 .skeleton 微光；reduce-motion 下由全局 prefers-reduced-motion 规则自动静止。
 * 纯静态骨架，不引 server 链，token 走真实 STUDIO 变量。
 */
export default function Loading() {
  return (
    <div className="grid gap-4 xl:gap-5 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
      {/* ============ stage ============ */}
      <div className="flex flex-col gap-4">
        {/* 课程标题 / 面包屑条 */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="skeleton h-3 w-28" />
            <div className="skeleton h-6 w-2/3" />
          </div>
          <div className="skeleton h-9 w-9 shrink-0 rounded-[10px]" />
        </div>

        {/* 播放器：aspect-video 深色舞台 + 控制条 */}
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] shadow-[var(--card)]">
          <div className="skeleton aspect-video w-full rounded-none" />
          {/* 控制条 */}
          <div className="flex items-center gap-3 px-4 py-3" style={{ background: "var(--surface-inset)" }}>
            <div className="skeleton h-8 w-8 shrink-0 rounded-full" />
            <div className="skeleton h-2 flex-1 rounded-full" />
            <div className="skeleton h-4 w-14 shrink-0" />
            <div className="skeleton h-9 w-9 shrink-0 rounded-[10px]" />
          </div>
        </div>

        {/* 章节信息条 */}
        <div className="flex flex-col gap-2.5 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)]">
          <div className="skeleton h-5 w-1/2" />
          <div className="skeleton h-3.5 w-full" />
          <div className="skeleton h-3.5 w-4/5" />
        </div>
      </div>

      {/* ============ 大纲轨（lg 起显示，与 Player 一致）============ */}
      <aside className="hidden flex-col gap-3 lg:flex">
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]">
          <div className="mb-3 flex items-center justify-between">
            <div className="skeleton h-4 w-16" />
            <div className="skeleton h-3.5 w-10" />
          </div>
          <div className="flex flex-col gap-2.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2.5" style={{ "--i": i } as React.CSSProperties}>
                <div className="skeleton h-4 w-5 shrink-0" />
                <div className="skeleton h-3.5 flex-1" />
                <div className="skeleton h-3 w-8 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
