/**
 * 集市商品详情骨架屏（S5 三态审计 · 交易相关重点页）
 * ------------------------------------------------------------------
 * 交易页首屏跳数最伤转化：点课卡进商品页要等 buildStallDetail 查库聚合，
 * 无骨架时是白屏。此骨架精确匹配 /market/[slug] 最终布局，让点击瞬间有承接：
 *   面包屑 + 双栏(1.5fr/.95fr)：
 *     左列 —— 16:9 封面橱窗 / 标题区(评分+成交) / 三格指标带 / 大纲预览列表
 *     右列 sticky —— 交易卡(价签 + CTA + 信任点) / 作者店铺卡
 * 全用 .skeleton 微光；reduce-motion 下由全局 prefers-reduced-motion 规则自动静止。
 * 纯静态骨架，不引 server 链，token 走真实 STUDIO 变量。
 */
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-6">
      {/* 面包屑 */}
      <div className="skeleton h-4 w-24" />

      <div className="grid items-start gap-6 lg:grid-cols-[1.5fr_.95fr]">
        {/* ================= 左列：商品陈列 ================= */}
        <div className="flex flex-col gap-6">
          {/* 封面橱窗 16:9 */}
          <div className="skeleton aspect-[16/9] w-full rounded-[20px]" />

          {/* 标题区 */}
          <div className="flex flex-col gap-3">
            <div className="skeleton h-3 w-24" />
            <div className="skeleton h-8 w-4/5" />
            {/* 评分 + 成交 */}
            <div className="flex items-center gap-3">
              <div className="skeleton h-4 w-32" />
              <div className="skeleton h-4 w-20" />
            </div>
            <div className="skeleton h-4 w-full max-w-[520px]" />
            <div className="skeleton h-4 w-2/3 max-w-[360px]" />
          </div>

          {/* 三格指标带 */}
          <div className="grid grid-cols-3 divide-x divide-[var(--border)] overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)]">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-1.5 px-2 py-4" style={{ "--i": i } as React.CSSProperties}>
                <div className="skeleton h-4 w-4 rounded-[6px]" />
                <div className="skeleton h-5 w-12" />
                <div className="skeleton h-3 w-14" />
              </div>
            ))}
          </div>

          {/* 大纲预览列表 */}
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <div className="skeleton h-5 w-28" />
              <div className="skeleton h-3.5 w-20" />
            </div>
            <div className="overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)]">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  style={{ "--i": i } as React.CSSProperties}
                  className="flex items-center gap-3.5 border-b border-[var(--border)] px-[18px] py-3.5 last:border-b-0"
                >
                  <div className="skeleton h-4 w-6 shrink-0" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="skeleton h-3.5 w-1/2" />
                    <div className="skeleton h-3 w-3/4" />
                  </div>
                  <div className="skeleton h-3.5 w-10 shrink-0" />
                  <div className="skeleton h-4 w-4 shrink-0 rounded-[5px]" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ================= 右列 sticky：交易卡 + 店铺卡 ================= */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
          {/* 交易卡 */}
          <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card),var(--inner-hi)]">
            {/* 价签 */}
            <div className="flex items-end justify-between">
              <div className="space-y-1.5">
                <div className="skeleton h-3 w-10" />
                <div className="skeleton h-8 w-24" />
              </div>
              <div className="skeleton h-6 w-20 rounded-full" />
            </div>
            {/* CTA */}
            <div className="skeleton mt-4 h-12 w-full rounded-[14px]" />
            {/* 信任点 */}
            <div className="mt-4 space-y-2.5 border-t border-[var(--border)] pt-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-start gap-2" style={{ "--i": i } as React.CSSProperties}>
                  <div className="skeleton h-3.5 w-3.5 shrink-0 rounded-[5px]" />
                  <div className="skeleton h-3.5 flex-1" />
                </div>
              ))}
            </div>
          </div>

          {/* 作者店铺卡 */}
          <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card),var(--inner-hi)]">
            <div className="skeleton mb-3 h-3 w-16" />
            <div className="flex items-center gap-3">
              <div className="skeleton h-11 w-11 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <div className="skeleton h-4 w-24" />
                <div className="skeleton h-4 w-16 rounded-full" />
              </div>
            </div>
            {/* 店铺经营数据 3 格 */}
            <div className="mt-4 grid grid-cols-3 divide-x divide-[var(--border)] overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-inset)]">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex flex-col items-center gap-1.5 px-2 py-3" style={{ "--i": i } as React.CSSProperties}>
                  <div className="skeleton h-4 w-8" />
                  <div className="skeleton h-3 w-10" />
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
