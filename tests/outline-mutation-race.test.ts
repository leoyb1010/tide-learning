import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  resolveEntitlement: vi.fn(),
  assertCanSpend: vi.fn(),
  after: vi.fn(),
  courseFindUnique: vi.fn(),
  lessonCount: vi.fn(),
  lessonFindMany: vi.fn(),
  generationJobFindFirst: vi.fn(),
  importedSourceFindFirst: vi.fn(),
  transaction: vi.fn(),
  txCourseUpdateMany: vi.fn(),
  txGenerationJobCount: vi.fn(),
  txGenerationJobUpdateMany: vi.fn(),
  txLessonDeleteMany: vi.fn(),
  txLessonCreate: vi.fn(),
  initGenJob: vi.fn(),
  finishGenJobLeaseOnly: vi.fn(),
  runCourseGenBackground: vi.fn(),
  claimCourseGenerationStart: vi.fn(),
  acquireGenerationJobLease: vi.fn(),
  finishGenerationJobLease: vi.fn(),
  runWithGenerationJobLeaseHeartbeat: vi.fn(),
  chatJson: vi.fn(),
  acquireInflight: vi.fn(),
  releaseInflight: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: mocks.after,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    course: { findUnique: mocks.courseFindUnique },
    lesson: { count: mocks.lessonCount, findMany: mocks.lessonFindMany },
    generationJob: { findFirst: mocks.generationJobFindFirst },
    importedSource: { findFirst: mocks.importedSourceFindFirst },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/session", () => {
  class AuthError extends Error {
    status: number;
    constructor(message: string, status = 401) {
      super(message);
      this.status = status;
    }
  }
  return { AuthError, requireUser: mocks.requireUser };
});

vi.mock("@/lib/entitlement", () => ({ resolveEntitlement: mocks.resolveEntitlement }));
vi.mock("@/lib/credits", () => ({ assertCanSpend: mocks.assertCanSpend }));
vi.mock("@/lib/rate-limit", () => {
  class RateLimitError extends Error {
    status = 429;
    retryAfterSec = 1;
  }
  return { RateLimitError, assertUserRateLimit: vi.fn() };
});
vi.mock("@/lib/ai/inflight", () => ({
  acquireInflight: mocks.acquireInflight,
  releaseInflight: mocks.releaseInflight,
}));
vi.mock("@/lib/ai/prompts", () => ({
  courseOutlinePrompt: vi.fn(() => ({ system: "system", user: "user" })),
  selectImportOutlineSourceText: vi.fn((text: string) => text),
}));
vi.mock("@/lib/ai/blueprint", () => ({
  readBlueprint: vi.fn((value: string | null) => value ? JSON.parse(value) : null),
  blueprintOutlineFragment: vi.fn(() => ""),
  untrustedOutlineReferenceFragment: vi.fn((text: string) => text
    ? `<reference_material trust="untrusted-data">${text.replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</reference_material>`
    : ""),
  lessonRangeForLength: vi.fn(() => ({ min: 4, max: 10 })),
}));
vi.mock("@/lib/llm", () => ({ chatJson: mocks.chatJson }));
vi.mock("@/lib/course-gen", () => ({
  initGenJob: mocks.initGenJob,
  finishGenJobLeaseOnly: mocks.finishGenJobLeaseOnly,
  runCourseGenBackground: mocks.runCourseGenBackground,
  claimCourseGenerationStart: mocks.claimCourseGenerationStart,
}));
vi.mock("@/lib/generation-job-lease", () => ({
  DEFAULT_GENERATION_JOB_LEASE_MS: 5 * 60_000,
  acquireGenerationJobLease: mocks.acquireGenerationJobLease,
  finishGenerationJobLease: mocks.finishGenerationJobLease,
  runWithGenerationJobLeaseHeartbeat: mocks.runWithGenerationJobLeaseHeartbeat,
}));

import { POST as confirmOutline } from "@/app/api/courses/[id]/outline/confirm/route";
import { POST as regenerateOutline } from "@/app/api/courses/[id]/outline/regenerate/route";

const courseLease = {
  jobId: "course_job",
  dedupeKey: "course_1",
  fencingToken: 1,
  leaseUntil: new Date(Date.now() + 60_000),
  heartbeatAt: new Date(),
};

const outlineLease = {
  jobId: "outline_job",
  dedupeKey: "course_1",
  fencingToken: 2,
  leaseUntil: new Date(Date.now() + 60_000),
  heartbeatAt: new Date(),
};

