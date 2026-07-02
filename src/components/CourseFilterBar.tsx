"use client";

import { useRouter, useSearchParams } from "next/navigation";

const CATEGORIES = [
  { key: "all", label: "全部" },
  { key: "ai_skill", label: "AI 技能" },
  { key: "exam", label: "备考" },
  { key: "life", label: "生活" },
];
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
    <div className="space-y-4">
      <input
        defaultValue={q}
        onKeyDown={(e) => { if (e.key === "Enter") update("q", (e.target as HTMLInputElement).value); }}
        placeholder="搜索课程标题…"
        className="w-full rounded-xl border border-ink-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-tide-400"
      />
      <div className="flex flex-wrap items-center gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            onClick={() => update("category", c.key)}
            className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${category === c.key ? "bg-tide-600 text-white" : "bg-white text-ink-500 border border-ink-200 hover:border-tide-400"}`}
          >
            {c.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-ink-200" />
        <select
          value={sort}
          onChange={(e) => update("sort", e.target.value)}
          className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-500 outline-none"
        >
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>
    </div>
  );
}
