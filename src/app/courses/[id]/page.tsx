import { notFound } from "next/navigation";
import Link from "next/link";
import { Play, LockSimple, Check, CaretRight, ShareNetwork, Users, Clock, ListChecks, ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { getCourseDetail, listCourses } from "@/lib/queries";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { canAccessTrack } from "@/lib/entitlement";
import { Button } from "@/components/ui";
import { AmbientVideo } from "@/components/AmbientVideo";
import { CourseCard } from "@/components/CourseCard";
import { SmartBackLink } from "@/components/SmartBackLink";
import { RatingStars } from "@/components/RatingStars";
import { CourseReviews } from "@/components/CourseReviews";
import { SharePanel } from "@/components/SharePanel";
import { TrialBooking } from "@/components/TrialBooking";
import { formatDurationSec } from "@/lib/format";
import { getCourseRatingAggregate } from "@/lib/course-review";
import { TRACK_MAP, trackGradientVar } from "@/lib/tracks";

// 预告静帧兜底：按赛道选一张定格图，作为通用预告视频的 poster（视频加载前 / reduce-motion 时显示）。
const PREVIEW_POSTER: Record<string, string> = {
  english_oral: "/lesson-stills/lesson-still-oral.jpg",
  english_foundation: "/lesson-stills/lesson-still-english.jpg",
  silver_english: "/lesson-stills/lesson-still-silver.jpg",
  ai_skill: "/lesson-stills/lesson-still-ai.jpg",
  life: "/lesson-stills/lesson-still-life.jpg",
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // P2-1：metadata 带当前用户上下文——作者看自己私有课 title 为课程名（此前固定传 null，作者也被判「不存在」）。
  const user = await getCurrentUser();
  const detail = await getCourseDetail(id, user?.id ?? null);
  // 不存在 / 对当前用户不可见 → notFound()，渲染 not-found 页（其自带 noindex，非作者不泄露私有课标题）。
  // 注：因 app 级 loading.tsx 全站流式，shell 200 先于此决出，故 HTTP 状态仍是 200（Next App Router 流式
  // 限制，见审计 P1-3 说明）；真正 404 需禁用全站骨架或中间件级存在性校验，属需权衡的取舍，未在此改。
  if (!detail) notFound();
  return { title: detail.course.title, description: detail.course.description ?? detail.course.subtitle ?? "" };
}

export default async function CourseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const detail = await getCourseDetail(id, user?.id ?? null);
  if (!detail) notFound();

  const { course, snapshot, categoryLabel, durationText, lessons, owned, progress } = detail;
  const firstFree = lessons.find((l) => l.isFree);
  // 审计修复(2026-07-19)：preview 页要求免费节**有 htmlJson**才渲染,video/article 课挂「免登录试读」按钮
  // 会 404 死链(实测 8/23 门已发布课命中)。入口按同口径预检,查不到就不渲染按钮。
  const previewable = firstFree
    ? (await prisma.lesson.count({
        where: { courseId: course.id, isFree: true, status: "published", htmlJson: { not: null } },
      })) > 0
    : false;
  const firstLesson = lessons[0];
  const needsCompliance = ["life", "silver_english"].includes(course.category) && course.reviewerName;
  const hasAccess = owned || canAccessTrack(course.category, snapshot); // 买断或订阅均可访问
  const isEnglish = TRACK_MAP[course.category]?.isEnglish;
  const related = (await listCourses({ category: course.category })).filter((c) => c.id !== course.id).slice(0, 3);

  // 学习进度只认 LearningProgress，绝不再把「有权访问」冒充「已经学完」。
  const completedIds = new Set(progress.filter((p) => p.completedAt).map((p) => p.lessonId));
  const activeLessonId =
    progress.find((p) => !p.completedAt)?.lessonId ??
    lessons.find((l) => l.canAccess && !completedIds.has(l.id))?.id ??
    lessons.find((l) => l.canAccess)?.id ??
    null;
  const learnedCount = lessons.filter((l) => completedIds.has(l.id)).length;
  const progressPct = lessons.length ? Math.round((learnedCount / lessons.length) * 100) : 0;
  const freeCount = lessons.filter((l) => l.isFree).length;
  // 评分（S5 评价系统闭环）：读真实聚合——有真实评价读真实均分/条数；零评价回退占位派生
  // （isPlaceholder=true，RatingStars 标「示例」）。随第一条真实评价落地即自动切换，UI 不变。
  const rating = await getCourseRatingAggregate(course.id, course.learnersCount);
  // 完课判定：有权访问 + 大纲无「在学/锁定」节（nowIndex === -1 表示每节都可访问且已学过）。
  const courseComplete = hasAccess && lessons.length > 0 && learnedCount === lessons.length;
  const continueHref = hasAccess
    ? `/courses/${course.slug}/learn/${activeLessonId ?? firstLesson?.id}`
    : firstFree
      ? `/courses/${course.slug}/learn/${firstFree.id}`
      : "/pricing";
  // 头区主 CTA：有权益→进学习台（完课则重温）；无权益有试学→免费试学；否则去订阅。
  const heroCtaHref = hasAccess
    ? continueHref
    : firstFree
      ? `/courses/${course.slug}/learn/${firstFree.id}`
      : "/pricing";
  const heroCtaLabel = hasAccess
    ? courseComplete
      ? "重温学习台"
      : learnedCount > 0
        ? "继续学习"
        : "进入学习台"
    : firstFree
      ? "免费试学第一章"
      : "订阅解锁全部";

  return (
    <div className="studio-rise space-y-12">
      {/* ===== 主体 1.55/.92 双栏 ===== */}
      <div className="grid items-start gap-5 lg:grid-cols-[1.55fr_.92fr]">
        {/* ---------- 左列 ---------- */}
        <div className="flex flex-col gap-[18px]">
          {/* 预告视频：深色展示区，赛道渐变叠 --video-grad + 柔光，弃死黑平面。
              viewTransitionName 与课程卡封面配对：从列表点进时封面被「托起」形变到此处
              （渐进增强，不支持 View Transitions 的浏览器忽略此属性）。 */}
          <div
            className="studio-lightup group/hero relative aspect-[16/9] w-full overflow-hidden rounded-[20px] shadow-[var(--lift)]"
            style={{ background: "var(--video-grad)", viewTransitionName: "course-cover" }}
          >
            {/* 通用预告视频铺底（每课共用）：--video-grad 作底色兜底，按赛道选定格图作 poster/静帧；
                reduce-motion 时只显示 poster 静帧不自动播放。上方赛道色调/高光/播放圆/时长叠层保持不变。 */}
            <AmbientVideo
              src="/videos/marketing/course-preview-generic-16x9.mp4"
              poster={PREVIEW_POSTER[course.category]}
            />
            {/* 赛道色调层，让深色区带上课程个性 */}
            <div className="absolute inset-0 opacity-[0.55] mix-blend-soft-light" style={{ background: trackGradientVar(course.category) }} />
            {/* 顶部内高光 + 细网格材质 */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{ background: "radial-gradient(130% 90% at 50% 0%, rgba(255,255,255,.16), transparent 58%)" }}
            />
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.10]"
              style={{ backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.6) 1px, transparent 0)", backgroundSize: "18px 18px" }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-[66px] w-[66px] items-center justify-center rounded-full bg-white/[0.16] backdrop-blur-sm ring-1 ring-white/25 transition-transform duration-300 group-hover/hero:scale-105">
                <Play size={26} weight="fill" className="translate-x-[2px] text-white" />
              </span>
            </div>
            <span className="mono absolute bottom-4 left-4 rounded-full bg-black/35 px-3 py-1 text-[11px] font-medium text-white backdrop-blur-sm ring-1 ring-white/10">
              {/* 通用预告片，各课共用同一段素材，故不再伪造「02:30」这一每课无意义的固定时长（2026-07-20 诚实性修复）。 */}
              通用预告
            </span>
          </div>

          {/* ===== 课程头区（重做，问题⑯②）=====
              弃「裸标题 + 三个孤立数字」的雏形感：赛道胶囊 + 大标题 + 评分星级 +
              作者/供给署名 chip + 简介 + 一条高级材质的指标带（节数/时长/在学），
              层级分明、留白克制、材质走 STUDIO elev。评分数据见下方注释。 */}
          <header className="flex flex-col gap-3.5">
            {/* 赛道 + 更新节奏 */}
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="rounded-full border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--red)]">
                {categoryLabel}
              </span>
              <span className="mono inline-flex items-center gap-1 text-[12px] text-[var(--ink3)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" />
                {course.updateCadence ?? "持续更新"}
              </span>
            </div>

            {/* 标题 */}
            <h1 className="text-[clamp(26px,4vw,34px)] font-bold leading-[1.24] tracking-tight text-[var(--ink)]">
              {course.title}
            </h1>

            {/* 评分 + 作者署名（chip） */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {/* 评分星级（S5）：读真实聚合。有真实评价→不标「示例」；零评价回退占位派生→标「示例」。
                  placeholder 由 aggregate.isPlaceholder 驱动，诚实不冒充。 */}
              <RatingStars score={rating.score} count={rating.count} placeholder={rating.isPlaceholder} size={15} />
              <span className="h-3.5 w-px bg-[var(--border)]" />
              <span className="inline-flex items-center gap-2 text-[13px] text-[var(--ink2)]">
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ background: "linear-gradient(135deg, #a30514, #fc011a)" }}
                >
                  {(course.instructorName ?? "T").slice(0, 1)}
                </span>
                <span className="font-medium text-[var(--ink)]">{course.instructorName}</span>
                <span className="text-[var(--ink4)]">讲师</span>
              </span>
            </div>

            {/* 简介：副标 + 描述，层级拉开 */}
            {course.subtitle && (
              <p className="text-[16px] leading-[1.6] text-[var(--ink)]">{course.subtitle}</p>
            )}
            {course.description && (
              <p className="text-[15px] leading-[1.78] text-[var(--ink2)]">{course.description}</p>
            )}

            {/* 供给/审核署名（次要，弱化） */}
            {(course.contributorName || course.reviewerName) && (
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-[var(--ink3)]">
                {course.contributorName && <span>内容供给：{course.contributorName}</span>}
                {course.reviewerName && <span>审核人：{course.reviewerName}</span>}
              </div>
            )}

            {/* 高级材质指标带：节数 / 时长 / 在学人数，一条 elev 卡收束数据 */}
            <div className="mt-1 grid grid-cols-3 divide-x divide-[var(--border)] overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card),var(--inner-hi)]">
              <HeaderStat icon={<ListChecks size={16} weight="bold" />} value={`${lessons.length}`} unit="节" label="总课时" />
              <HeaderStat icon={<Clock size={16} weight="bold" />} value={durationText} label="总时长" />
              <HeaderStat icon={<Users size={16} weight="bold" />} value={compactCount(course.learnersCount)} label="在学人数" />
            </div>

            {/* 头区醒目 CTA：首屏即可行动。lg 起右侧 sticky 卡承接完整转化，这里在窄屏
                （aside 沉底）尤其关键——保证学习者一进页面就看得到「开始/继续学习」。
                触达 h-12(48px)，cta-glow 品牌柔光，reduce-motion 由 .cta-glow 降级。 */}
            <Link
              href={heroCtaHref}
              className="cta-glow group mt-1 inline-flex h-12 w-full items-center justify-center gap-2 rounded-[14px] bg-[var(--red)] text-[15px] font-semibold text-white transition-colors hover:bg-[var(--red-hover)] sm:w-auto sm:px-7 lg:hidden"
            >
              {heroCtaLabel}
              <ArrowRight size={17} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          </header>

          {/* ===== 课程大纲（上提到首屏，问题⑯③）=====
              学习者最关心「学什么」，故紧跟头区、不再下滑第二区域才见。 */}
          <div>
            <div className="mb-3 flex items-baseline justify-between">
              <div className="flex items-baseline gap-2.5">
                <h2 className="text-[19px] font-bold text-[var(--ink)]">课程大纲</h2>
                <span className="text-[13px] text-[var(--ink3)]">学什么，一目了然</span>
              </div>
              <span className="mono text-[12px] text-[var(--ink3)]">已学 {learnedCount}/{lessons.length}</span>
            </div>
            <ul className="stagger overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card),var(--inner-hi)]">
              {lessons.map((l, i) => {
                const isDone = completedIds.has(l.id);
                const isNow = !isDone && l.id === activeLessonId;
                const isLast = i === lessons.length - 1;
                const locked = !l.canAccess;
                return (
                  <li
                    key={l.id}
                    style={{ "--i": i } as React.CSSProperties}
                    className={`border-b border-[var(--border)] last:border-b-0 ${isNow ? "bg-[var(--red-soft)]" : ""}`}
                  >
                    <OutlineRow
                      href={l.canAccess ? `/courses/${course.slug}/learn/${l.id}` : undefined}
                      index={i + 1}
                      title={l.title}
                      summary={l.summary}
                      duration={formatDurationSec(l.durationSec)}
                      isNow={isNow}
                      isDone={isDone}
                      locked={locked}
                      isNew={isLast && !isNow && !isDone}
                      isFree={l.isFree}
                    />
                  </li>
                );
              })}
            </ul>
          </div>

          {/* 合规声明（健康/防诈骗，§6.3 验收 4）——移到大纲之后（大纲优先占首屏） */}
          {needsCompliance && (
            <div className="rounded-[16px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] p-5">
              <p className="text-[13px] font-bold text-[var(--ink)]">内容说明</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--ink2)]">
                {course.disclaimer ??
                  "本课程内容经内容审核人审核，仅用于信息素养与防范意识学习，不构成任何专业建议。"}
              </p>
              <p className="mt-1.5 text-[12px] text-[var(--ink3)]">审核人：{course.reviewerName}</p>
            </div>
          )}

          {/* 适合谁 / 学完获得（问题⑬：前移到「学员评价」之前——先帮用户判断「这课适不适合我、学完得到什么」，
              再看他人评价，决策链更顺。更新日志（原此处上方）已从 C 端详情页移除，仅保留后台/模型，避免误导。 */}
          <div className="grid gap-4 sm:grid-cols-2">
            <InfoCard title="适合谁学">
              <li>想用 {categoryLabel} 提升效率或达成目标的人</li>
              <li>希望跟随更新、持续精进的订阅用户</li>
              <li>喜欢边学边记、沉淀学习资产的人</li>
            </InfoCard>
            <InfoCard title="学完你将获得">
              <li>一套可复用的方法与模板</li>
              <li>随课程更新持续获得新内容</li>
              <li>属于自己的结构化学习笔记</li>
            </InfoCard>
          </div>

          {/* 学员评价（S5 评价系统闭环）：真实聚合 + 列表 + 写评价入口（学过才可评）。
              client 组件自持三态（加载/空/错误），数据走 /api/courses/:id/reviews。 */}
          <CourseReviews courseId={course.id} isLoggedIn={Boolean(user)} />
        </div>

        {/* ---------- 右列 sticky ---------- */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
          {/* 进度卡 */}
          <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card),var(--inner-hi)]">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-[var(--ink3)]">你的进度</span>
              <span className="rounded-full border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--red)]">
                <span className="mono num-pop">{progressPct}%</span> 继续加油
              </span>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-inset)]">
              <div className="h-full rounded-full bg-[var(--red)] transition-[width] duration-500" style={{ width: `${progressPct}%` }} />
            </div>

            {/* 章节数据 */}
            <dl className="mt-4 grid grid-cols-2 gap-3">
              <Meta label="章节数" value={`${lessons.length} 讲`} />
              <Meta label="免费试学" value={`${freeCount} 讲`} />
            </dl>

            {/* CTA */}
            <div className="mt-4 space-y-2.5">
              {hasAccess ? (
                <>
                  <Button href={continueHref} full size="lg" className="cta-glow">
                    {courseComplete ? "重温学习台" : "进入学习台"}
                  </Button>
                  {/* 完课分享：仅整门学完时出现，生成完课证书图（course-done 服务端按 courseId + 当前用户聚合） */}
                  {courseComplete && (
                    <SharePanel
                      kind="course-done"
                      title="分享完课"
                      params={{ courseId: course.id }}
                      shareUrl={`/courses/${course.slug}`}
                      triggerLabel="分享完课证书"
                      trigger={
                        <span className="studio-press inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-[12px] border border-[var(--ok)]/40 bg-[var(--ok-soft)] text-[14px] font-semibold text-[var(--ok)] transition-colors hover:border-[var(--ok)]">
                          <ShareNetwork size={16} weight="bold" /> 分享完课证书
                        </span>
                      }
                    />
                  )}
                </>
              ) : (
                <>
                  {firstFree && <Button href={`/courses/${course.slug}/learn/${firstFree.id}`} full size="lg" className="cta-glow">免费试学第一章</Button>}
                  {/* 蓝图 D4 入口：免登录课件试读（此前预览页无任何入口）——游客零门槛看到课件质感再决定登录/订阅。 */}
                  {previewable && (
                    <Button href={`/courses/${course.slug}/preview`} variant="secondary" full>
                      免登录试读课件
                    </Button>
                  )}
                  <Button href={`/pricing?next=${encodeURIComponent(`/courses/${course.slug}/learn/${firstLesson?.id ?? ""}`)}`} variant="secondary" full>订阅解锁全部</Button>
                  {/* 英语赛道提供预约试听（有道 0转正入口） */}
                  {isEnglish && <TrialBooking courseId={course.id} track={course.category} source="youdao_dict" />}
                </>
              )}
            </div>

            {/* 订阅门：有说服力的三点价值，而非干巴巴一句话 */}
            {!hasAccess && (
              <ul className="mt-4 space-y-2 text-[13px] leading-[1.5] text-[var(--ink2)]">
                <li className="flex items-start gap-2">
                  <Check size={14} weight="bold" className="mt-0.5 shrink-0 text-[var(--ok)]" />
                  <span>订阅即解锁本赛道全部课程，随更新持续获得新内容</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check size={14} weight="bold" className="mt-0.5 shrink-0 text-[var(--ok)]" />
                  <span>边学边记，笔记与截帧永久保留，停订后仍可查看</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check size={14} weight="bold" className="mt-0.5 shrink-0 text-[var(--ok)]" />
                  <span><span className="mono font-semibold text-[var(--ink)]">{freeCount}</span> 讲免费试学，先看后订，随时可退</span>
                </li>
              </ul>
            )}
            <p className="mt-3 text-center text-[12px] text-[var(--ink4)]">
              {snapshot.isSubscriber && !hasAccess ? "你的订阅未覆盖该赛道，升级全站即可解锁" : "订阅后解锁该赛道课程，笔记永久保留"}
            </p>

            {/* 讲师 */}
            <div className="mt-4 flex items-center gap-3 border-t border-[var(--border)] pt-4">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
                style={{ background: "linear-gradient(135deg, #a30514, #fc011a)" }}
              >
                {(course.instructorName ?? "T").slice(0, 1)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-[var(--ink)]">{course.instructorName}</p>
                <p className="text-[11px] text-[var(--ink3)]">课程讲师</p>
              </div>
            </div>
          </div>

          {/* 更新提示卡 */}
          <div className="rounded-[16px] border border-dashed border-[var(--border2)] bg-[var(--surface2)] p-5">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--red)]" style={{ animation: "recPulse 2s ease-in-out infinite" }} />
              <span className="text-[13px] font-bold text-[var(--ink)]">持续更新中</span>
            </div>
            <p className="mt-2 text-[13px] leading-[1.7] text-[var(--ink2)]">
              {course.updateCadence ? `${course.updateCadence}，` : "每周三新增 1-2 节，"}持续为这门课添加新内容。你的笔记与截帧永久保存，随课程一起成长。
            </p>
          </div>
        </aside>
      </div>

      {/* 相关推荐 */}
      {related.length > 0 && (
        <section>
          <h2 className="mb-4 text-[18px] font-bold text-[var(--ink)]">相关课程</h2>
          <div className="stagger grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {related.map((c, i) => (
              <div key={c.id} className="h-full" style={{ "--i": i } as React.CSSProperties}>
                <CourseCard course={c} />
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="text-center">
        <SmartBackLink
          fallback="/courses"
          label="← 返回课程库"
          icon={false}
          className="text-[13px] text-[var(--red)] hover:underline"
        />
      </div>
    </div>
  );
}

