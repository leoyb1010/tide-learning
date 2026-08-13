import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireAccess: vi.fn(),
  inspect: vi.fn(),
  acquireInflight: vi.fn(),
  releaseInflight: vi.fn(),
  assertUniqueRequestAdmission: vi.fn(),
  assertUserRateLimit: vi.fn(),
  start: vi.fn(),
  reconcile: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/session", () => {
  class AuthError extends Error { status = 401; }
  return { AuthError, requireUser: mocks.requireUser };
});
vi.mock("@/lib/rate-limit", () => {
  class RateLimitError extends Error {
    status = 429;
    constructor(public retryAfterSec = 1) {
      super("请求过于频繁，请稍后再试");
    }
  }
  return {
    RateLimitError,
    assertUniqueRequestAdmission: mocks.assertUniqueRequestAdmission,
    assertUserRateLimit: mocks.assertUserRateLimit,
  };
});
vi.mock("@/lib/llm", () => ({ chatJson: vi.fn() }));
vi.mock("@/lib/credits", () => ({ assertCanSpend: vi.fn() }));
vi.mock("@/lib/ai-guard", () => ({ requireCourseGenAccess: mocks.requireAccess }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/format", () => ({ slugify: vi.fn(() => "course") }));
vi.mock("@/lib/course-gen", () => ({ initGenJob: vi.fn(), runCourseGenBackground: vi.fn() }));
vi.mock("@/lib/ai/prompts", () => ({ courseOutlinePrompt: vi.fn(() => ({ system: "", user: "" })) }));
vi.mock("@/lib/ai/templates", () => ({ isValidTemplate: vi.fn(() => true) }));
vi.mock("@/lib/ai/models", () => ({ selectModelFor: vi.fn(() => ({ key: "deepseek-chat" })) }));
vi.mock("@/lib/ai/blueprint", () => ({
  parseBlueprint: vi.fn(() => null),
  serializeBlueprint: vi.fn(),
  blueprintOutlineFragment: vi.fn(() => ""),
  lessonRangeForLength: vi.fn(),
}));
vi.mock("@/lib/ai/content-brief", () => ({
  createCourseContentBrief: vi.fn(),
  normalizeAssessmentNeed: vi.fn(() => "none"),
  serializeCourseContentBrief: vi.fn(),
}));
vi.mock("@/lib/ai/inflight", () => ({
  acquireInflight: mocks.acquireInflight,
  releaseInflight: mocks.releaseInflight,
}));
vi.mock("@/lib/ai/source-policy", () => ({
  sourcePolicyForTopic: vi.fn(() => ({ requiresSource: false, requiresAsOfDate: false })),
  sourcePolicyForFinalCourseOutline: vi.fn(),
}));
vi.mock("@/lib/generation-job-lease", () => ({ runWithGenerationJobLeaseHeartbeat: vi.fn() }));
vi.mock("@/lib/course-outline-operation", () => {
  class CourseOutlineReversalPendingError extends Error {
    status = 503;
  }
  return {
    CourseOutlineReversalPendingError,
    completeCourseOutlineOperation: vi.fn(),
    courseOutlinePayloadHash: vi.fn(() => "sha256:" + "a".repeat(64)),
    inspectCourseOutlineOperation: mocks.inspect,
    reconcileCourseOutlineOperationFailure: mocks.reconcile,
    startCourseOutlineOperation: mocks.start,
    validateCourseOutlineRequestId: vi.fn((value: unknown) => String(value)),
  };
});

import { POST } from "@/app/api/ai/generate-course/route";

function request(requestId = "course-outline-route-request-01") {
  return new NextRequest("http://localhost/api/ai/generate-course", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "学习 TypeScript 基础", requestId }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: "outline-route-user" });
  mocks.requireAccess.mockResolvedValue({
    user: { id: "outline-route-user" },
    snapshot: { isSubscriber: true },
  });
  mocks.inspect.mockResolvedValue(null);
  mocks.start.mockResolvedValue({
    status: "acquired",
    operation: {
      lease: { jobId: "outline-job", fencingToken: 1 },
      operationKey: "outline-job",
    },
  });
  mocks.acquireInflight.mockReturnValue(false);
});

