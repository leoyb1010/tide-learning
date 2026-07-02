import { notFound } from "next/navigation";
import Link from "next/link";
import { getCourseDetail, listCourses } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";
import { canAccessTrack } from "@/lib/entitlement";
import { CoverBg, Badge, Button } from "@/components/ui";
import { LessonList } from "@/components/LessonList";
import { UpdateLog } from "@/components/UpdateLog";
import { CourseCard } from "@/components/CourseCard";
import { TrialBooking } from "@/components/TrialBooking";
import { TRACK_MAP } from "@/lib/tracks";

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

  const { course, snapshot, categoryLabel, levelLabel, durationText, lessons, updateLogs } = detail;
  const firstFree = lessons.find((l) => l.isFree);
  const firstLesson = lessons[0];
  const needsCompliance = ["life", "silver_english"].includes(course.category) && course.reviewerName;
  const hasAccess = canAccessTrack(course.category, snapshot); // 按赛道判断，非全站
  const isEnglish = TRACK_MAP[course.category]?.isEnglish;
  const related = (await listCourses({ category: course.category })).filter((c) => c.id !== course.id).slice(0, 3);

  return (
    <div className="space-y-10">
      {/* 封面 + 概要 */}
      <section className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
        <div>
          <CoverBg color={course.coverColor} className="mb-5 aspect-[16/8] w-full rounded-2xl" />
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="tide">{categoryLabel}</Badge>
            <Badge tone="muted">{levelLabel}</Badge>
            {course.updateCadence && <Badge tone="dawn">{course.updateCadence}</Badge>}
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink-950">{course.title}</h1>
          {course.subtitle && <p className="mt-2 text-lg text-ink-500">{course.subtitle}</p>}
          {course.description && <p className="prose-body mt-4 text-ink-800">{course.description}</p>}
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-500">
            <span>讲师：{course.instructorName}</span>
            {course.contributorName && <span>内容供给：{course.contributorName}</span>}
            {course.reviewerName && <span>审核人：{course.reviewerName}</span>}
          </div>
        </div>

        {/* 订阅/继续学习卡 */}
        <aside className="h-fit rounded-2xl border border-ink-100 bg-paper-raised p-5 md:sticky md:top-24">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <Data label="章节数" value={`${lessons.length} 讲`} />
            <Data label="总时长" value={durationText} />
            <Data label="学习人数" value={course.learnersCount.toLocaleString()} />
            <Data label="免费试学" value={`${lessons.filter((l) => l.isFree).length} 讲`} />
          </dl>
          <div className="mt-5 space-y-2.5">
            {hasAccess ? (
              <Button href={`/courses/${course.slug}/learn/${firstLesson?.id}`} full size="lg">继续学习</Button>
            ) : (
              <>
                {firstFree && <Button href={`/courses/${course.slug}/learn/${firstFree.id}`} full size="lg">免费试学第一章</Button>}
                <Button href="/pricing" variant="secondary" full>订阅解锁全部</Button>
                {/* 英语赛道提供预约试听（有道 0转正入口） */}
                {isEnglish && <TrialBooking courseId={course.id} track={course.category} source="youdao_dict" />}
              </>
            )}
          </div>
          <p className="mt-3 text-center text-xs text-ink-400">
            {snapshot.isSubscriber && !hasAccess ? "你的订阅未覆盖该赛道，升级全站即可解锁" : "订阅后解锁该赛道课程 · 笔记永久保留"}
          </p>
        </aside>
      </section>

      {/* 合规声明（健康/防诈骗/财务，§6.3 验收 4）*/}
      {needsCompliance && (
        <section className="rounded-2xl border border-warning/20 bg-warning/5 p-5">
          <p className="text-sm font-medium text-ink-950">内容说明</p>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
            {course.disclaimer ??
              "本课程内容经内容审核人审核，仅用于信息素养与防范意识学习，不构成任何专业建议。"}
          </p>
          <p className="mt-1.5 text-xs text-ink-400">审核人：{course.reviewerName}</p>
        </section>
      )}

      {/* 更新日志（放大纲前，强化持续更新，§6.3 验收 1）*/}
      <section>
        <h2 className="mb-4 text-xl font-semibold text-ink-950">更新日志</h2>
        <UpdateLog logs={updateLogs} ownerName={course.instructorName} />
      </section>

      {/* 课程大纲 */}
      <section>
        <h2 className="mb-4 text-xl font-semibold text-ink-950">课程大纲</h2>
        <LessonList courseSlug={course.slug} lessons={lessons} />
      </section>

      {/* 适合谁 / 学完获得 */}
      <section className="grid gap-5 sm:grid-cols-2">
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
      </section>

      {/* 相关推荐 */}
      {related.length > 0 && (
        <section>
          <h2 className="mb-4 text-xl font-semibold text-ink-950">相关课程</h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((c) => <CourseCard key={c.id} course={c} />)}
          </div>
        </section>
      )}

      <div className="text-center">
        <Link href="/courses" className="text-sm text-tide-700 hover:underline">← 返回课程库</Link>
      </div>
    </div>
  );
}

function Data({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-400">{label}</dt>
      <dd className="mt-0.5 font-medium text-ink-950 tabular">{value}</dd>
    </div>
  );
}
function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-paper-raised p-5">
      <h3 className="mb-3 font-medium text-ink-950">{title}</h3>
      <ul className="space-y-2 text-sm text-ink-500">{children}</ul>
    </div>
  );
}
