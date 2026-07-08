"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

/**
 * MarketCategoryTabs —— 集市分类筛选（client，问题⑨：把集市按赛道分门别类，去「散」）。
 * 改写 URL ?category= 触发 server 重筛（保 SEO + 可分享 + 刷新保持）；「全部」删参数保持干净 URL。
 * 只展示当前市集实际有货的赛道（父级从 stalls 派生传入），不列空赛道，观感更专业。
 * 铁律：仅 router 导航，不引 server 链；切换排序/搜索时保留其余 URL 参数。
 */
export function MarketCategoryTabs({ categories }: { categories: { key: string; label: string }[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const current = params.get("category") ?? "all";

  function pick(next: string) {
    if (next === current) return;
    const sp = new URLSearchParams(params.toString());
    if (next === "all") sp.delete("category");
    else sp.set("category", next);
    const qs = sp.toString();
    startTransition(() => {
      router.push(qs ? `/market?${qs}` : "/market", { scroll: false });
    });
  }

  const tabs = [{ key: "all", label: "全部" }, ...categories];

  return (
    <div
      role="tablist"
      aria-label="集市分类"
      className={`flex flex-wrap items-center gap-2 ${pending ? "opacity-70" : ""}`}
    >
      {tabs.map((t) => {
        const active = t.key === current;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={active}
            onClick={() => pick(t.key)}
            className={`studio-press rounded-full px-3.5 py-1.5 text-[13px] transition-colors ${
              active
                ? "bg-[var(--ink)] font-semibold text-[var(--surface)]"
                : "border border-[var(--border)] bg-[var(--surface)] text-[var(--ink2)] hover:border-[var(--border2)] hover:text-[var(--ink)]"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
