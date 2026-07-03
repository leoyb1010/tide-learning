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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-950">课程库</h1>
        <p className="mt-1 text-ink-500">订阅解锁全站 · 每门课都在持续更新</p>
      </div>

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
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => <CourseCard key={c.id} course={c} />)}
        </div>
      )}
    </div>
  );
}
