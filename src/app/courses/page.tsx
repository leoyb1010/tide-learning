import { Suspense } from "react";
import Link from "next/link";
import { MagnifyingGlass, Compass, BookOpen, ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/session";
import { listCourses } from "@/lib/queries";
import { expandSearchKeywords } from "@/lib/llm";
import { TRACKS, TRACK_MAP } from "@/lib/tracks";
import { CoursePreviewCard } from "@/components/CoursePreviewCard";
import { CourseFilterBar } from "@/components/CourseFilterBar";
import { CourseLibraryView } from "@/components/CourseLibraryView";
import { Button } from "@/components/ui";

type LibraryCourse = Awaited<ReturnType<typeof listCourses>>[number];

/** 课程卡网格（两段式预览卡）。分组视图与平铺视图共用同一网格排布。 */
function LibraryGrid({ courses }: { courses: LibraryCourse[] }) {
  return (
    <div className="stagger grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {courses.map((c, i) => (
        <div key={c.id} className="h-full" style={{ "--i": i } as React.CSSProperties}>
          <CoursePreviewCard course={c} />
        </div>
      ))}
    </div>
  );
}

/**
 * 分门别类视图（问题⑨）：默认「全部」且无搜索时，按赛道分区陈列（每区标题 + 查看全部 + 网格），
 * 取代英语/银发/AI/生活混排的「散」。未归入 TRACKS 的课（含脏数据）收进「其他」，不丢课。
 */
function GroupedLibrary({ courses }: { courses: LibraryCourse[] }) {
  const sections = TRACKS.map((t) => ({
    key: t.key,
    label: t.label,
    items: courses.filter((c) => c.category === t.key),
  })).filter((s) => s.items.length > 0);
  const others = courses.filter((c) => !TRACK_MAP[c.category ?? ""]);

  return (
    <div className="flex flex-col gap-9">
      {sections.map((s) => (
        <section key={s.key}>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-2.5">
              <h2 className="text-[17px] font-bold text-[var(--ink)]">{s.label}</h2>
              <span className="mono text-[12px] text-[var(--ink4)]">{s.items.length} 门</span>
            </div>
            <Link
              href={`/courses?category=${s.key}`}
              className="group inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-[var(--red)]"
            >
              查看全部
              <ArrowRight size={13} weight="bold" className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
          <LibraryGrid courses={s.items} />
        </section>
      ))}
      {others.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline gap-2.5">
            <h2 className="text-[17px] font-bold text-[var(--ink)]">其他</h2>
            <span className="mono text-[12px] text-[var(--ink4)]">{others.length} 门</span>
          </div>
          <LibraryGrid courses={others} />
        </section>
      )}
    </div>
  );
}

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
  const [courses, user] = await Promise.all([
    listCourses({ category, sort, q: searchTerms }),
    // 登录用户在页顶展示「发现｜我的课程」切换（我的课程直达 /me/courses）
    getCurrentUser(),
  ]);

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

      {/* 登录用户：「发现｜我的课程」切换。样式对齐 /create 的胶囊 Tab；
          「我的课程」直达 /me/courses（列表不在此重复实现），未登录不显示。 */}
      {user && (
        <div className="inline-flex self-start gap-1 rounded-full border border-[var(--border)] bg-[var(--surface2)] p-1">
          <span className="flex items-center gap-1.5 rounded-full bg-[var(--surface)] px-4 py-2 text-[13px] font-semibold text-[var(--ink)] shadow-[var(--card)]">
            <Compass size={15} weight="fill" />
            发现
          </span>
          <Link
            href="/me/courses"
            className="flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold text-[var(--ink3)] transition-all duration-150 hover:text-[var(--ink)]"
          >
            <BookOpen size={15} />
            我的课程
          </Link>
        </div>
      )}

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
        // 问题⑨：默认「全部」且无搜索时按赛道分区（GroupedLibrary），去混排的「散」；
        //         选中分类或搜索时回到平铺网格（结果已被筛过，分区无意义）。
        <CourseLibraryView
          courses={courses}
          grid={
            category === "all" && !q ? (
              <GroupedLibrary courses={courses} />
            ) : (
              <LibraryGrid courses={courses} />
            )
          }
        />
      )}
    </div>
  );
}
