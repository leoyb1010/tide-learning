import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireLessonGenAccess: vi.fn(),
  generateLessonCore: vi.fn(),
  initGenJob: vi.fn(),
  runCourseGenBackground: vi.fn(),
  claimCourseGenerationStart: vi.fn(),
  failGenJobLease: vi.fn(),
  finishGenJobLeaseOnly: vi.fn(),
  beginCoursePresentationMutation: vi.fn(),
  assessLessonPresentationRefinePreflight: vi.fn(),
  settleExternalCoursePresentation: vi.fn(),
  generateLessonHtml: vi.fn(),
  assessCourseGenerationPublication: vi.fn(),
  courseFindFirst: vi.fn(),
  courseUpdate: vi.fn(),
  courseUpdateMany: vi.fn(),
  lessonFindUnique: vi.fn(),
  importedSourceFindFirst: vi.fn(),
  lessonFindMany: vi.fn(),
  lessonCount: vi.fn(),
  coursePurchaseFindMany: vi.fn(),
  chatJson: vi.fn(),
  track: vi.fn(),
  after: vi.fn(),
  startCoursePresentationOperation: vi.fn(),
  coursePresentationOperationExists: vi.fn(),
  assertUserRateLimit: vi.fn(),
  recordCoursePresentationRevision: vi.fn(),
  runCoursePresentationOperationStage: vi.fn(),
  completeCoursePresentationOperation: vi.fn(),
  reconcileCoursePresentationOperationFailure: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: mocks.after,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    course: { findFirst: mocks.courseFindFirst, update: mocks.courseUpdate, updateMany: mocks.courseUpdateMany },
    lesson: { findUnique: mocks.lessonFindUnique, findMany: mocks.lessonFindMany, count: mocks.lessonCount },
    importedSource: { findFirst: mocks.importedSourceFindFirst },
    coursePurchase: { findMany: mocks.coursePurchaseFindMany },
  },
}));

vi.mock("@/lib/session", () => {
  class AuthError extends Error {
    status: number;
    constructor(message: string, status = 401) { super(message); this.status = status; }
  }
  return { AuthError, requireUser: mocks.requireUser };
});

vi.mock("@/lib/rate-limit", () => {
  class RateLimitError extends Error {
    status = 429;
    retryAfterSec = 1;
  }
  return { RateLimitError, assertUserRateLimit: mocks.assertUserRateLimit };
});

vi.mock("@/lib/ai-guard", () => ({ requireLessonGenAccess: mocks.requireLessonGenAccess }));
vi.mock("@/lib/course-gen", () => ({
  generateLessonCore: mocks.generateLessonCore,
  initGenJob: mocks.initGenJob,
  runCourseGenBackground: mocks.runCourseGenBackground,
  claimCourseGenerationStart: mocks.claimCourseGenerationStart,
  failGenJobLease: mocks.failGenJobLease,
  finishGenJobLeaseOnly: mocks.finishGenJobLeaseOnly,
  beginCoursePresentationMutation: mocks.beginCoursePresentationMutation,
  assessLessonPresentationRefinePreflight: mocks.assessLessonPresentationRefinePreflight,
  settleExternalCoursePresentation: mocks.settleExternalCoursePresentation,
  assessCourseGenerationPublication: mocks.assessCourseGenerationPublication,
}));
vi.mock("@/lib/ai/courseware-gen", () => ({
  CoursePresentationMutationLostError: class CoursePresentationMutationLostError extends Error {},
  generateLessonHtml: mocks.generateLessonHtml,
}));
vi.mock("@/lib/llm", () => ({ chatJson: mocks.chatJson }));
vi.mock("@/lib/analytics", () => ({ track: mocks.track }));
vi.mock("@/lib/course-presentation-operation", () => ({
  validatePresentationRequestId: (value: unknown) => {
    if (typeof value !== "string" || value.length < 16) throw new Error("invalid requestId");
    return value;
  },
  startCoursePresentationOperation: mocks.startCoursePresentationOperation,
  coursePresentationOperationExists: mocks.coursePresentationOperationExists,
  recordCoursePresentationRevision: mocks.recordCoursePresentationRevision,
  runCoursePresentationOperationStage: mocks.runCoursePresentationOperationStage,
  completeCoursePresentationOperation: mocks.completeCoursePresentationOperation,
  reconcileCoursePresentationOperationFailure: mocks.reconcileCoursePresentationOperationFailure,
}));
vi.mock("@/lib/notify", () => ({ notify: vi.fn() }));
vi.mock("@/lib/content-safety", () => ({
  scanContentSafety: vi.fn(() => ({ level: "ok", hits: [] })),
}));