function course(overrides: Record<string, unknown> = {}) {
  return {
    id: "course_1",
    title: "JavaScript 闭包基础",
    authorUserId: "user_1",
    status: "published",
    genStatus: "outline_draft",
    presentationRevision: 3,
    modelUsed: "standard",
    category: "ai_skill",
    origin: "ai_generated",
    template: null,
    blueprintJson: null,
    contentBriefJson: JSON.stringify({ v: 1, request: "学习 JavaScript 闭包基础" }),
    lessons: [{ title: "作用域", summary: "理解词法作用域" }],
    ...overrides,
  };
}

function request(path: string) {
  return new NextRequest(`http://localhost${path}`, { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: "user_1" });
  mocks.resolveEntitlement.mockResolvedValue({ canUseLLM: true });
  mocks.assertCanSpend.mockResolvedValue(undefined);
  mocks.acquireInflight.mockReturnValue(true);
  mocks.courseFindUnique.mockResolvedValue(course());
  mocks.lessonCount.mockResolvedValue(1);
  mocks.lessonFindMany.mockResolvedValue([{ id: "new_lesson", title: "新大纲", summary: "新目标" }]);
  mocks.generationJobFindFirst.mockResolvedValue({ inputJson: JSON.stringify({ prompt: "学习 JavaScript 闭包基础" }) });
  mocks.importedSourceFindFirst.mockResolvedValue(null);
  mocks.initGenJob.mockResolvedValue(courseLease);
  mocks.claimCourseGenerationStart.mockResolvedValue(true);
  mocks.finishGenJobLeaseOnly.mockResolvedValue(true);
  mocks.acquireGenerationJobLease.mockResolvedValue(outlineLease);
  mocks.finishGenerationJobLease.mockResolvedValue(true);
  mocks.runWithGenerationJobLeaseHeartbeat.mockImplementation(async (_lease, callback) => callback());
  mocks.chatJson.mockResolvedValue({
    title: "JavaScript 闭包基础",
    subtitle: "从作用域到应用",
    intro: "理解闭包",
    outline: [{ title: "作用域", objective: "解释词法作用域", assessmentNeed: "check" }],
  });
  mocks.txCourseUpdateMany.mockResolvedValue({ count: 1 });
  mocks.txGenerationJobCount.mockResolvedValue(0);
  mocks.txGenerationJobUpdateMany.mockResolvedValue({ count: 1 });
  mocks.txLessonDeleteMany.mockResolvedValue({ count: 1 });
  mocks.txLessonCreate.mockResolvedValue({});
  mocks.transaction.mockImplementation(async (callback) => callback({
    course: { updateMany: mocks.txCourseUpdateMany },
    generationJob: {
      count: mocks.txGenerationJobCount,
      updateMany: mocks.txGenerationJobUpdateMany,
    },
    lesson: {
      deleteMany: mocks.txLessonDeleteMany,
      create: mocks.txLessonCreate,
    },
  }));
});

