import { Suspense } from "react";
import { MagnifyingGlass, Compass } from "@phosphor-icons/react/dist/ssr";
import { listCourses } from "@/lib/queries";
import { expandSearchKeywords } from "@/lib/llm";
import { CoursePreviewCard } from "@/components/CoursePreviewCard";
import { CourseFilterBar } from "@/components/CourseFilterBar";
import { CourseLibraryView } from "@/components/CourseLibraryView";
import { Button } from "@/components/ui";

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
          订阅解锁全站，每门课都在持续更新
        </p>
      </header>

      <Suspense fallback={<div className="h-24" />}>
        <CourseFilterBar category={category} sort={sort} q={q} />
      </Suspense>

      {courses.length === 0 ? (
        // 空态：有设计感的构图（图形 + 引导 + 双 CTA），而非灰图标一句话
        <div className="elev-1 flex flex-col items-center justify-center rounded-[18px] px-6 py-16 text-center">
          <div
            className="relative flex h-20 w-20 items-center justify-center rounded-[20px] text-white"
            style={{ background: "var(--track-default)" }}
          >
            <div
              className="pointer-events-none absolute inset-0 rounded-[20px]"
              style={{ background: "radial-gradient(120% 90% at 50% 0%, rgba(255,255,255,.22), transparent 60%)" }}
            />
            <MagnifyingGlass size={34} weight="light" />
          </div>
          <p className="mt-5 text-[17px] font-bold text-[var(--ink)]">没有找到相关课程</p>
          <p className="mt-1.5 max-w-[360px] text-[14px] leading-[1.7] text-[var(--ink2)]">
            换个关键词试试，或直接浏览全部课程，也许下一门就是你要找的。
          </p>
          <div className="mt-6 flex items-center gap-2.5">
            <Button href="/courses">查看全部课程</Button>
            <a
              href="/pricing"
              className="studio-press inline-flex items-center gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-[13px] font-semibold text-[var(--ink)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)]"
            >
              <Compass size={15} weight="bold" /> 看看订阅权益
            </a>
          </div>
        </div>
      ) : (
        // 课程库网格外壳（client）：v4.0 移除书架视图切换，课程库只做纯网格。
        // 网格在 server 渲染好后作为 grid prop 传入，守住 client/server 边界。
        <CourseLibraryView
          courses={courses}
          grid={
            <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {courses.map((c, i) => (
                <div key={c.id} className="h-full" style={{ "--i": i } as React.CSSProperties}>
                  {/* 两段式（问题⑯①）：点课程卡先弹预览气泡（评分/简介/N节·时长/作者/卖点），
                      卡上「进入学习」再进详情。CoursePreviewCard 是 client，复用 CourseCardFace 视觉，
                      server page 只负责把课程数据传进去，不越界。 */}
                  <CoursePreviewCard course={c} />
                </div>
              ))}
            </div>
          }
        />
      )}
    </div>
  );
}
