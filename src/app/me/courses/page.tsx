import Link from "next/link";
import { redirect } from "next/navigation";
import { Sparkle, FilePlus, Plus, CircleNotch } from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { CoverBg, coverSrc } from "@/components/ui";
import { trackLabel } from "@/lib/tracks";

export const metadata = { title: "我的课" };

/**
 * /me/courses —— 我的课（server）。
 * 越权铁律：where 强制 authorUserId = user.id，只列当前用户 origin ∈ {ai_generated, user_imported} 的课，
 * 按 createdAt desc。展示来源标签 / 生成态 / 学习进度。空态引导去 /create。未登录跳登录。
 */
export default async function MyCoursesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/me/courses");

  const courses = await prisma.course.findMany({
    where: {
      authorUserId: user.id,
      origin: { in: ["ai_generated", "user_imported"] },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      slug: true,
      title: true,
      subtitle: true,
      category: true,
      coverColor: true,
      origin: true,
      genStatus: true,
      createdAt: true,
      // 全部章节数 + 首节（作为进入学习入口）
      lessons: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, blocksJson: true },
      },
    },
  });

  // 用户在这些课上的完成情况（一次查完，按 courseId 聚合，算学习进度）
  const courseIds = courses.map((c) => c.id);
  const completed =
    courseIds.length > 0
      ? await prisma.learningProgress.groupBy({
          by: ["courseId"],
          where: { userId: user.id, courseId: { in: courseIds }, completedAt: { not: null } },
          _count: { _all: true },
        })
      : [];
  const completedMap = new Map(completed.map((r) => [r.courseId, r._count._all]));

  const cards = courses.map((c) => {
    const total = c.lessons.length;
    // 生成中的章节 = blocksJson 尚为空
    const pending = c.lessons.filter((l) => !l.blocksJson).length;
    const isGenerating = c.genStatus === "generating" || (c.genStatus !== "ready" && pending > 0);
    const done = completedMap.get(c.id) ?? 0;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return {
      ...c,
      total,
      pending,
      isGenerating,
      done,
      pct,
      firstLessonId: c.lessons[0]?.id ?? null,
    };
  });

  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-6">
      {/* 头部 */}
      <header className="flex items-end justify-between gap-4">
        <div>
          <div className="mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink4)]">MY STUDIO</div>
          <h1 className="mt-1 text-[26px] font-extrabold tracking-tight text-[var(--ink)]">我的课</h1>
          <p className="mt-1 text-[14px] text-[var(--ink2)]">你用 AI 生成或导入资料整理出的专属课程。</p>
        </div>
        <Link
          href="/create"
          className="hidden shrink-0 items-center gap-1.5 rounded-full bg-[var(--red)] px-4 py-2.5 text-[13.5px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(252,1,26,0.5)] transition-all duration-200 hover:brightness-105 active:translate-y-px sm:inline-flex"
        >
          <Plus size={15} weight="bold" />
          造一门新课
        </Link>
      </header>

      {cards.length === 0 ? (
        // —— 空态 ——
        <div className="flex flex-col items-center justify-center gap-4 rounded-[18px] border border-dashed border-[var(--border2)] bg-[var(--surface)] px-6 py-16 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-[16px] bg-[var(--red-soft)]">
            <Sparkle size={26} weight="fill" className="text-[var(--red)]" />
          </span>
          <div>
            <p className="text-[16px] font-bold text-[var(--ink)]">还没有专属课</p>
            <p className="mt-1 text-[13.5px] text-[var(--ink2)]">一句话描述你想学的，或粘贴一段资料，AI 现场帮你搭一门课。</p>
          </div>
          <Link
            href="/create"
            className="inline-flex items-center gap-2 rounded-[12px] bg-[var(--red)] px-5 py-3 text-[14px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(252,1,26,0.5)] transition-all duration-200 hover:brightness-105 active:translate-y-px"
          >
            <Sparkle size={16} weight="fill" />
            去造第一门课
          </Link>
        </div>
      ) : (
        // —— 卡片网格 ——
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => {
            const href = c.firstLessonId ? `/courses/${c.slug}/learn/${c.firstLessonId}` : `/courses/${c.slug}`;
            const isAi = c.origin === "ai_generated";
            return (
              <Link
                key={c.id}
                href={href}
                className="studio-lift group flex flex-col overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card)] hover:border-[var(--border2)]"
              >
                <CoverBg color={c.coverColor} imageSrc={coverSrc(c.slug)} alt={c.title} className="aspect-[16/9] w-full">
                  {/* 来源标签 */}
                  <div className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-black/25 px-2.5 py-1 text-[0.68rem] font-semibold text-white backdrop-blur-sm">
                    {isAi ? <Sparkle size={11} weight="fill" /> : <FilePlus size={11} weight="fill" />}
                    {isAi ? "AI 生成" : "我的导入"}
                  </div>
                  {/* 生成态标签 */}
                  {c.isGenerating ? (
                    <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[0.66rem] font-semibold text-[var(--red)] backdrop-blur-sm">
                      <CircleNotch size={11} weight="bold" className="animate-spin" />
                      生成中 {c.total - c.pending}/{c.total}
                    </div>
                  ) : (
                    <div className="absolute right-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[0.66rem] font-semibold text-[var(--ink)] backdrop-blur-sm">
                      就绪 · {c.total} 节
                    </div>
                  )}
                </CoverBg>

                <div className="flex flex-1 flex-col p-4">
                  <div className="mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink4)]">{trackLabel(c.category)}</div>
                  <h3 className="mt-1.5 line-clamp-2 text-[15px] font-bold leading-snug tracking-tight text-[var(--ink)] transition-colors group-hover:text-[var(--red)]">
                    {c.title}
                  </h3>
                  {c.subtitle && <p className="mt-1 line-clamp-1 text-[13px] text-[var(--ink2)]">{c.subtitle}</p>}

                  {/* 学习进度 */}
                  <div className="mt-auto pt-3.5">
                    <div className="flex items-center justify-between text-[11px] text-[var(--ink3)]">
                      <span className="mono">{c.done}/{c.total} 节已学</span>
                      <span className="mono">{c.pct}%</span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--border2)]">
                      <div className="h-full rounded-full bg-[var(--red)] transition-all duration-300" style={{ width: `${c.pct}%` }} />
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
