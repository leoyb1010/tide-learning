import Link from "next/link";
import { redirect } from "next/navigation";
import { Sparkle, FilePlus, Plus, CircleNotch, Storefront, GraduationCap, HourglassMedium, Play, Coins, ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getAuthorEarnings } from "@/lib/credit-trade";
import { CoverBg } from "@/components/ui";
import { trackLabel, resolveCoverSrc } from "@/lib/tracks";
import { ShareToMarketButton, type ShareState } from "@/components/ShareToMarketButton";
import { CourseManageButton } from "@/components/CourseManageButton";
import { AccessRequestActions } from "@/components/AccessRequestActions";
import { CourseGenControls } from "@/components/CourseGenControls";
import { USER_AUTHORED_ORIGINS, authoredOriginLabel } from "@/lib/course-origin";

/** sharedStatus → 徽标文案与配色（STUDIO 语义色 pill，写法对齐卡片内既有 pill）。 */
const SHARE_BADGE: Record<ShareState, { label: string; cls: string }> = {
  private: { label: "未上架", cls: "bg-[var(--surface-inset)] text-[var(--ink3)] border-[var(--border)]" },
  pending: { label: "审核中", cls: "bg-[var(--warn-soft)] text-[var(--warn)] border-transparent" },
  shared: { label: "已上架", cls: "bg-[var(--ok-soft)] text-[var(--ok)] border-transparent" },
  rejected: { label: "未通过", cls: "bg-[var(--red-soft)] text-[var(--red)] border-transparent" },
};

export const metadata = { title: "我的课" };

/**
 * /me/courses —— 我的课（server）。
 * 越权铁律：where 强制 authorUserId = user.id，只列当前用户 AI 生成、资料导入或手工创建的课，
 * 按 createdAt desc。展示来源标签 / 生成态 / 学习进度 / 分享到社区按钮。
 * 「我的分享」区：列出他人对我课程的待批准申请（ownerId=user.id, status=pending），批准/拒绝。
 * 空态引导去 /create。未登录跳登录。
 */