import { POST as generateLesson } from "@/app/api/ai/generate-lesson/route";
import { POST as regenerateLesson } from "@/app/api/ai/regenerate-lesson/route";
import { POST as generateLessonHtml } from "@/app/api/ai/generate-lesson-html/route";
import { POST as shareCourse } from "@/app/api/market/share/route";

function request(path: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertUserRateLimit.mockReset();
  mocks.assertUserRateLimit.mockReturnValue(undefined);
  mocks.coursePresentationOperationExists.mockReset();
  mocks.requireUser.mockResolvedValue({ id: "user_1" });
  mocks.requireLessonGenAccess.mockResolvedValue({ user: { id: "user_1" }, snapshot: { canUseLLM: true } });
  mocks.lessonFindUnique.mockResolvedValue({ courseId: "course_1", course: { authorUserId: "user_1" } });
  mocks.importedSourceFindFirst.mockResolvedValue(null);
  mocks.lessonCount.mockResolvedValue(2);
  mocks.initGenJob.mockResolvedValue({
    jobId: "job_1",
    dedupeKey: "course_1",
    fencingToken: 1,
    leaseUntil: new Date(Date.now() + 60_000),
    heartbeatAt: new Date(),
  });
  mocks.runCourseGenBackground.mockResolvedValue(undefined);
  mocks.claimCourseGenerationStart.mockResolvedValue(true);
  mocks.courseUpdate.mockResolvedValue({});
  mocks.courseUpdateMany.mockResolvedValue({ count: 1 });
  mocks.failGenJobLease.mockResolvedValue(true);
  mocks.finishGenJobLeaseOnly.mockResolvedValue(true);
  mocks.beginCoursePresentationMutation.mockResolvedValue({ ok: true, revision: 1, lessonIds: ["lesson_1"] });
  mocks.assessLessonPresentationRefinePreflight.mockResolvedValue({ ok: true, reason: "ready" });
  mocks.coursePresentationOperationExists.mockResolvedValue(false);
  mocks.settleExternalCoursePresentation.mockResolvedValue({
    settled: true,
    contentReady: true,
    status: "degraded",
    ready: 1,
    total: 1,
  });
  mocks.coursePurchaseFindMany.mockResolvedValue([]);
  mocks.track.mockResolvedValue(undefined);
  const operation = {
    lease: { jobId: "presentation_job_1", dedupeKey: "presentation", fencingToken: 1 },
    operationKey: "presentation_job_1",
    stored: { presentationRevision: null },
  };
  mocks.startCoursePresentationOperation.mockResolvedValue({ status: "acquired", operation });
  mocks.recordCoursePresentationRevision.mockImplementation(async (value) => value);
  mocks.runCoursePresentationOperationStage.mockImplementation(async (_operation, task) => task());
  mocks.completeCoursePresentationOperation.mockResolvedValue(undefined);
  mocks.reconcileCoursePresentationOperationFailure.mockResolvedValue({ status: "failed" });
});

