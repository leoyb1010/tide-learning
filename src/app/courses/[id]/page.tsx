import { notFound } from "next/navigation";
import Link from "next/link";
import { Play, LockSimple, Check, CaretRight, ShareNetwork } from "@phosphor-icons/react/dist/ssr";
import { getCourseDetail, listCourses } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";
import { canAccessTrack } from "@/lib/entitlement";
import { Button } from "@/components/ui";
import { AmbientVideo } from "@/components/AmbientVideo";
import { UpdateLog } from "@/components/UpdateLog";
import { CourseCard } from "@/components/CourseCard";
import { SharePanel } from "@/components/SharePanel";
import { TrialBooking } from "@/components/TrialBooking";
import { formatDurationSec } from "@/lib/format";
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
  const detail = await getCourseDetail(id, null);
  if (!detail) return { title: "课程不存在" };
  return { title: detail.course.title, description: detail.course.description ?? detail.course.subtitle ?? "" };
}

export default async function CourseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const detail = await getCourseDetail(id, user?.id ?? null);
  if (!detail) notFound();

  const { course, snapshot, categoryLabel, durationText, lessons, updateLogs } = detail;
  const firstFree = lessons.find((l) => l.isFree);
  const firstLesson = lessons[0];
  const needsCompliance = ["life", "silver_english"].includes(course.category) && course.reviewerName;
  const hasAccess = canAccessTrack(course.category, snapshot); // 按赛道判断，非全站
  const isEnglish = TRACK_MAP[course.category]?.isEnglish;
  const related = (await listCourses({ category: course.category })).filter((c) => c.id !== course.id).slice(0, 3);

  // 大纲进度派生：可访问的章节视为已学，第一节不可访问的作为"在学"高亮，之后锁定；最后一节标 NEW。
  const accessibleCount = lessons.filter((l) => l.canAccess).length;
  const nowIndex = lessons.findIndex((l) => !l.canAccess);
  const learnedCount = nowIndex === -1 ? Math.max(accessibleCount - 1, 0) : nowIndex;
  const progressPct = lessons.length ? Math.round((learnedCount / lessons.length) * 100) : 0;
  const freeCount = lessons.filter((l) => l.isFree).length;
  // 完课判定：有权访问 + 大纲无「在学/锁定」节（nowIndex === -1 表示每节都可访问且已学过）。
  const courseComplete = hasAccess && lessons.length > 0 && nowIndex === -1;
  const continueHref = hasAccess
    ? `/courses/${course.slug}/learn/${firstLesson?.id}`
    : firstFree
      ? `/courses/${course.slug}/learn/${firstFree.id}`
      : "/pricing";

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
              预告 · 02:30
            </span>
          </div>

          {/* 课程信息 */}
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="rounded-full border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--red)]">
                {categoryLabel}
              </span>
              <span className="mono text-[12px] text-[var(--ink3)]">
                {lessons.length} 节{course.updateCadence ? ` · ${course.updateCadence}` : ""}
              </span>
            </div>
            <h1 className="mt-3 text-[32px] font-bold leading-[1.28] tracking-tight text-[var(--ink)]">{course.title}</h1>
            {course.subtitle && <p className="mt-2 text-[16px] leading-[1.6] text-[var(--ink2)]">{course.subtitle}</p>}
            {course.description && <p className="mt-3 text-[15px] leading-[1.75] text-[var(--ink2)]">{course.description}</p>}

            {/* 三统计 */}
            <div className="mt-5 flex flex-wrap gap-x-9 gap-y-3">
              <Stat value="4.9" label="综合评分" />
              <Stat value={compactCount(course.learnersCount)} label="在学人数" />
              <Stat value={durationText} label="总时长" />
            </div>

            {/* 讲师/供给/审核 */}
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-[var(--ink3)]">
              <span>讲师：{course.instructorName}</span>
              {course.contributorName && <span>内容供给：{course.contributorName}</span>}
              {course.reviewerName && <span>审核人：{course.reviewerName}</span>}
            </div>
          </div>

          {/* 合规声明（健康/防诈骗，§6.3 验收 4） */}
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

          {/* 课程大纲 */}
          <div>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-[18px] font-bold text-[var(--ink)]">课程大纲</h2>
              <span className="mono text-[12px] text-[var(--ink3)]">已学 {learnedCount}/{lessons.length}</span>
            </div>
            <ul className="stagger overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card),var(--inner-hi)]">
              {lessons.map((l, i) => {
                const isNow = i === nowIndex;
                const isDone = nowIndex === -1 ? true : i < nowIndex;
                const isLast = i === lessons.length - 1;
                const locked = !l.canAccess && !isNow;
                return (
                  <li
                    key={l.id}
                    style={{ "--i": i } as React.CSSProperties}
                    className={`border-b border-[var(--border)] last:border-b-0 ${isNow ? "bg-[var(--red-soft)]" : ""}`}
                  >
                    <OutlineRow
                      href={l.canAccess || isNow ? `/courses/${course.slug}/learn/${l.id}` : undefined}
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

          {/* 更新日志（强化持续更新，§6.3 验收 1） */}
          <div>
            <h2 className="mb-3 text-[18px] font-bold text-[var(--ink)]">更新日志</h2>
            <UpdateLog logs={updateLogs} ownerName={course.instructorName} />
          </div>

          {/* 适合谁 / 学完获得 */}
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
                  <Button href="/pricing" variant="secondary" full>订阅解锁全部</Button>
                  {/* 英语赛道提供预约试听（有道 0转正入口） */}
                  {isEnglish && <TrialBooking courseId={course.id} track={course.category} source="youdao_dict" />}
                </>
              )}
            </div>

            {/* 订阅门：有说服力的三点价值，而非干巴巴一句话 */}
            {!hasAccess && (
              <ul className="mt-4 space-y-2 text-[12.5px] leading-[1.5] text-[var(--ink2)]">
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
            <p className="mt-2 text-[12.5px] leading-[1.7] text-[var(--ink2)]">
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
        <Link href="/courses" className="text-[13px] text-[var(--red)] hover:underline">← 返回课程库</Link>
      </div>
    </div>
  );
}

/* ============ 页面专属子组件 ============ */

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="mono text-[20px] font-extrabold leading-none tracking-tight text-[var(--ink)]">{value}</div>
      <div className="mt-1 text-[12px] text-[var(--ink3)]">{label}</div>
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

/** 大数字紧凑格式：12400 → 12.4k */
function compactCount(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
