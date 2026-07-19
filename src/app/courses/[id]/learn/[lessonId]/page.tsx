import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getLessonForUser } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { track } from "@/lib/analytics";
import { Player } from "@/components/Player";
import { trackStillSrc, trackSceneSrc } from "@/lib/tracks";

export async function generateMetadata({ params }: { params: Promise<{ id: string; lessonId: string }> }) {
  const { lessonId } = await params;
  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, select: { title: true } });
  return { title: lesson?.title ?? "学习" };
}

export default async function LearnPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; lessonId: string }>;
  searchParams: Promise<{ t?: string; checkout?: string }>;
}) {
  const { id, lessonId } = await params;
  const { t, checkout } = await searchParams;
  const user = await getCurrentUser();
  const data = await getLessonForUser(lessonId, user?.id ?? null);
  if (!data) notFound();

  const { lesson, access, snapshot, course, outline, prevLessonId, nextLessonId } = data;

  // 埋点：免费章节试学 / 付费墙曝光（§10）
  if (lesson.isFree) {
    await track({ eventName: "lesson_trial_start", userId: user?.id, properties: { course_id: course.id, lesson_id: lessonId } });
  }
  if (!access) {
    await track({
      eventName: "paywall_view",
      userId: user?.id,
      properties: { course_id: course.id, lesson_id: lessonId, trigger: "locked_lesson" },
    });
  }
  if (checkout === "success" && access && user) {
    await track({ eventName: "lesson_continue_after_pay", userId: user.id, properties: { course_id: course.id, lesson_id: lessonId } });
  }

  // 恢复上次进度（§4.1：支付后回到原进度）
  const progress = user
    ? await prisma.learningProgress.findUnique({ where: { userId_lessonId: { userId: user.id, lessonId } } })
    : null;

  const notes = user
    ? await prisma.note.findMany({
        where: { userId: user.id, lessonId, deletedAt: null },
        orderBy: { updatedAt: "desc" },
        select: { id: true, title: true, contentMd: true, timestampSec: true, updatedAt: true },
      })
    : [];

  const lockedCount = outline.filter((o) => !o.isFree).length;

  // 问题⑧：当前用户到期待复习卡数量（与书桌 dueReviewCount 同口径），传给 Player 在课末插入复习触点。
  const dueReviewCount = user
    ? await prisma.reviewCard.count({ where: { userId: user.id, dueAt: { lte: new Date() } } })
    : 0;

  const requestedProgress = Number.parseInt(t ?? "", 10);
  const returnProgress = Number.isFinite(requestedProgress)
    ? Math.min(Math.max(requestedProgress, 0), lesson.durationSec)
    : 0;

  return (
    <Player
      courseId={course.id}
      courseSlug={course.slug}
      courseTitle={course.title}
      lesson={lesson}
      access={access}
      canCreateNote={snapshot.canCreateNoteUnlimited || !!user}
      outline={outline}
      prevLessonId={prevLessonId}
      nextLessonId={nextLessonId}
      remainingLessons={lockedCount}
      isLoggedIn={!!user}
      initialProgress={progress?.progressSec ?? returnProgress}
      initialSlidePage={progress?.lastSlideIndex ?? 0}
      initialNotes={notes.map((n) => ({ ...n, updatedAt: n.updatedAt.toISOString() }))}
      posterSrc={trackStillSrc(course.category)}
      sceneBgSrc={trackSceneSrc(course.category)}
      courseTemplate={course.template}
      dueReviewCount={dueReviewCount}
      cspNonce={(await headers()).get("x-nonce") ?? undefined}
    />
  );
}