describe("generate-lesson API 终态契约", () => {
  it("在 acquire job/改课程状态前拒绝订阅用户操作他人课节", async () => {
    mocks.lessonFindUnique.mockResolvedValue({ courseId: "course_other", course: { authorUserId: "owner_other" } });
    const response = await generateLesson(request("/api/ai/generate-lesson", { lessonId: "lesson_other" }));
    expect(response.status).toBe(403);
    expect(mocks.initGenJob).not.toHaveBeenCalled();
    expect(mocks.courseUpdate).not.toHaveBeenCalled();
    expect(mocks.generateLessonCore).not.toHaveBeenCalled();
  });

  it("质量失败返回非 2xx，并保留内核 ok/failed/allReady 真值", async () => {
    mocks.generateLessonCore.mockResolvedValue({
      ok: false,
      failed: true,
      allReady: false,
      blocks: 1,
      qualityScore: 0,
    });

    const response = await generateLesson(request("/api/ai/generate-lesson", { lessonId: "lesson_1" }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      error: "本节未通过生成质量检查，请重试",
      data: {
        lessonId: "lesson_1",
        ok: false,
        failed: true,
        allReady: false,
        blocks: 1,
        qualityScore: 0,
      },
    });
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.runCourseGenBackground).not.toHaveBeenCalled();
    expect(mocks.failGenJobLease).toHaveBeenCalledWith(
      "course_1",
      expect.objectContaining({ jobId: "job_1", fencingToken: 1 }),
      "lesson quality gate failed",
      { genStatus: "generating" },
    );
  });

  it("成功响应也显式保留 ok/failed，不再丢字段", async () => {
    mocks.generateLessonCore.mockResolvedValue({
      ok: true,
      failed: false,
      allReady: true,
      blocks: 8,
      qualityScore: 92,
    });

    const response = await generateLesson(request("/api/ai/generate-lesson", { lessonId: "lesson_1" }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: true,
      data: { lessonId: "lesson_1", ok: true, failed: false, allReady: true, blocks: 8, qualityScore: 92 },
    });
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });
});