describe("outline mutation fencing", () => {
  it("确认大纲时若付费重拟租约仍活跃，不启动课程 worker 并释放新 lease", async () => {
    mocks.claimCourseGenerationStart.mockResolvedValueOnce(false);

    const response = await confirmOutline(
      request("/api/courses/course_1/outline/confirm"),
      { params: Promise.resolve({ id: "course_1" }) },
    );

    expect(response.status).toBe(409);
    expect(mocks.claimCourseGenerationStart).toHaveBeenCalledWith(expect.objectContaining({
      courseId: "course_1",
      lease: courseLease,
      expectedGenStatus: "outline_draft",
      expectedPresentationRevision: 3,
    }));
    expect(mocks.finishGenJobLeaseOnly).toHaveBeenCalledWith(courseLease, "outline confirmation state changed");
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.runCourseGenBackground).not.toHaveBeenCalled();
  });

  it("确认导入课时识别原文 2000 字之后的截至日期", async () => {
    const rawText = `当前 API 价格资料\n${"正文".repeat(1200)}\n截至 2026-08-12`;
    mocks.courseFindUnique.mockResolvedValue(course({
      title: "OpenAI API 当前价格",
      category: "user_imported",
      origin: "user_imported",
      contentBriefJson: JSON.stringify({ v: 1, request: "整理当前 API 价格资料", sourceBased: true }),
      lessons: [{ title: "计费结构", summary: "对比当前费率" }],
    }));
    mocks.importedSourceFindFirst.mockResolvedValue({ rawText });

    const response = await confirmOutline(
      request("/api/courses/course_1/outline/confirm"),
      { params: Promise.resolve({ id: "course_1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.assertCanSpend).toHaveBeenCalledOnce();
    expect(mocks.claimCourseGenerationStart).toHaveBeenCalledOnce();
    expect(mocks.after).toHaveBeenCalledOnce();
  });

  it("旧 confirm 的 fencing token 已失权时不能改 Course，也不能伤害新 owner", async () => {
    mocks.claimCourseGenerationStart.mockResolvedValueOnce(false);

    const response = await confirmOutline(
      request("/api/courses/course_1/outline/confirm"),
      { params: Promise.resolve({ id: "course_1" }) },
    );

    expect(response.status).toBe(409);
    expect(mocks.claimCourseGenerationStart).toHaveBeenCalledOnce();
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.finishGenJobLeaseOnly).toHaveBeenCalledWith(courseLease, "outline confirmation state changed");
  });

  it("重拟 LLM 返回时旧 revision 已失效，整笔结果回滚且不删除/重建课节", async () => {
    // preflight: snapshot CAS=1, own outline lease=1, active course job=0;
    // final write: confirm/PATCH/archive already won, so CAS=0.
    mocks.txCourseUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    mocks.txGenerationJobCount
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    const response = await regenerateOutline(
      request("/api/courses/course_1/outline/regenerate"),
      { params: Promise.resolve({ id: "course_1" }) },
    );

    expect(response.status).toBe(409);
    expect(mocks.chatJson).toHaveBeenCalledOnce();
    expect(mocks.txLessonDeleteMany).not.toHaveBeenCalled();
    expect(mocks.txLessonCreate).not.toHaveBeenCalled();
    expect(mocks.finishGenerationJobLease).toHaveBeenCalledWith(expect.objectContaining({
      jobId: outlineLease.jobId,
      fencingToken: outlineLease.fencingToken,
      status: "failed",
    }));
  });

  it("归档草稿在租约和余额预检前拒绝，不产生 LLM 或任务副作用", async () => {
    mocks.courseFindUnique.mockResolvedValue(course({ status: "archived" }));

    const response = await regenerateOutline(
      request("/api/courses/course_1/outline/regenerate"),
      { params: Promise.resolve({ id: "course_1" }) },
    );

    expect(response.status).toBe(409);
    expect(mocks.acquireGenerationJobLease).not.toHaveBeenCalled();
    expect(mocks.assertCanSpend).not.toHaveBeenCalled();
    expect(mocks.chatJson).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("导入课重拟大纲时把实际 ImportedSource 放进 untrusted-data 边界", async () => {
    mocks.courseFindUnique.mockResolvedValue(course({
      category: "user_imported",
      origin: "user_imported",
      contentBriefJson: JSON.stringify({ v: 1, request: "忠实整理导入资料", sourceBased: true }),
    }));
    mocks.importedSourceFindFirst.mockResolvedValue({ rawText: "导入原文：此结论只在指定边界内成立。" });
    mocks.txGenerationJobCount
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    const response = await regenerateOutline(
      request("/api/courses/course_1/outline/regenerate"),
      { params: Promise.resolve({ id: "course_1" }) },
    );

    expect(response.status).toBe(200);
    const llmInput = mocks.chatJson.mock.calls[0]?.[0] as { user?: string };
    expect(llmInput.user).toContain('<reference_material trust="untrusted-data">');
    expect(llmInput.user).toContain("导入原文：此结论只在指定边界内成立。");
    expect(mocks.importedSourceFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ generatedCourseId: "course_1", userId: "user_1", parseStatus: "parsed" }),
    }));
  });

  it("旧 job.prompt 可恢复需求但其日期不可提权，且在付费 LLM 前拒绝", async () => {
    mocks.courseFindUnique.mockResolvedValue(course({
      title: "历史课程",
      contentBriefJson: null,
      blueprintJson: JSON.stringify({ referenceText: "官方价格文档，未标明截至日期" }),
      lessons: [{ title: "计费结构", summary: "理解费率" }],
    }));
    mocks.generationJobFindFirst.mockResolvedValue({
      inputJson: JSON.stringify({ prompt: "截至 2026-08-12 的 OpenAI API 最新价格" }),
    });

    const response = await regenerateOutline(
      request("/api/courses/course_1/outline/regenerate"),
      { params: Promise.resolve({ id: "course_1" }) },
    );

    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain("截至日期");
    expect(mocks.acquireGenerationJobLease).not.toHaveBeenCalled();
    expect(mocks.assertCanSpend).not.toHaveBeenCalled();
    expect(mocks.chatJson).not.toHaveBeenCalled();
  });
});
