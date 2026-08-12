import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  courseFindUnique: vi.fn(),
  lessonFindMany: vi.fn(),
  themeFindUnique: vi.fn(),
  start: vi.fn(),
  operationExists: vi.fn(),
  reconcile: vi.fn(),
  begin: vi.fn(),
  render: vi.fn(),
  assertCanSpend: vi.fn(),
  assertUserRateLimit: vi.fn(),
  resolveEntitlement: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    course: { findUnique: mocks.courseFindUnique },
    lesson: { findMany: mocks.lessonFindMany },
    theme: { findUnique: mocks.themeFindUnique },
  },
}));
vi.mock("@/lib/session", () => {
  class AuthError extends Error { status = 401; }
  return { AuthError, requireUser: mocks.requireUser };
});
vi.mock("@/lib/rate-limit", () => {
  class RateLimitError extends Error { status = 429; retryAfterSec = 1; }
  return { RateLimitError, assertUserRateLimit: mocks.assertUserRateLimit };
});
vi.mock("@/lib/entitlement", () => ({ resolveEntitlement: mocks.resolveEntitlement }));
vi.mock("@/lib/credits", () => ({ assertCanSpend: mocks.assertCanSpend }));
vi.mock("@/lib/ai/courseware-creative-design", () => ({ parseCreativeDesign: vi.fn() }));
vi.mock("@/lib/ai/courseware-design", () => ({ resolveCourseDesign: vi.fn() }));
vi.mock("@/lib/ai/courseware-catalog", () => ({ resolveCoursewareMode: vi.fn() }));
vi.mock("@/lib/ai/courseware-gen", () => ({
  CoursePresentationMutationLostError: class CoursePresentationMutationLostError extends Error {},
  renderAndStoreLessonHtml: mocks.render,
  createCoursewareBudget: vi.fn(),
}));
vi.mock("@/lib/course-gen", () => ({
  beginCoursePresentationMutation: mocks.begin,
  settleExternalCoursePresentation: vi.fn(),
}));
vi.mock("@/lib/course-presentation-operation", () => ({
  coursePresentationPayloadHash: () => "sha256:" + "a".repeat(64),
  coursePresentationOperationExists: mocks.operationExists,
  validatePresentationRequestId: (value: unknown) => {
    if (typeof value !== "string" || value.length < 16) throw new Error("invalid requestId");
    return value;
  },
  startCoursePresentationOperation: mocks.start,
  reconcileCoursePresentationOperationFailure: mocks.reconcile,
  recordCoursePresentationDesignSnapshot: vi.fn(),
  recordCoursePresentationRevision: vi.fn(),
  recordCoursePresentationThemeUsage: vi.fn(),
  runCoursePresentationOperationStage: vi.fn(),
  completeCoursePresentationOperation: vi.fn(),
}));

import { POST } from "@/app/api/creator/themes/[id]/apply/route";

function request() {
  return new NextRequest("http://localhost/api/creator/themes/theme-1/apply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ courseId: "course-1", requestId: "request-id-theme-gate-01" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: "user-1" });
  mocks.courseFindUnique.mockResolvedValue({
    id: "course-1",
    title: "Course",
    category: "career",
    template: null,
    designJson: null,
    customThemeId: null,
    authorUserId: "user-1",
  });
  mocks.lessonFindMany.mockResolvedValue([
    { id: "lesson-1", title: "Lesson", sortOrder: 0, blocksJson: '{"version":1,"blocks":[]}' },
  ]);
  mocks.operationExists.mockResolvedValue(false);
  mocks.start.mockResolvedValue({
    status: "acquired",
    operation: {
      lease: { jobId: "visual-job-1", dedupeKey: "visual", fencingToken: 1 },
      operationKey: "visual-job-1",
      stored: {},
    },
  });
  mocks.reconcile.mockResolvedValue({ status: "failed" });
});

describe("custom-theme whole-course paid application safety gate", () => {
  it("fails a new operation before entitlement, reservation, or provider dispatch", async () => {
    const response = await POST(request(), { params: Promise.resolve({ id: "theme-1" }) });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, error: expect.stringContaining("总预算保护") });
    expect(mocks.assertUserRateLimit).toHaveBeenCalledOnce();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.themeFindUnique).not.toHaveBeenCalled();
    expect(mocks.resolveEntitlement).not.toHaveBeenCalled();
    expect(mocks.assertCanSpend).not.toHaveBeenCalled();
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("still replays an already delivered request without current theme or billing checks", async () => {
    const replay = { themeId: "theme-1", affected: 2, rendered: 2, fallback: 0, presentationStatus: "premium" };
    mocks.operationExists.mockResolvedValue(true);
    mocks.start.mockResolvedValue({ status: "replay", response: replay });

    const response = await POST(request(), { params: Promise.resolve({ id: "theme-1" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: replay });
    expect(mocks.assertUserRateLimit).not.toHaveBeenCalled();
    expect(mocks.themeFindUnique).not.toHaveBeenCalled();
    expect(mocks.resolveEntitlement).not.toHaveBeenCalled();
    expect(mocks.assertCanSpend).not.toHaveBeenCalled();
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
});