describe("generate-lesson-html API 表现层越权门", () => {
  it("订阅用户也不得在 begin revision/清 HTML 前操作他人课节", async () => {
    mocks.lessonFindUnique.mockResolvedValue({
      courseId: "victim_course",
      course: { id: "victim_course", authorUserId: "victim_owner" },
    });
    const response = await generateLessonHtml(request("/api/ai/generate-lesson-html", { lessonId: "victim_lesson" }));
    expect(response.status).toBe(403);
    expect(mocks.beginCoursePresentationMutation).not.toHaveBeenCalled();
    expect(mocks.generateLessonHtml).not.toHaveBeenCalled();
    expect(mocks.courseUpdate).not.toHaveBeenCalled();
    expect(mocks.courseUpdateMany).not.toHaveBeenCalled();
  });

  it("相同 requestId 已完成时只回放快照，不 begin、不调模型、不再扣费", async () => {
    const replay = { lessonId: "lesson_1", engine: "llm", presentationStatus: "premium" };
    mocks.coursePresentationOperationExists.mockResolvedValue(true);
    mocks.startCoursePresentationOperation.mockResolvedValue({ status: "replay", response: replay });
    const response = await generateLessonHtml(request("/api/ai/generate-lesson-html", {
      lessonId: "lesson_1",
      enhance: true,
      requestId: "request-id-replay-0001",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: replay });
    expect(mocks.beginCoursePresentationMutation).not.toHaveBeenCalled();
    expect(mocks.generateLessonHtml).not.toHaveBeenCalled();
    expect(mocks.completeCoursePresentationOperation).not.toHaveBeenCalled();
    expect(mocks.assessLessonPresentationRefinePreflight).not.toHaveBeenCalled();
    expect(mocks.assertUserRateLimit).not.toHaveBeenCalled();
  });

  it("第二标签页改绑同节规范 requestId 后只回放，provider 与扣费门均为 0", async () => {
    const replay = { lessonId: "lesson_1", engine: "llm", presentationStatus: "premium" };
    mocks.coursePresentationOperationExists
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    mocks.startCoursePresentationOperation
      .mockResolvedValueOnce({
        status: "busy",
        activeRequestId: "request-id-tab-a-canonical-01",
        activeKind: "lesson_html",
        activeTargetLessonIds: ["lesson_1"],
      })
      .mockResolvedValueOnce({ status: "replay", response: replay });

    const busyResponse = await generateLessonHtml(request("/api/ai/generate-lesson-html", {
      lessonId: "lesson_1",
      enhance: true,
      requestId: "request-id-tab-b-local-0001",
    }));
    expect(busyResponse.status).toBe(409);
    expect(await busyResponse.json()).toMatchObject({
      ok: false,
      data: {
        code: "COURSE_PRESENTATION_BUSY",
        activeRequestId: "request-id-tab-a-canonical-01",
        kind: "lesson_html",
        targets: ["lesson_1"],
      },
    });

    const replayResponse = await generateLessonHtml(request("/api/ai/generate-lesson-html", {
      lessonId: "lesson_1",
      enhance: true,
      requestId: "request-id-tab-a-canonical-01",
    }));
    expect(replayResponse.status).toBe(200);
    expect(await replayResponse.json()).toEqual({ ok: true, data: replay });
    expect(mocks.requireLessonGenAccess).not.toHaveBeenCalled();
    expect(mocks.beginCoursePresentationMutation).not.toHaveBeenCalled();
    expect(mocks.generateLessonHtml).not.toHaveBeenCalled();
    expect(mocks.completeCoursePresentationOperation).not.toHaveBeenCalled();
    expect(mocks.assertUserRateLimit).toHaveBeenCalledOnce();
  });

  it("不同课件操作只报忙，不暴露或自动改绑 requestId", async () => {
    mocks.startCoursePresentationOperation.mockResolvedValue({
      status: "busy",
      activeRequestId: null,
      activeKind: "custom_theme",
      activeTargetLessonIds: ["lesson_1", "lesson_2"],
    });
    const response = await generateLessonHtml(request("/api/ai/generate-lesson-html", {
      lessonId: "lesson_1",
      requestId: "request-id-other-operation-01",
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("另一课件操作"),
      data: { activeRequestId: null, kind: "custom_theme", targets: ["lesson_1", "lesson_2"] },
    });
    expect(mocks.generateLessonHtml).not.toHaveBeenCalled();
  });

  it("其他课节或内容档案未就绪时在任何权益、预占或 provider 前拒绝", async () => {
    mocks.assessLessonPresentationRefinePreflight.mockResolvedValue({
      ok: false,
      reason: "non_target_presentation_incomplete",
    });
    const response = await generateLessonHtml(request("/api/ai/generate-lesson-html", {
      lessonId: "lesson_1",
      enhance: true,
      requestId: "request-id-preflight-0001",
    }));

    expect(response.status).toBe(409);
    expect(mocks.startCoursePresentationOperation).not.toHaveBeenCalled();
    expect(mocks.assertUserRateLimit).not.toHaveBeenCalled();
    expect(mocks.requireLessonGenAccess).not.toHaveBeenCalled();
    expect(mocks.beginCoursePresentationMutation).not.toHaveBeenCalled();
    expect(mocks.generateLessonHtml).not.toHaveBeenCalled();
    expect(mocks.reconcileCoursePresentationOperationFailure).not.toHaveBeenCalled();
  });

  it("新 requestId 超限时不创建 job 或冲正墓碑", async () => {
    const error = Object.assign(new Error("请求过于频繁"), { status: 429, retryAfterSec: 60 });
    Object.setPrototypeOf(error, (await import("@/lib/rate-limit")).RateLimitError.prototype);
    mocks.assertUserRateLimit.mockImplementation(() => { throw error; });

    const response = await generateLessonHtml(request("/api/ai/generate-lesson-html", {
      lessonId: "lesson_1",
      requestId: "request-id-rate-limited-0001",
    }));
    expect(response.status).toBe(429);
    expect(mocks.startCoursePresentationOperation).not.toHaveBeenCalled();
    expect(mocks.reconcileCoursePresentationOperationFailure).not.toHaveBeenCalled();
    expect(mocks.requireLessonGenAccess).not.toHaveBeenCalled();
    expect(mocks.generateLessonHtml).not.toHaveBeenCalled();
  });
});

describe("regenerate-lesson API 终态契约", () => {
  it("导入原文丢失时在权益/余额预检和任务创建前拒绝", async () => {
    mocks.lessonFindUnique.mockResolvedValue({
      title: "闭包",
      blocksJson: '{"blocks":[]}',
      courseId: "course_1",
      course: {
        title: "导入课",
        category: "user_imported",
        origin: "user_imported",
        authorUserId: "user_1",
        status: "published",
        genStatus: "ready",
        presentationRevision: 1,
        blueprintJson: null,
        contentBriefJson: JSON.stringify({ v: 1, request: "忠实整理资料", sourceBased: true }),
      },
    });

    const response = await regenerateLesson(request("/api/ai/regenerate-lesson", {
      lessonId: "lesson_1",
      instruction: "补充反例",
    }));

    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain("原始资料已丢失");
    expect(mocks.requireLessonGenAccess).not.toHaveBeenCalled();
    expect(mocks.initGenJob).not.toHaveBeenCalled();
    expect(mocks.generateLessonCore).not.toHaveBeenCalled();
  });

  it("重造稿未通过质量门时不得返回 200", async () => {
    mocks.lessonFindUnique.mockResolvedValue({
      blocksJson: '{"blocks":[]}',
      courseId: "course_1",
      course: { authorUserId: "user_1" },
    });
    mocks.generateLessonCore.mockResolvedValue({
      ok: false,
      failed: true,
      allReady: false,
      blocks: 4,
      qualityScore: 42,
    });

    const response = await regenerateLesson(request("/api/ai/regenerate-lesson", {
      lessonId: "lesson_1",
      instruction: "补齐反例和答案解析",
    }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      error: "本节重造后仍未通过质量检查，请调整指令后重试",
      data: {
        lessonId: "lesson_1",
        ok: false,
        failed: true,
        allReady: false,
        blocks: 4,
        qualityScore: 42,
      },
    });
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.runCourseGenBackground).not.toHaveBeenCalled();
    expect(mocks.failGenJobLease).toHaveBeenCalledWith(
      "course_1",
      expect.objectContaining({ jobId: "job_1", fencingToken: 1 }),
      "lesson regeneration quality gate failed",
      { genStatus: "generating" },
    );
  });
});

describe("market/share 发布门", () => {
  const ownedCourse = {
    id: "course_1",
    title: "可分享课程",
    subtitle: null,
    description: "课程简介",
    origin: "ai_generated",
    sharedStatus: "private",
    status: "published",
    presentationRevision: 4,
    priceCredits: null,
    authorUserId: "user_1",
  };

  const passedPublication = {
    ready: true,
    readiness: { total: 2, remaining: 0, qualityFailures: 0, ready: true, retryLessons: [] },
    qualityState: "passed",
    archiveJson: '{"version":1,"inputFingerprint":"sha256:ok"}',
    presentationRevision: 4,
  };

  it("课程 genStatus 非 ready 时拒绝，且不写分享状态", async () => {
    mocks.courseFindFirst.mockResolvedValue({ ...ownedCourse, genStatus: "failed" });
    mocks.assessCourseGenerationPublication.mockResolvedValue({
      ready: true,
      readiness: { total: 2, remaining: 0, qualityFailures: 0, ready: true, retryLessons: [] },
      qualityState: "passed",
      archiveJson: '{"version":1}',
      presentationRevision: 4,
    });

    const response = await shareCourse(request("/api/market/share", { courseId: "course_1" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, error: "课程尚未通过生成质量与表现检查，暂不能分享" });
    expect(mocks.courseUpdate).not.toHaveBeenCalled();
    expect(mocks.chatJson).not.toHaveBeenCalled();
  });

  it("未发布/已归档课程不得上架集市", async () => {
    mocks.courseFindFirst.mockResolvedValue({ ...ownedCourse, status: "archived", genStatus: "ready" });

    const response = await shareCourse(request("/api/market/share", { courseId: "course_1" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, error: "只有已发布课程才能在集市上架" });
    expect(mocks.assessCourseGenerationPublication).not.toHaveBeenCalled();
    expect(mocks.courseUpdate).not.toHaveBeenCalled();
  });

  it("忠实导入课缺少专用发布/表现档案时明确 422，不静默上架", async () => {
    mocks.courseFindFirst.mockResolvedValue({
      ...ownedCourse,
      origin: "user_imported",
      status: "published",
      genStatus: "ready",
    });
    mocks.assessCourseGenerationPublication.mockResolvedValue({
      ready: false,
      readiness: { total: 1, remaining: 0, qualityFailures: 0, ready: true, retryLessons: [] },
      qualityState: "missing",
      archiveJson: null,
      presentationRevision: 0,
    });

    const response = await shareCourse(request("/api/market/share", { courseId: "course_1" }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "导入课程尚未建立专用发布审核与表现档案，暂不能上架",
    });
    expect(mocks.courseUpdate).not.toHaveBeenCalled();
    expect(mocks.courseUpdateMany).not.toHaveBeenCalled();
  });

  it("即使 genStatus=ready，任一课节不可发布也拒绝", async () => {
    mocks.courseFindFirst.mockResolvedValue({ ...ownedCourse, genStatus: "ready" });
    mocks.assessCourseGenerationPublication.mockResolvedValue({
      ready: false,
      readiness: {
        total: 2,
        remaining: 0,
        qualityFailures: 1,
        ready: false,
        retryLessons: [{ id: "lesson_2", regen: true }],
      },
      qualityState: "stale",
      archiveJson: null,
      presentationRevision: 4,
    });

    const response = await shareCourse(request("/api/market/share", { courseId: "course_1" }));
    expect(response.status).toBe(409);
    expect(mocks.courseUpdate).not.toHaveBeenCalled();
    expect(mocks.chatJson).not.toHaveBeenCalled();
  });

  it("生成课不得在整课终审后通过分享请求偷换课程标题", async () => {
    mocks.courseFindFirst.mockResolvedValue({ ...ownedCourse, genStatus: "ready" });
    mocks.assessCourseGenerationPublication.mockResolvedValue(passedPublication);

    const response = await shareCourse(request("/api/market/share", {
      courseId: "course_1",
      title: "已经变更的课程标题",
    }));
    expect(response.status).toBe(409);
    expect(mocks.courseUpdate).not.toHaveBeenCalled();
    expect(mocks.courseUpdateMany).not.toHaveBeenCalled();
  });

  it("最终上架用精确终审档案 CAS，审核期间内容变更则不得 shared", async () => {
    mocks.courseFindFirst.mockResolvedValue({ ...ownedCourse, genStatus: "ready" });
    mocks.assessCourseGenerationPublication.mockResolvedValue(passedPublication);
    mocks.lessonFindMany.mockResolvedValue([]);
    mocks.chatJson.mockResolvedValue({ verdict: "approved" });
    mocks.courseUpdateMany.mockResolvedValue({ count: 0 });

    const response = await shareCourse(request("/api/market/share", { courseId: "course_1" }));
    expect(response.status).toBe(409);
    expect(mocks.courseUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "course_1",
        status: "published",
        sharedStatus: ownedCourse.sharedStatus,
        genStatus: "ready",
        origin: ownedCourse.origin,
        generationQualityJson: passedPublication.archiveJson,
        presentationRevision: passedPublication.presentationRevision,
        title: ownedCourse.title,
        subtitle: ownedCourse.subtitle,
        description: ownedCourse.description,
        priceCredits: ownedCourse.priceCredits,
      },
      data: { sharedStatus: "shared" },
    });
  });

  it("最终上架 CAS 同时绑定本次审核的 title/subtitle/description，不用 A 判决放行 B 文案", async () => {
    mocks.courseFindFirst.mockResolvedValue({ ...ownedCourse, genStatus: "ready" });
    mocks.assessCourseGenerationPublication.mockResolvedValue(passedPublication);
    mocks.lessonFindMany.mockResolvedValue([]);
    mocks.chatJson.mockResolvedValue({ verdict: "approved" });
    mocks.courseUpdateMany.mockResolvedValue({ count: 0 }); // 模拟审核期间副标题被另一请求改写

    const response = await shareCourse(request("/api/market/share", {
      courseId: "course_1",
      subtitle: "A 请求实际送审的副标题",
    }));
    expect(response.status).toBe(409);
    expect(mocks.courseUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        title: ownedCourse.title,
        subtitle: "A 请求实际送审的副标题",
        description: ownedCourse.description,
      }),
      data: { sharedStatus: "shared" },
    });
  });

  it("作者 action=update 在并发换肤/改状态后 CAS 失败，不回报旧状态", async () => {
    mocks.courseFindFirst.mockResolvedValue({ ...ownedCourse, genStatus: "ready" });
    mocks.assessCourseGenerationPublication.mockResolvedValue(passedPublication);
    mocks.courseUpdateMany.mockResolvedValue({ count: 0 });

    const response = await shareCourse(request("/api/market/share", {
      courseId: "course_1",
      action: "update",
      subtitle: "新副标题",
    }));
    expect(response.status).toBe(409);
    expect(mocks.courseUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "course_1",
        status: "published",
        sharedStatus: "private",
        genStatus: "ready",
        generationQualityJson: passedPublication.archiveJson,
        presentationRevision: passedPublication.presentationRevision,
        title: ownedCourse.title,
        subtitle: ownedCourse.subtitle,
        description: ownedCourse.description,
        priceCredits: ownedCourse.priceCredits,
      }),
      data: { subtitle: "新副标题" },
    });
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("已 shared 课经营改价绑定当前 shared+revision+文案快照，并发下架则 409", async () => {
    mocks.courseFindFirst.mockResolvedValue({
      ...ownedCourse,
      sharedStatus: "shared",
      genStatus: "ready",
    });
    mocks.assessCourseGenerationPublication.mockResolvedValue(passedPublication);
    mocks.courseUpdateMany.mockResolvedValue({ count: 0 });

    const response = await shareCourse(request("/api/market/share", {
      courseId: "course_1",
      priceCredits: 20,
    }));
    expect(response.status).toBe(409);
    expect(mocks.courseUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        sharedStatus: "shared",
        genStatus: "ready",
        presentationRevision: passedPublication.presentationRevision,
        priceCredits: null,
      }),
      data: { priceCredits: 20 },
    });
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it("手工课提交审核的最终 CAS 绑定 genStatus=ready，不用旧表现快照放行并发生成", async () => {
    mocks.courseFindFirst.mockResolvedValue({
      ...ownedCourse,
      origin: "user_created",
      genStatus: "ready",
    });
    mocks.lessonFindMany.mockResolvedValue([]);
    mocks.chatJson.mockResolvedValue({ verdict: "approved" });
    mocks.courseUpdateMany.mockResolvedValue({ count: 0 });

    const response = await shareCourse(request("/api/market/share", { courseId: "course_1" }));
    expect(response.status).toBe(409);
    expect(mocks.courseUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "course_1",
        status: "published",
        sharedStatus: ownedCourse.sharedStatus,
        genStatus: "ready",
        origin: "user_created",
        presentationRevision: ownedCourse.presentationRevision,
        title: ownedCourse.title,
        subtitle: ownedCourse.subtitle,
        description: ownedCourse.description,
        priceCredits: ownedCourse.priceCredits,
      }),
      data: { sharedStatus: "pending" },
    });
    expect(mocks.assessCourseGenerationPublication).not.toHaveBeenCalled();
  });
});
