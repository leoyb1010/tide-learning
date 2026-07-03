import Link from "next/link";
import { Storefront, GraduationCap, Users, ListChecks, Sparkle, SignIn } from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { CoverBg, coverSrc } from "@/components/ui";
import { trackLabel } from "@/lib/tracks";
import { MarketRequestButton, type RequestState } from "@/components/MarketRequestButton";

export const metadata = { title: "课程集市" };
export const dynamic = "force-dynamic";

/**
 * /market —— 课程集市（server）。
 * 展示 sharedStatus="shared" 的用户造课，供他人申请学习。
 * 每张卡：封面渐变 + 标题 + 大纲前 3 节 + 作者 + 申请数 + 「申请学习」按钮（client）。
 * 越权/隐私：只查已上架课；登录用户预取自己对每门课的申请态（none/pending/approved/rejected），
 *   按钮据此渲染；自己的课不出「申请」按钮（显示作者本人徽标）。未登录：卡片照常展示，底部引导登录。
 */
export default async function MarketPage() {
  const user = await getCurrentUser();

  // 已上架课：作者信息 + 大纲前 3 节（sortOrder 升序）。
  const courses = await prisma.course.findMany({
    where: { sharedStatus: "shared" },
    orderBy: { lastUpdatedAt: "desc" },
    take: 60,
    select: {
      id: true,
      slug: true,
      title: true,
      subtitle: true,
      description: true,
      category: true,
      coverColor: true,
      origin: true,
      authorUserId: true,
      lastUpdatedAt: true,
      lessons: {
        orderBy: { sortOrder: "asc" },
        take: 3,
        select: { id: true, title: true },
      },
    },
  });

  const courseIds = courses.map((c) => c.id);

  // 每门课的申请总数（社区热度信号）。一次 groupBy 聚合。
  const reqCounts =
    courseIds.length > 0
      ? await prisma.courseAccessRequest.groupBy({
          by: ["courseId"],
          where: { courseId: { in: courseIds } },
          _count: { _all: true },
        })
      : [];
  const reqCountMap = new Map(reqCounts.map((r) => [r.courseId, r._count._all]));

  // 章节总数（用于「共 N 节」展示）。
  const lessonCounts =
    courseIds.length > 0
      ? await prisma.lesson.groupBy({
          by: ["courseId"],
          where: { courseId: { in: courseIds } },
          _count: { _all: true },
        })
      : [];
  const lessonCountMap = new Map(lessonCounts.map((r) => [r.courseId, r._count._all]));

  // 登录用户对这些课的申请态（越权铁律：where requesterId=user.id，只取自己的申请）。
  const myRequests =
    user && courseIds.length > 0
      ? await prisma.courseAccessRequest.findMany({
          where: { requesterId: user.id, courseId: { in: courseIds } },
          select: { courseId: true, status: true },
        })
      : [];
  const myReqMap = new Map(myRequests.map((r) => [r.courseId, r.status as RequestState]));

  // 作者昵称（一次查完）。
  const authorIds = Array.from(new Set(courses.map((c) => c.authorUserId).filter((x): x is string => Boolean(x))));
  const authors =
    authorIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, nickname: true } })
      : [];
  const authorMap = new Map(authors.map((a) => [a.id, a.nickname]));

  return (
    <div className="studio-rise mx-auto flex w-full max-w-[1040px] flex-col gap-6">
      {/* 头部 */}
      <header className="flex flex-col gap-2">
        <div className="mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink4)]">COURSE MARKET</div>
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-[var(--red-soft)]">
            <Storefront size={18} weight="fill" className="text-[var(--red)]" />
          </span>
          <h1 className="text-[26px] font-extrabold tracking-tight text-[var(--ink)]">课程集市</h1>
        </div>
        <p className="text-[14px] text-[var(--ink2)]">同学们用 AI 造的课，都在这里。看中哪门，申请学习，作者批准后即可开学。</p>
      </header>

      {/* 未登录引导 */}
      {!user && (
        <div className="flex flex-col items-center justify-between gap-3 rounded-[14px] border border-[var(--border)] bg-[var(--surface-inset)] px-5 py-4 sm:flex-row">
          <p className="text-[13.5px] text-[var(--ink2)]">登录后可申请学习集市里的课程。</p>
          <Link
            href="/login?next=/market"
            className="studio-press inline-flex shrink-0 items-center gap-1.5 rounded-[11px] bg-[var(--red)] px-4 py-2 text-[13px] font-bold text-white transition-all hover:brightness-105"
          >
            <SignIn size={15} weight="bold" />
            去登录
          </Link>
        </div>
      )}

      {courses.length === 0 ? (
        // —— 空态 ——
        <div className="flex flex-col items-center justify-center gap-4 rounded-[18px] border border-dashed border-[var(--border2)] bg-[var(--surface)] px-6 py-16 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-[16px] bg-[var(--red-soft)]">
            <Sparkle size={26} weight="fill" className="text-[var(--red)]" />
          </span>
          <div>
            <p className="text-[16px] font-bold text-[var(--ink)]">集市还很安静</p>
            <p className="mt-1 text-[13.5px] text-[var(--ink2)]">还没有课程被分享到社区。去造一门课，第一个把它分享出来。</p>
          </div>
          <Link
            href="/create"
            className="studio-press inline-flex items-center gap-2 rounded-[12px] bg-[var(--red)] px-5 py-3 text-[14px] font-semibold text-white transition-all hover:brightness-105"
          >
            <Sparkle size={16} weight="fill" />
            去造一门课
          </Link>
        </div>
      ) : (
        // —— 卡片网格 ——
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => {
            const author = c.authorUserId ? authorMap.get(c.authorUserId) ?? "匿名同学" : "匿名同学";
            const isMine = Boolean(user && c.authorUserId === user.id);
            const reqCount = reqCountMap.get(c.id) ?? 0;
            const total = lessonCountMap.get(c.id) ?? c.lessons.length;
            const reqState: RequestState = myReqMap.get(c.id) ?? "none";
            const isAi = c.origin === "ai_generated";

            return (
              <div
                key={c.id}
                className="studio-lift group flex flex-col overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card)] hover:border-[var(--border2)]"
              >
                <CoverBg color={c.coverColor} imageSrc={coverSrc(c.slug)} alt={c.title} className="aspect-[16/9] w-full">
                  <div className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-black/25 px-2.5 py-1 text-[0.68rem] font-semibold text-white backdrop-blur-sm">
                    {isAi ? <Sparkle size={11} weight="fill" /> : <ListChecks size={11} weight="fill" />}
                    {isAi ? "AI 生成" : "整理导入"}
                  </div>
                  {reqCount > 0 && (
                    <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[0.66rem] font-semibold text-[var(--ink)] backdrop-blur-sm">
                      <Users size={11} weight="fill" />
                      <span className="mono">{reqCount}</span> 人申请
                    </div>
                  )}
                </CoverBg>

                <div className="flex flex-1 flex-col p-4">
                  <div className="mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink4)]">{trackLabel(c.category)}</div>
                  <h3 className="mt-1.5 line-clamp-2 text-[15px] font-bold leading-snug tracking-tight text-[var(--ink)]">{c.title}</h3>
                  {(c.subtitle || c.description) && (
                    <p className="mt-1 line-clamp-2 text-[13px] leading-[1.55] text-[var(--ink2)]">{c.subtitle || c.description}</p>
                  )}

                  {/* 大纲前 3 节 */}
                  {c.lessons.length > 0 && (
                    <ul className="mt-3 flex flex-col gap-1.5 rounded-[11px] bg-[var(--surface-inset)] px-3 py-2.5">
                      {c.lessons.map((l, i) => (
                        <li key={l.id} className="flex items-baseline gap-2 text-[12.5px] text-[var(--ink2)]">
                          <span className="mono shrink-0 text-[11px] text-[var(--ink4)]">{String(i + 1).padStart(2, "0")}</span>
                          <span className="line-clamp-1">{l.title}</span>
                        </li>
                      ))}
                      {total > c.lessons.length && (
                        <li className="mono pl-[26px] text-[11px] text-[var(--ink4)]">…共 {total} 节</li>
                      )}
                    </ul>
                  )}

                  {/* 作者 + 申请按钮 */}
                  <div className="mt-auto pt-3.5">
                    <div className="mb-2.5 flex items-center gap-1.5 text-[12px] text-[var(--ink3)]">
                      <GraduationCap size={13} weight="fill" className="text-[var(--ink4)]" />
                      作者 · <span className="text-[var(--ink2)]">{author}</span>
                    </div>

                    {isMine ? (
                      <span className="inline-flex w-full items-center justify-center gap-1.5 rounded-[11px] border border-[var(--border)] bg-[var(--surface-inset)] px-4 py-2.5 text-[13px] font-semibold text-[var(--ink3)]">
                        <Sparkle size={14} weight="fill" className="text-[var(--red)]" />
                        这是你分享的课
                      </span>
                    ) : user ? (
                      <MarketRequestButton courseId={c.id} courseTitle={c.title} initialState={reqState} />
                    ) : (
                      <Link
                        href="/login?next=/market"
                        className="studio-press inline-flex w-full items-center justify-center gap-1.5 rounded-[11px] bg-[var(--red)] px-4 py-2.5 text-[13px] font-bold text-white transition-all hover:brightness-105"
                      >
                        <GraduationCap size={15} weight="fill" />
                        登录后申请学习
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
