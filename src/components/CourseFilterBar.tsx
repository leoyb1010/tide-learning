"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { TRACKS } from "@/lib/tracks";

const CATEGORIES = [{ key: "all", label: "全部" }, ...TRACKS.map((t) => ({ key: t.key, label: t.label }))];
const SORTS = [
  { key: "recommended", label: "推荐" },
  { key: "newest", label: "最新更新" },
  { key: "learners", label: "最多人学" },
  { key: "beginner", label: "最适合新手" },
];

export function CourseFilterBar({ category, sort, q }: { category: string; sort: string; q: string }) {
  const router = useRouter();
  const params = useSearchParams();

  function update(key: string, value: string) {
    const sp = new URLSearchParams(params.toString());
    if (value && value !== "all" && value !== "recommended") sp.set(key, value);
    else sp.delete(key);
    router.push(`/courses?${sp.toString()}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <input
        defaultValue={q}
        onKeyDown={(e) => { if (e.key === "Enter") update("q", (e.target as HTMLInputElement).value); }}
        placeholder="搜索课程标题…"
        className="w-full rounded-[13px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--ink)] shadow-[var(--card)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--red)]"
      />
      <div className="flex flex-wrap items-center gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            onClick={() => update("category", c.key)}
            className={`studio-press rounded-full px-3.5 py-1.5 text-sm transition-colors ${
              category === c.key
                ? "bg-[var(--ink)] font-semibold text-[var(--surface)]"
                : "border border-[var(--border)] bg-[var(--surface)] text-[var(--ink2)] hover:border-[var(--border2)] hover:text-[var(--ink)]"
            }`}
          >
            {c.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-[var(--border)]" />
        <select
          value={sort}
          onChange={(e) => update("sort", e.target.value)}
          className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3.5 py-1.5 text-sm text-[var(--ink2)] outline-none transition-colors hover:border-[var(--border2)] focus:border-[var(--red)]"
        >
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>
    </div>
  );
}
