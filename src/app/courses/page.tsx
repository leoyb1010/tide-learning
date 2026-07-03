import { Suspense } from "react";
import { listCourses } from "@/lib/queries";
import { expandSearchKeywords } from "@/lib/llm";
import { CourseCard } from "@/components/CourseCard";
import { CourseFilterBar } from "@/components/CourseFilterBar";
import { EmptyState, Button } from "@/components/ui";

export const metadata = { title: "课程库" };

export default async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; sort?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const category = sp.category ?? "all";
  const sort = sp.sort ?? "recommended";
  const q = sp.q ?? "";
  // 语义搜索（场景4）：有关键词时用 LLM 扩展同义词再检索；失败/未配置自动降级为原词（不阻塞）
  const searchTerms = q ? await expandSearchKeywords(q) : undefined;
  const courses = await listCourses({ category, sort, q: searchTerms });

  return (
    <div className="studio-rise flex flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <span className="mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink4)]">
          COURSE LIBRARY
        </span>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-[var(--ink)]">
          课程库
        </h1>
        <p className="text-[15px] leading-relaxed text-[var(--ink2)]">
          订阅解锁全站 · 每门课都在持续更新
        </p>
      </header>

      <Suspense fallback={<div className="h-24" />}>
        <CourseFilterBar category={category} sort={sort} q={q} />
      </Suspense>

      {courses.length === 0 ? (
        <EmptyState
          title="没有找到相关课程"
          hint="换个关键词，或看看推荐课程"
          action={<Button href="/courses">查看全部课程</Button>}
        />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className="mono text-[12px] text-[var(--ink3)]">
              共 {courses.length} 门课程
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {courses.map((c) => (
              <CourseCard key={c.id} course={c} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
