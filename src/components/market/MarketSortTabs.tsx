"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { FireSimple, ClockCounterClockwise, Heart } from "@phosphor-icons/react";
import { MARKET_SORTS, normalizeSort, type MarketSort } from "@/lib/market-view";

const ICONS: Record<MarketSort, React.ComponentType<{ size?: number; weight?: "fill" | "bold" | "regular" }>> = {
  hot: FireSimple,
  new: ClockCounterClockwise,
  loved: Heart,
};

/**
 * MarketSortTabs —— 集市排序切换（client）。
 * 最热(拿走多) / 最新 / 收藏多。改写 URL ?sort= 触发 server 重排（保 SEO + 可分享 + 刷新保持）。
 * 铁律：仅 router 导航，不引 server 链。当前项红点睛（唯一强调），reduce-motion 靠 CSS 全局降级。
 */
export function MarketSortTabs() {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const current = normalizeSort(params.get("sort"));

  function pick(next: MarketSort) {
    if (next === current) return;
    const sp = new URLSearchParams(params.toString());
    if (next === "hot") sp.delete("sort");
    else sp.set("sort", next);
    const qs = sp.toString();
    startTransition(() => {
      router.push(qs ? `/market?${qs}` : "/market", { scroll: false });
    });
  }

  return (
    <div
      role="tablist"
      aria-label="集市排序"
      className={`inline-flex items-center gap-1 rounded-[13px] border border-[var(--border)] bg-[var(--surface2)] p-1 shadow-[var(--card),var(--inner-hi)] ${pending ? "opacity-70" : ""}`}
    >
      {MARKET_SORTS.map((s) => {
        const Icon = ICONS[s.key];
        const active = s.key === current;
        return (
          <button
            key={s.key}
            role="tab"
            aria-selected={active}
            onClick={() => pick(s.key)}
            className={`studio-press inline-flex min-h-[40px] items-center gap-1.5 rounded-[10px] px-3.5 py-2 text-[13px] font-semibold transition-all ${
              active
                ? "bg-[var(--surface)] text-[var(--ink)] shadow-[var(--card-hover),var(--inner-hi)]"
                : "text-[var(--ink3)] hover:text-[var(--ink)]"
            }`}
          >
            <Icon size={14} weight={active ? "fill" : "regular"} />
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