export default async function MyCoursesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/me/courses");

  const courses = await prisma.course.findMany({
    where: {
      authorUserId: user.id,
      origin: { in: [...USER_AUTHORED_ORIGINS] },
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
      sharedStatus: true, // 分享态：private / pending / shared / rejected
      priceCredits: true, // 集市售价（积分）：null/0=免费，>0=付费
      salesCount: true, // 累计成交数
      createdAt: true,
      // 全部章节数 + 首节（作为进入学习入口）
      lessons: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, blocksJson: true, videoGenStatus: true },
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

  // 按课累计收益（经营弹窗展示）：复用收益口径，按 courseId 建索引。
  const earnings = await getAuthorEarnings(user.id);
  const incomeMap = new Map(earnings.courses.map((c) => [c.courseId, c.income]));

  // —— 我的分享：他人对我课程的待批准申请（越权铁律：where ownerId=user.id）——
  const pendingRequests = await prisma.courseAccessRequest.findMany({
    where: { ownerId: user.id, status: "pending" },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, courseId: true, requesterId: true, message: true, createdAt: true },
  });
  // 申请人昵称 + 课程标题（各一次查完）。
  const requesterIds = Array.from(new Set(pendingRequests.map((r) => r.requesterId)));
  const reqCourseIds = Array.from(new Set(pendingRequests.map((r) => r.courseId)));
  const [requesters, reqCourses] = await Promise.all([
    requesterIds.length > 0
      ? prisma.user.findMany({ where: { id: { in: requesterIds } }, select: { id: true, nickname: true } })
      : Promise.resolve([]),
    reqCourseIds.length > 0
      ? prisma.course.findMany({ where: { id: { in: reqCourseIds } }, select: { id: true, title: true } })
      : Promise.resolve([]),
  ]);
  const requesterMap = new Map(requesters.map((u) => [u.id, u.nickname]));
  const reqCourseMap = new Map(reqCourses.map((c) => [c.id, c.title]));

  const cards = courses.map((c) => {
    const total = c.lessons.length;
    // 生成中的章节 = blocksJson 尚为空
    const pending = c.lessons.filter((l) => !l.blocksJson).length;
    // 已生成节数（进度环分子）：blocksJson 非空即已生成。
    const genDone = c.lessons.filter((l) => l.blocksJson != null).length;
    // L2/L3 可控造课新增态：outline_draft(待确认大纲) / paused(用户暂停) 都不是「进行中转圈」，
    // 单列出来，避免被 isGenerating 的兜底分支误当成生成中而永久转圈。
    const isPaused = c.genStatus === "paused";
    const isDraft = c.genStatus === "outline_draft";
    const isGenerating =
      c.genStatus === "generating" ||
      (c.genStatus !== "ready" &&
        c.genStatus !== "failed" &&
        c.genStatus !== "paused" &&
        c.genStatus !== "outline_draft" &&
        pending > 0);
    const isFailed = c.genStatus === "failed";
    // 尚未就绪（生成中 / 失败 / 暂停 / 待确认大纲）——决定是否禁用分享 / 显示生成态控件。
    const notReady = isGenerating || isFailed || isPaused || isDraft;
    const done = completedMap.get(c.id) ?? 0;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    // v3.1 视频课件进度：ready/生成中(pending|generating) 的节数（用户勾选生成视频课件后可见）。
    const videoReady = c.lessons.filter((l) => l.videoGenStatus === "ready").length;
    const videoInFlight = c.lessons.filter((l) => l.videoGenStatus === "pending" || l.videoGenStatus === "generating").length;
    const hasVideoGen = videoReady > 0 || videoInFlight > 0;
    return {
      ...c,
      total,
      pending,
      genDone,
      isGenerating,
      isFailed,
      isPaused,
      isDraft,
      notReady,
      done,
      pct,
      videoReady,
      videoInFlight,
      hasVideoGen,
      firstLessonId: c.lessons[0]?.id ?? null,
    };
  });

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-8">
      {/* 头部 */}
      <header className="flex items-end justify-between gap-4">
        <div>
          <div className="mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink4)]">MY STUDIO</div>
          <h1 className="mt-1 text-[26px] font-extrabold tracking-tight text-[var(--ink)]">我的课</h1>
          <p className="mt-1 text-[14px] text-[var(--ink2)]">你用 AI 生成或导入资料整理出的专属课程。</p>
        </div>
        <div className="hidden shrink-0 items-center gap-2 sm:flex">
          <Link
            href="/me/earnings"
            className="studio-press inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-[14px] font-semibold text-[var(--ink2)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)]"
          >
            <Coins size={15} weight="fill" />
            我的收益
          </Link>
          <Link
            href="/market"
            className="studio-press inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-[14px] font-semibold text-[var(--ink2)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)]"
          >
            <Storefront size={15} weight="fill" />
            逛集市
          </Link>
          <Link
            href="/create"
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--red)] px-4 py-2.5 text-[14px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(252,1,26,0.5)] transition-all duration-200 hover:brightness-105 active:translate-y-px"
          >
            <Plus size={15} weight="bold" />
            造一门新课
          </Link>
        </div>
      </header>

      {cards.length === 0 ? (
        // —— 空态 ——
        <div className="flex flex-col items-center justify-center gap-4 rounded-[18px] border border-dashed border-[var(--border2)] bg-[var(--surface)] px-6 py-16 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-[16px] bg-[var(--red-soft)]">
            <Sparkle size={26} weight="fill" className="text-[var(--red)]" />
          </span>
          <div>
            <p className="text-[16px] font-bold text-[var(--ink)]">还没有专属课</p>
            <p className="mt-1 text-[14px] text-[var(--ink2)]">一句话描述你想学的，或粘贴一段资料，AI 现场帮你搭一门课。</p>
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
            const isManual = c.origin === "user_created";
            // 仅生成就绪的课可分享（生成中/失败禁用分享，避免半成品上架）。
            const canShare = !c.notReady;
            return (
              <div
                key={c.id}
                className="studio-lift group flex flex-col overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card)] hover:border-[var(--border2)]"
              >
                {/* 封面 + 标题为链接主体 */}
                <Link href={href} className="flex flex-col">
                  <CoverBg color={c.coverColor} imageSrc={resolveCoverSrc(c.slug, c.category ?? "", c.id)} alt={c.title} className="aspect-[16/9] w-full">
                    {/* 来源标签 */}
                    <div className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-black/25 px-2.5 py-1 text-[0.68rem] font-semibold text-white backdrop-blur-sm">
                      {isAi ? <Sparkle size={11} weight="fill" /> : isManual ? <GraduationCap size={11} weight="fill" /> : <FilePlus size={11} weight="fill" />}
                      {authoredOriginLabel(c.origin)}
                    </div>
                    {/* 生成态标签 */}
                    {c.isGenerating ? (
                      <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[0.66rem] font-semibold text-[var(--red)] backdrop-blur-sm">
                        <CircleNotch size={11} weight="bold" className="animate-spin" />
                        生成中 {c.genDone}/{c.total}
                      </div>
                    ) : c.isFailed ? (
                      <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[0.66rem] font-semibold text-[var(--warn)] backdrop-blur-sm">
                        待续 {c.genDone}/{c.total}
                      </div>
                    ) : c.isPaused ? (
                      <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[0.66rem] font-semibold text-[var(--warn)] backdrop-blur-sm">
                        已暂停 {c.genDone}/{c.total}
                      </div>
                    ) : c.isDraft ? (
                      <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[0.66rem] font-semibold text-[var(--red)] backdrop-blur-sm">
                        待确认大纲
                      </div>
                    ) : (
                      <div className="absolute right-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[0.66rem] font-semibold text-[var(--ink)] backdrop-blur-sm">
                        就绪 · {c.total} 节
                      </div>
                    )}
                  </CoverBg>

                  <div className="flex flex-col px-4 pt-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink4)]">{trackLabel(c.category)}</div>
                      {/* 上架状态徽标：private 中性灰 / pending 暖黄 / shared 正向绿(+售价) / rejected 警示红 */}
                      {(() => {
                        const badge = SHARE_BADGE[c.sharedStatus as ShareState] ?? SHARE_BADGE.private;
                        return (
                          <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold ${badge.cls}`}>
                            {badge.label}
                            {c.sharedStatus === "shared" && (c.priceCredits ?? 0) > 0 && (
                              <span className="mono inline-flex items-center gap-0.5">
                                <Coins size={10} weight="fill" />
                                {c.priceCredits} 积分
                              </span>
                            )}
                          </span>
                        );
                      })()}
                    </div>
                    <h3 className="mt-1.5 line-clamp-2 text-[15px] font-bold leading-snug tracking-tight text-[var(--ink)] transition-colors group-hover:text-[var(--red)]">
                      {c.title}
                    </h3>
                    {c.subtitle && <p className="mt-1 line-clamp-1 text-[13px] text-[var(--ink2)]">{c.subtitle}</p>}

                    {/* v3.1 视频课件进度：生成中显示「视频生成中 N/总」，全部就绪显示「视频课件 · N 节」 */}
                    {c.hasVideoGen && (
                      <div className="mt-2">
                        {c.videoInFlight > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--red)]">
                            <CircleNotch size={11} weight="bold" className="animate-spin" />
                            视频生成中 {c.videoReady}/{c.videoReady + c.videoInFlight}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface-inset)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ink2)]">
                            <Play size={11} weight="fill" className="text-[var(--red)]" />
                            视频课件 · {c.videoReady} 节
                          </span>
                        )}
                      </div>
                    )}

                    {/* 学习进度 */}
                    <div className="pt-2.5">
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

                {/* 底部操作区（脱离 Link，避免嵌套交互）：
                    已上架/审核中 → 经营（改价/编辑文案/下架，pending 只可撤回）；
                    就绪未上架 → 分享到社区（上架弹窗含定价）；生成中/失败 → 进度环 + 查看进度/继续生成。 */}
                <div className="mt-auto flex items-center justify-end border-t border-[var(--border)] px-4 py-3">
                  {isManual && (
                    <Link
                      href={`/create?manual=${c.id}`}
                      className="studio-press mr-auto inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--border)] px-3 py-1.5 text-[13px] font-semibold text-[var(--ink2)] hover:border-[var(--border2)] hover:text-[var(--ink)]"
                    >
                      <GraduationCap size={13} weight="fill" /> 编辑课程
                    </Link>
                  )}
                  {canShare && (c.sharedStatus === "shared" || c.sharedStatus === "pending") ? (
                    <CourseManageButton
                      courseId={c.id}
                      status={c.sharedStatus as "shared" | "pending"}
                      priceCredits={c.priceCredits}
                      salesCount={c.salesCount}
                      income={incomeMap.get(c.id) ?? 0}
                      courseTitle={c.title}
                      courseSubtitle={c.subtitle}
                    />
                  ) : canShare ? (
                    <ShareToMarketButton
                      courseId={c.id}
                      initialStatus={c.sharedStatus as ShareState}
                      courseTitle={c.title}
                      courseSubtitle={c.subtitle}
                    />
                  ) : c.isDraft ? (
                    // 大纲待确认（L2）：不轮询进度，直接给「去确认大纲」深链，回 /create 打开该草稿的检查点。
                    <Link
                      href={`/create?draft=${c.id}`}
                      className="studio-press inline-flex items-center gap-1.5 rounded-[10px] bg-[var(--red)] px-3 py-1.5 text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-[var(--red-hover)]"
                    >
                      去确认大纲
                      <ArrowRight size={13} weight="bold" />
                    </Link>
                  ) : (
                    <CourseGenControls
                      courseId={c.id}
                      initialTotal={c.total}
                      initialDone={c.genDone}
                      initialStatus={c.isFailed ? "failed" : c.isPaused ? "paused" : "generating"}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ===== 我的分享：待批准的学习申请 ===== */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-[var(--red-soft)]">
            <Storefront size={16} weight="fill" className="text-[var(--red)]" />
          </span>
          <div>
            <h2 className="text-[18px] font-extrabold tracking-tight text-[var(--ink)]">我的分享</h2>
            <p className="text-[13px] text-[var(--ink3)]">他人对你分享课程的学习申请，批准后你将获得积分奖励。</p>
          </div>
        </div>

        {pendingRequests.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-[16px] border border-dashed border-[var(--border2)] bg-[var(--surface)] px-6 py-10 text-center">
            <HourglassMedium size={22} weight="regular" className="text-[var(--ink4)]" />
            <p className="text-[14px] font-semibold text-[var(--ink2)]">暂无待批准的申请</p>
            <p className="text-[13px] text-[var(--ink3)]">把你的课分享到集市，就有机会收到同学的学习申请。</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {pendingRequests.map((r) => (
              <li
                key={r.id}
                className="studio-rise flex flex-col gap-3 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5 shadow-[var(--card)] sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="flex items-center gap-1.5 text-[14px] font-bold text-[var(--ink)]">
                      <GraduationCap size={14} weight="fill" className="text-[var(--ink4)]" />
                      {requesterMap.get(r.requesterId) ?? "某位同学"}
                    </span>
                    <span className="text-[13px] text-[var(--ink3)]">申请学习</span>
                    <span className="truncate text-[13px] font-semibold text-[var(--ink2)]">《{reqCourseMap.get(r.courseId) ?? "课程"}》</span>
                  </div>
                  {r.message && <p className="line-clamp-2 text-[13px] leading-[1.55] text-[var(--ink3)]">“{r.message}”</p>}
                </div>
                <div className="shrink-0">
                  <AccessRequestActions requestId={r.id} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
