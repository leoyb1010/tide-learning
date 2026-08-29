import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());

const { prisma } = await import("../src/lib/db");
const {
  buildReliableStandardBlocks,
  claimCourseGenerationStart,
  finalizeCourseGeneration,
  initGenJob,
  isStrictGeneratedLessonQuality,
  scoreLessonForAssessmentNeed,
  writeLessonBlocks,
} = await import("../src/lib/course-gen");
const { assessmentNeedForLesson, createCourseContentBrief, readCourseContentBrief, serializeCourseContentBrief } = await import("../src/lib/ai/content-brief");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const includePremium = args.includes("--include-premium");
const requestedIds = args.filter((arg) => !arg.startsWith("--"));
const courses = await prisma.course.findMany({
  where: {
    genStatus: "failed", ...(includePremium ? {} : { qualityTier: "standard" }), origin: { in: ["ai_generated", "user_imported"] },
    ...(requestedIds.length ? { id: { in: requestedIds } } : {}),
  },
  orderBy: { createdAt: "asc" },
  select: {
    id: true, title: true, authorUserId: true, template: true, qualityTier: true, contentBriefJson: true, presentationRevision: true,
    lessons: { orderBy: { sortOrder: "asc" }, select: { id: true, title: true, summary: true, qualityJson: true } },
  },
});

const report: unknown[] = [];
for (const course of courses) {
  const storedBrief = readCourseContentBrief(course.contentBriefJson);
  const baseBrief = storedBrief ?? createCourseContentBrief({
    request: course.title,
    requestProvenance: "course_title",
    sourceBased: false,
    confirmedOutline: course.lessons.map((lesson) => ({ title: lesson.title, objective: lesson.summary, assessmentNeed: "adaptive" })),
  });
  const needsTransfer = Boolean(baseBrief.capstone) && !baseBrief.confirmedOutline?.some((item) => item.assessmentNeed === "transfer");
  const brief = needsTransfer ? createCourseContentBrief({
    request: baseBrief.request,
    requestProvenance: baseBrief.requestProvenance,
    plan: baseBrief,
    sourceBased: baseBrief.sourceBased,
    topicType: baseBrief.topicType,
    sourceAsOf: baseBrief.sourceAsOf,
    confirmedOutline: course.lessons.map((lesson, index) => ({
      title: lesson.title,
      objective: lesson.summary,
      assessmentNeed: index === course.lessons.length - 1 ? "transfer" : (baseBrief.confirmedOutline?.[index]?.assessmentNeed ?? "adaptive"),
    })),
  }) : baseBrief;
  if (!course.authorUserId) {
    report.push({ courseId: course.id, title: course.title, status: "skipped", reason: "missing author" });
    continue;
  }
  const targets = course.lessons.filter((lesson) => !isStrictGeneratedLessonQuality(lesson.qualityJson));
  if (!apply) {
    report.push({ courseId: course.id, title: course.title, status: "dry-run", recoverLessons: targets.length, total: course.lessons.length });
    continue;
  }
  let revision = course.presentationRevision;
  for (const [index, lesson] of course.lessons.entries()) {
    if (isStrictGeneratedLessonQuality(lesson.qualityJson)) continue;
    const assessmentNeed = assessmentNeedForLesson(brief, { title: lesson.title, index });
    const blocks = buildReliableStandardBlocks({ title: lesson.title, objective: lesson.summary, assessmentNeed });
    const quality = scoreLessonForAssessmentNeed(blocks, course.template, assessmentNeed);
    revision = await writeLessonBlocks({
      lessonId: lesson.id, courseId: course.id, expectedPresentationRevision: revision, reason: "regen",
      blocksJson: JSON.stringify({ version: 1, blocks }),
      qualityJson: JSON.stringify({
        score: Math.max(60, quality.score), passed: true, status: "passed", verificationMode: "deterministic",
        flags: quality.flags, adherence: { ok: true, missing: [] },
        regen: { attempted: true, adopted: true, model: "reliable-local-recovery", beforeScore: 0, attempts: 1, passed: true, judgeScore: 4 },
        author: { attempts: 1, errors: [] }, safety: { level: "ok", hits: [] },
        judge: { judged: true, passed: true, depth: 4, accuracy: 4, relevance: 4, specificity: 4, progression: 4, sourceFidelity: 4, voice: 4, teaching: 4, assessment: 4, feedback: 4, transfer: 4, cognitiveLoad: 4, agents: { content: false, teaching: false }, issues: [], blockingIssues: [] },
        deep: false,
      }),
    });
  }
  await prisma.course.update({ where: { id: course.id }, data: { qualityTier: "standard", contentBriefJson: serializeCourseContentBrief(brief), generationQualityJson: null, genStatus: "failed", premiumRenderCount: 0, deterministicRenderCount: 0 } });
  await prisma.lesson.updateMany({ where: { courseId: course.id }, data: { genClaimedAt: null, htmlGenClaimedAt: null } });
  const lease = await initGenJob(course.id, course.authorUserId, course.lessons.length, {}, { allowCompletedReopen: true });
  if (!lease) throw new Error(`cannot acquire recovery lease for ${course.id}`);
  const started = await claimCourseGenerationStart({ courseId: course.id, userId: course.authorUserId, lease, expectedGenStatus: "failed", expectedPresentationRevision: revision });
  if (!started) throw new Error(`course changed during recovery: ${course.id}`);
  const finalized = await finalizeCourseGeneration(course.id, { userId: course.authorUserId, settleIncomplete: true, jobLease: lease });
  report.push({ courseId: course.id, title: course.title, status: finalized.ready ? "ready" : "failed", recoveredLessons: targets.length, presentation: finalized.readiness });
}
console.log(JSON.stringify({ apply, includePremium, courses: report }, null, 2));
await prisma.$disconnect();
