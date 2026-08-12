import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  transaction: vi.fn(),
  courseFindUnique: vi.fn(),
  lessonFindFirst: vi.fn(),
  lessonFindUnique: vi.fn(),
  claimCourseContentMutation: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { $transaction: mocks.transaction },
}));
vi.mock("@/lib/session", () => {
  class AuthError extends Error { status = 401; }
  return { AuthError, requirePermission: mocks.requirePermission };
});
vi.mock("@/lib/course-gen", () => ({ claimCourseContentMutation: mocks.claimCourseContentMutation }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));

import { PATCH as patchCourse } from "@/app/api/admin/courses/[id]/route";
import { PATCH as patchLesson } from "@/app/api/admin/lessons/[id]/route";

function request(path: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePermission.mockResolvedValue({ id: "admin" });
  mocks.courseFindUnique.mockResolvedValue({
    id: "course_1",
    status: "published",
    sharedStatus: "private",
    presentationRevision: 7,
  });
  mocks.transaction.mockImplementation(async (run) => run({
    course: { findUnique: mocks.courseFindUnique },
    lesson: { findFirst: mocks.lessonFindFirst, findUnique: mocks.lessonFindUnique },
  }));
});

describe("faithful import 不可逆交付物保护", () => {
  it("全课语义编辑在 revision/job 写入前拒绝清空 faithful HTML", async () => {
    mocks.lessonFindFirst.mockResolvedValue({ id: "faithful_lesson" });

    const response = await patchCourse(request("/api/admin/courses/course_1", { title: "新标题" }), {
      params: Promise.resolve({ id: "course_1" }),
    });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("原课件");
    expect(mocks.claimCourseContentMutation).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("单节内容编辑拒绝 faithful_import，不进入清 HTML 分支", async () => {
    mocks.lessonFindUnique.mockResolvedValue({
      blocksJson: "{}",
      htmlJson: "{\"html\":\"original\"}",
      renderEngine: "faithful_import",
      contentType: "ai_html",
      course: { id: "course_1", status: "published", genStatus: "ready", presentationRevision: 7 },
    });

    const response = await patchLesson(request("/api/admin/lessons/faithful_lesson", { title: "新章节名" }), {
      params: Promise.resolve({ id: "faithful_lesson" }),
    });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("原课件");
    expect(mocks.claimCourseContentMutation).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