describe("generate-course durable requestId route contract", () => {
  it("replays durable done before consulting the process-local busy lock", async () => {
    const replay = {
      courseId: "course-1",
      slug: "course-1",
      title: "TypeScript",
      lessons: [],
    };
    mocks.inspect.mockResolvedValue({ status: "replay", response: replay });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: replay });
    expect(mocks.inspect).toHaveBeenCalledOnce();
    expect(mocks.requireAccess).not.toHaveBeenCalled();
    expect(mocks.assertUniqueRequestAdmission).not.toHaveBeenCalled();
    expect(mocks.acquireInflight).not.toHaveBeenCalled();
    expect(mocks.assertUserRateLimit).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("replays a committed result even when current entitlement would reject a new course", async () => {
    const replay = {
      courseId: "course-free-quota-used",
      slug: "course-free-quota-used",
      title: "已经提交的课程",
      lessons: [],
    };
    mocks.inspect.mockResolvedValue({ status: "replay", response: replay });
    mocks.requireAccess.mockRejectedValue(new Error("本月免费造课已用完"));

    const response = await POST(request("course-outline-lost-response-01"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: replay });
    expect(mocks.requireAccess).not.toHaveBeenCalled();
    expect(mocks.assertUniqueRequestAdmission).not.toHaveBeenCalled();
    expect(mocks.assertUserRateLimit).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("lets the atomic start winner decide a raced replay before entitlement and rate limiting", async () => {
    const replay = {
      courseId: "course-raced-replay",
      slug: "course-raced-replay",
      title: "并发赢家已提交",
      lessons: [],
    };
    mocks.inspect.mockResolvedValue(null);
    mocks.start.mockResolvedValue({ status: "replay", response: replay });
    mocks.requireAccess.mockRejectedValue(new Error("当前权益已失效"));

    const response = await POST(request("course-outline-raced-replay-01"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: replay });
    expect(mocks.assertUniqueRequestAdmission).toHaveBeenCalledWith(
      "outline-route-user", "ai_gen_course", "course-outline-raced-replay-01", 30, 86_400_000,
    );
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.requireAccess).not.toHaveBeenCalled();
    expect(mocks.assertUserRateLimit).not.toHaveBeenCalled();
    expect(mocks.acquireInflight).not.toHaveBeenCalled();
    expect(mocks.releaseInflight).not.toHaveBeenCalled();
  });

  it.each([
    ["running", true],
    ["failed", false],
  ] as const)("returns a raced %s operation before entitlement or rate limiting", async (status, preserve) => {
    mocks.inspect.mockResolvedValue(null);
    mocks.start.mockResolvedValue({ status });
    mocks.requireAccess.mockRejectedValue(new Error("不应调用当前权益"));

    const response = await POST(request(`course-outline-raced-${status}-01`));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.ok).toBe(false);
    if (preserve) expect(body.data).toMatchObject({ code: "COURSE_OUTLINE_RUNNING", preserveRequestId: true });
    else expect(body.data).toBeUndefined();
    expect(mocks.requireAccess).not.toHaveBeenCalled();
    expect(mocks.assertUserRateLimit).not.toHaveBeenCalled();
    expect(mocks.acquireInflight).not.toHaveBeenCalled();
    expect(mocks.releaseInflight).not.toHaveBeenCalled();
  });

  it("新 requestId 准入被拒时 429，且零 start / reconcile / 动态门", async () => {
    const { RateLimitError } = await import("@/lib/rate-limit");
    mocks.assertUniqueRequestAdmission.mockImplementation(() => { throw new RateLimitError(60); });

    const response = await POST(request("course-outline-admission-denied-01"));

    expect(response.status).toBe(429);
    expect(mocks.inspect).toHaveBeenCalledOnce();
    expect(mocks.assertUniqueRequestAdmission).toHaveBeenCalledOnce();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.requireAccess).not.toHaveBeenCalled();
    expect(mocks.acquireInflight).not.toHaveBeenCalled();
    expect(mocks.assertUserRateLimit).not.toHaveBeenCalled();
    expect(mocks.releaseInflight).not.toHaveBeenCalled();
  });

  it("marks the same durable live request as machine-readable without rate limiting", async () => {
    mocks.inspect.mockResolvedValue({ status: "running" });

    const response = await POST(request("course-outline-live-request-01"));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      ok: false,
      data: { code: "COURSE_OUTLINE_RUNNING", preserveRequestId: true },
    });
    expect(mocks.acquireInflight).not.toHaveBeenCalled();
    expect(mocks.assertUniqueRequestAdmission).not.toHaveBeenCalled();
    expect(mocks.assertUserRateLimit).not.toHaveBeenCalled();
  });

  it("旧客户端缺 requestId 不再 400：服务端生成合法 ID 进入幂等流程", async () => {
    const legacyRequest = new NextRequest("http://localhost/api/ai/generate-course", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "学习 TypeScript 基础" }),
    });
    const replay = {
      courseId: "course-1",
      slug: "course-1",
      title: "TypeScript 基础",
      lessons: [],
    };
    mocks.inspect.mockResolvedValue({ status: "replay", response: replay });
    const response = await POST(legacyRequest);
    expect(response.status).toBe(200);
    expect(mocks.inspect).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: expect.stringMatching(/^srv-[0-9a-f]{32}$/) }),
    );
  });

  it("有值但格式非法仍 400，不兜底", async () => {
    const response = await POST(request("short"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: "requestId 格式错误" });
    expect(mocks.inspect).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
