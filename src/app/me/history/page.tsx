import Link from "next/link";
import { redirect } from "next/navigation";
import { ClockCounterClockwise, GraduationCap, CaretLeft } from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { trackLabel, resolveCoverSrc } from "@/lib/tracks";
import { relativeTime } from "@/lib/queries";
import { EmptyTide } from "@/components/TideIllustration";
import { HistoryGroups, type HistoryCourse } from "./HistoryGroups";

export const metadata = { title: "学习记录" };

/**
 * /me/history —— 全量学习记录（Server Component，SSR 首屏）。
 *
 * 越权铁律：查该用户所有 LearningProgress 一律 where userId，include course/lesson。
 * 按课程分组：每课显示封面/课名/赛道/总进度/最近学习时间/已学章节数；展开显示各章节进度点。
 * 按赛道筛选 tab（全部 / 各赛道），tab 仅列该用户历史中真实出现过的赛道，避免空 tab。
 * 分组懒加载：章节列表在展开时才渲染（HistoryGroups client）。
 * 空态用 EmptyTide(variant="courses")。
 */
export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ track?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/me/history");

  const sp = await searchParams;
  const activeTrack = sp.track ?? "all";

  // 全量学习记录（越权铁律：where userId）。带课程与章节的必要字段；
  // 课程总章节数用 _count 一次取回，避免为每课再查一次。按最近学习倒序（分组内也据此）。
  const progress = await prisma.learningProgress.findMany({
    where: { userId: user.id },
    orderBy: { lastPlayedAt: "desc" },
    select: {
      lessonId: true,
      progressSec: true,
      completedAt: true,
      lastPlayedAt: true,
      course: {
        select: {
          id: true,
          slug: true,
          title: true,
          category: true,
          coverColor: true,
          _count: { select: { lessons: true } },
        },
      },
      lesson: { select: { id: true, title: true, sortOrder: true, durationSec: true } },
    },
  });

  // —— 按课程分组（保持 lastPlayedAt 倒序：首次出现的课程即最近学习课程）——
  const groupMap = new Map<
    string,
    {
      course: (typeof progress)[number]["course"];
      lastPlayedAt: Date;
      rows: (typeof progress)[number][];
    }
  >();
  for (const r of progress) {
    if (!r.course || !r.lesson) continue; // 关联缺失（脏数据）跳过
    const g = groupMap.get(r.course.id);
    if (g) {
      g.rows.push(r);
      if (r.lastPlayedAt > g.lastPlayedAt) g.lastPlayedAt = r.lastPlayedAt;
    } else {
      groupMap.set(r.course.id, { course: r.course, lastPlayedAt: r.lastPlayedAt, rows: [r] });
    }
  }

  // 赛道 tab：从历史中真实出现的赛道构建（全部 + 去重赛道），保留课程出现顺序。
  const seenTracks: string[] = [];
  for (const g of groupMap.values()) {
    if (!seenTracks.includes(g.course.category)) seenTracks.push(g.course.category);
  }
  const tabs = [
    { key: "all", label: "全部" },
    ...seenTracks.map((t) => ({ key: t, label: trackLabel(t) })),
  ];
  // 传给筛选器的 activeTrack 若不在 tab 中（如手动改 URL），回退「全部」。
  const effectiveTrack = tabs.some((t) => t.key === activeTrack) ? activeTrack : "all";

  // 组装课程分组视图数据（拍平给 client），并按赛道筛选。
  const allCourses: HistoryCourse[] = [];
  for (const g of groupMap.values()) {
    const totalLessons = g.course._count.lessons;
    const learnedLessons = g.rows.length;
    let doneLessons = 0;
    const lessons = g.rows
      .map((r) => {
        const dur = r.lesson!.durationSec;
        const pct = dur > 0 ? Math.min(100, Math.round((r.progressSec / dur) * 100)) : 0;
        const done = r.completedAt != null;
        if (done) doneLessons++;
        return {
          lessonId: r.lesson!.id,
          title: r.lesson!.title,
          sortOrder: r.lesson!.sortOrder,
          pct,
          done,
          lastPlayedLabel: relativeTime(r.lastPlayedAt),
        };
      })
      // 章节展开区按课程内顺序展示（sortOrder 升序），更符合学习脉络。
      .sort((a, b) => a.sortOrder - b.sortOrder);
    // 总进度：已完成章节 / 课程总章节（无总章节数时回退按已学章节的完成比）。
    const coursePct =
      totalLessons > 0
        ? Math.round((doneLessons / totalLessons) * 100)
        : learnedLessons > 0
          ? Math.round((doneLessons / learnedLessons) * 100)
          : 0;
    allCourses.push({
      courseId: g.course.id,
      slug: g.course.slug,
      title: g.course.title,
      trackLabel: trackLabel(g.course.category),
      coverColor: g.course.coverColor,
      coverSrc: resolveCoverSrc(g.course.slug, g.course.category, g.course.id),
      totalLessons: Math.max(totalLessons, learnedLessons), // 兜底：脏数据下总数不小于已学数
      learnedLessons,
      doneLessons,
      coursePct,
      lastPlayedLabel: relativeTime(g.lastPlayedAt),
      lessons,
    });
  }
  // groupMap 已按 lastPlayedAt 倒序（progress 已排序、首次插入即最近），保持插入序即可。
  const courses =
    effectiveTrack === "all"
      ? allCourses
      : allCourses.filter((c) => {
          const g = groupMap.get(c.courseId);
          return g?.course.category === effectiveTrack;
        });

  const totalCourses = allCourses.length;

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6">
      {/* 返回成长档案 + 标题 */}
      <div className="flex flex-col gap-3">
        <Link
          href="/me"
          className="inline-flex w-fit items-center gap-1 text-[13px] font-semibold text-[var(--ink3)] transition-colors hover:text-[var(--ink)]"
        >
          <CaretLeft size={13} weight="bold" /> 成长档案
        </Link>
        <header className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[13px] bg-[var(--red-soft)] text-[var(--red)]">
            <ClockCounterClockwise size={22} weight="fill" />
          </span>
          <div className="min-w-0">
            <h1 className="text-[24px] font-extrabold tracking-tight text-[var(--ink)]">学习记录</h1>
            <p className="mt-0.5 text-[13.5px] text-[var(--ink2)]">
              {totalCourses > 0 ? (
                <>
                  你在 <span className="mono font-semibold text-[var(--ink)]">{totalCourses}</span> 门课程留下过学习足迹
                </>
              ) : (
                "开始学习后，这里会留下你的每一节足迹"
              )}
            </p>
          </div>
        </header>
      </div>

      {totalCourses === 0 ? (
        // 空态：统一潮汐插画（courses 场景）+ 去选课 CTA
        <div className="elev-1 rounded-[18px] px-6 py-6">
          <EmptyTide
            variant="courses"
            description="挑一门感兴趣的课程开始学习，你的进度与足迹会自动记录在这里。"
            action={
              <Link
                href="/courses"
                className="studio-press cta-glow hover-sheen inline-flex items-center gap-1.5 rounded-[11px] bg-[var(--red)] px-5 py-2.5 text-[14px] font-semibold text-white"
              >
                <GraduationCap size={16} weight="fill" /> 去选课
              </Link>
            }
          />
        </div>
      ) : (
        <>
          {/* 赛道筛选 tab（URL 驱动，SSR 友好；单赛道时不显示，避免冗余）。 */}
          {tabs.length > 2 && (
            <div className="-mx-1 flex flex-wrap gap-2 overflow-x-auto px-1 pb-0.5" role="tablist" aria-label="按赛道筛选">
              {tabs.map((t) => {
                const active = t.key === effectiveTrack;
                return (
                  <Link
                    key={t.key}
                    href={t.key === "all" ? "/me/history" : `/me/history?track=${encodeURIComponent(t.key)}`}
                    role="tab"
                    aria-selected={active}
                    className={`studio-press inline-flex h-9 shrink-0 items-center rounded-full border px-4 text-[13px] font-semibold transition-colors ${
                      active
                        ? "border-[var(--red)] bg-[var(--red-soft)] text-[var(--red-ink)]"
                        : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink3)] hover:border-[var(--border2)] hover:text-[var(--ink)]"
                    }`}
                  >
                    {t.label}
                  </Link>
                );
              })}
            </div>
          )}

          {/* 分组列表（client：展开/折叠 + 章节懒渲染） */}
          {courses.length > 0 ? (
            <HistoryGroups courses={courses} />
          ) : (
            <div className="elev-1 rounded-[18px] px-6 py-12 text-center">
              <p className="text-[14px] font-semibold text-[var(--ink2)]">该赛道下暂无学习记录</p>
              <Link
                href="/me/history"
                className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--red-ink)] transition-colors hover:text-[var(--red)]"
              >
                查看全部记录
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