/* ============ 页面专属子组件 ============ */

/** 头区指标带单元：图标 + 数值(+单位) + 标签，居中，供三等分材质带用。 */
function HeaderStat({ icon, value, unit, label }: { icon: React.ReactNode; value: string; unit?: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-2 py-3.5">
      <span className="text-[var(--ink3)]">{icon}</span>
      <div className="mono text-[19px] font-extrabold leading-none tracking-tight text-[var(--ink)]">
        {value}
        {unit && <span className="ml-0.5 text-[12px] font-semibold text-[var(--ink3)]">{unit}</span>}
      </div>
      <div className="text-[12px] text-[var(--ink4)]">{label}</div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-[var(--ink4)]">{label}</dt>
      <dd className="mono mt-0.5 text-[14px] font-semibold text-[var(--ink)]">{value}</dd>
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)]">
      <h3 className="mb-3 text-[14px] font-bold text-[var(--ink)]">{title}</h3>
      <ul className="space-y-2 text-[13px] leading-[1.6] text-[var(--ink2)]">{children}</ul>
    </div>
  );
}

function OutlineRow({
  href, index, title, summary, duration, isNow, isDone, locked, isNew, isFree,
}: {
  href?: string;
  index: number;
  title: string;
  summary?: string | null;
  duration: string;
  isNow: boolean;
  isDone: boolean;
  locked: boolean;
  isNew: boolean;
  isFree: boolean;
}) {
  const inner = (
    <div className={`group flex items-center gap-3.5 px-[18px] py-3.5 transition-colors ${href ? "hover:bg-[var(--surface2)]" : ""} ${isNow ? "hover:bg-transparent" : ""}`}>
      <span className={`mono w-[26px] shrink-0 text-center text-[13px] ${isNow ? "font-bold text-[var(--red)]" : "text-[var(--ink4)]"}`}>
        {String(index).padStart(2, "0")}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`truncate text-[14px] ${isNow ? "font-bold text-[var(--ink)]" : "font-medium text-[var(--ink)]"}`}>{title}</span>
          {isFree && !isNow && (
            <span className="rounded-full bg-[var(--surface-inset)] px-2 py-0.5 text-[10px] font-medium text-[var(--ink3)]">免费</span>
          )}
        </div>
        {summary && <p className="mt-0.5 truncate text-[12px] text-[var(--ink4)]">{summary}</p>}
      </div>
      <span className="mono shrink-0 text-[12px] text-[var(--ink4)]">{duration}</span>
      <span className="flex w-[52px] shrink-0 items-center justify-end">
        {isNow ? (
          <span className="cta-glow inline-flex items-center gap-1 rounded-full bg-[var(--red)] px-2.5 py-1 text-[11px] font-semibold text-white">
            在学 <CaretRight size={11} weight="bold" />
          </span>
        ) : isNew ? (
          <span className="rounded-full bg-[var(--new-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--new-ink)]">NEW</span>
        ) : isDone ? (
          // 完课用功能色 --ok，语义清晰且不与红信号争抢
          <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--ok-soft)] text-[var(--ok)]">
            <Check size={12} weight="bold" />
          </span>
        ) : locked ? (
          <LockSimple size={15} className="text-[var(--ink4)]" />
        ) : (
          <Play size={15} weight="fill" className="text-[var(--ink4)]" />
        )}
      </span>
    </div>
  );

  if (href) return <Link href={href}>{inner}</Link>;
  return <div className="cursor-default">{inner}</div>;
}

/** 大数字紧凑格式（中国大陆口径「万」）：12400 → 1.2万；<10000 直接展示。 */
function compactCount(n: number): string {
  if (n < 10000) return String(n);
  const w = n / 10000;
  return `${w >= 10 ? Math.round(w) : w.toFixed(1)}万`;
}
