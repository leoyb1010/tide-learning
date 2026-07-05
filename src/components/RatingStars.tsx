import { Star, StarHalf } from "@phosphor-icons/react/dist/ssr";

/* ============================================================
   评分星级（纯展示，server/client 通用 · /dist/ssr 图标）
   —— 5 星底 + 满/半/空叠画，配数字分与评价数。
   评价数据来源见 @/lib/course-rating（当前为占位派生，评价系统 S5）。
   调用方可传 placeholder 标注「示例评分」。
   ============================================================ */
export function RatingStars({
  score,
  count,
  size = 14,
  showCount = true,
  placeholder = false,
  className = "",
}: {
  score: number;
  count?: number;
  size?: number;
  showCount?: boolean;
  /** true 时在评价数后加「示例」小字，诚实标注占位（评价系统 S5） */
  placeholder?: boolean;
  className?: string;
}) {
  const full = Math.floor(score);
  const hasHalf = score - full >= 0.25 && score - full < 0.75;
  const rounded = score - full >= 0.75 ? full + 1 : full;

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <span className="flex items-center gap-[1px]" aria-hidden>
        {Array.from({ length: 5 }).map((_, i) => {
          const isFull = i < (hasHalf ? full : rounded);
          const isHalf = hasHalf && i === full;
          if (isHalf) return <StarHalf key={i} size={size} weight="fill" className="text-[var(--warn)]" />;
          return (
            <Star
              key={i}
              size={size}
              weight={isFull ? "fill" : "regular"}
              className={isFull ? "text-[var(--warn)]" : "text-[var(--ink4)]"}
            />
          );
        })}
      </span>
      <span className="mono text-[13px] font-bold leading-none text-[var(--ink)]">{score.toFixed(1)}</span>
      {showCount && count != null && (
        <span className="text-[12px] leading-none text-[var(--ink3)]">
          （{count.toLocaleString()} 评价{placeholder ? " · 示例" : ""}）
        </span>
      )}
      <span className="sr-only">
        {score.toFixed(1)} 分（满分 5 分）{count != null ? `，${count} 条评价` : ""}
        {placeholder ? "（示例评分，评价系统即将上线）" : ""}
      </span>
    </div>
  );
}
