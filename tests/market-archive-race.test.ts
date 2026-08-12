import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  transaction: vi.fn(),
  courseFindUnique: vi.fn(),
  courseUpdate: vi.fn(),
  courseUpdateMany: vi.fn(),
  generationJobUpdateMany: vi.fn(),
  generationJobCount: vi.fn(),
  audit: vi.fn(),
  notify: vi.fn(),
  currentFence: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: mocks.transaction,
    course: {
      findUnique: mocks.courseFindUnique,
      update: mocks.courseUpdate,
      updateMany: mocks.courseUpdateMany,
    },
    generationJob: { updateMany: mocks.generationJobUpdateMany, count: mocks.generationJobCount },
  },
}));
vi.mock("@/lib/session", () => {
  class AuthError extends Error { status = 401; }
  return { AuthError, requirePermission: mocks.requirePermission };
});
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/notify", () => ({ notify: mocks.notify }));
vi.mock("@/lib/market-eligibility", () => ({ currentCoursePublicationFence: mocks.currentFence }));

import { PATCH as patchCourse } from "@/app/api/admin/courses/[id]/route";
import { POST as moderateCourse } from "@/app/api/admin/moderation/course/route";

function request(path: string, body: Record<string, unknown>, method: "PATCH" | "POST") {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const pendingManual = {
  id: "course_1",
  title: "手工课",
  subtitle: "已审核副标题",
  description: "已审核简介",
  category: "ai_skill",
  template: null,
  designJson: null,
  status: "published",
  sharedStatus: "pending",
  authorUserId: "author",
  origin: "user_created",
  genStatus: "ready",
  generationQualityJson: null,
  presentationRevision: 5,
  lessons: [],
};

describe("archive / moderation 原子下架", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue({ id: "admin" });
    mocks.courseFindUnique.mockResolvedValue({
      id: "course_1",
      status: "published",
      sharedStatus: "shared",
      presentationRevision: 5,
    });
    mocks.courseUpdate.mockResolvedValue({ id: "course_1", status: "archived", sharedStatus: "private" });
    mocks.courseUpdateMany.mockResolvedValue({ count: 1 });
    mocks.generationJobUpdateMany.mockResolvedValue({ count: 0 });
    mocks.generationJobCount.mockResolvedValue(0);
    mocks.transaction.mockImplementation(async (run: (tx: {
      course: {
        findUnique: typeof mocks.courseFindUnique;
        update: typeof mocks.courseUpdate;
        updateMany: typeof mocks.courseUpdateMany;
      };
      generationJob: { updateMany: typeof mocks.generationJobUpdateMany; count: typeof mocks.generationJobCount };
    }) => unknown) => run({
      course: {
        findUnique: mocks.courseFindUnique,
        update: mocks.courseUpdate,
        updateMany: mocks.courseUpdateMany,
      },
      generationJob: { updateMany: mocks.generationJobUpdateMany, count: mocks.generationJobCount },
    }));
    mocks.audit.mockResolvedValue(undefined);
    mocks.notify.mockResolvedValue(undefined);
  });

  it("admin archive 在同一 Course.update 中同时写 archived + private", async () => {
    const response = await patchCourse(
      request("/api/admin/courses/course_1", { status: "archived" }, "PATCH"),
      { params: Promise.resolve({ id: "course_1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.courseUpdateMany).toHaveBeenCalledWith({
      where: { id: "course_1", presentationRevision: 5 },
      data: expect.objectContaining({
        status: "archived",
        sharedStatus: "private",
        presentationRevision: { increment: 1 },
      }),
    });
    expect(mocks.generationJobCount).toHaveBeenCalledWith({
      where: { resultRef: "course_1", status: "running" },
    });
    // 归档不撤掉任何 running owner；过期 lease 也可能仍有供应商 HTTP 在途。
    expect(mocks.generationJobUpdateMany).not.toHaveBeenCalled();
  });

  it("任何 running 生成/视觉 owner 期间归档整事务 409，不用 lease 过期猜测 HTTP 已停", async () => {
    mocks.generationJobCount.mockResolvedValueOnce(1);

    const response = await patchCourse(
      request("/api/admin/courses/course_1", { status: "archived" }, "PATCH"),
      { params: Promise.resolve({ id: "course_1" }) },
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("任务收敛");
    expect(mocks.generationJobUpdateMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("非归档状态切换也不得在付费生成中 bump revision", async () => {
    mocks.generationJobCount.mockResolvedValueOnce(1);

    const response = await patchCourse(
      request("/api/admin/courses/course_1", { status: "beta" }, "PATCH"),
      { params: Promise.resolve({ id: "course_1" }) },
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("收敛");
    expect(mocks.generationJobUpdateMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("moderation unshare 用 sharedStatus CAS，并发已下架时 409 且不写审计/通知", async () => {
    mocks.courseFindUnique.mockResolvedValue({ ...pendingManual, sharedStatus: "shared" });
    mocks.courseUpdateMany.mockResolvedValue({ count: 0 });

    const response = await moderateCourse(request("/api/admin/moderation/course", {
      courseId: "course_1",
      action: "unshare",
      reason: "安全下架",
    }, "POST"));

    expect(response.status).toBe(409);
    expect(mocks.courseUpdateMany).toHaveBeenCalledWith({
      where: { id: "course_1", sharedStatus: "shared" },
      data: { sharedStatus: "private" },
    });
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("pending manual 表现不完整时不得 approve；完整时 updateMany 绑定 ready revision", async () => {
    mocks.courseFindUnique.mockResolvedValue(pendingManual);
    mocks.currentFence.mockResolvedValueOnce(null);

    const rejected = await moderateCourse(request("/api/admin/moderation/course", {
      courseId: "course_1",
      action: "approve",
    }, "POST"));
    expect(rejected.status).toBe(409);
    expect(mocks.courseUpdateMany).not.toHaveBeenCalled();

    mocks.currentFence.mockResolvedValueOnce({
      courseId: "course_1",
      origin: "user_created",
      generationQualityJson: null,
      presentationRevision: 5,
      priceCredits: null,
      firstLessonId: "",
      authorUserId: null,
      title: "",
    });
    mocks.courseUpdateMany.mockResolvedValueOnce({ count: 1 });
    const approved = await moderateCourse(request("/api/admin/moderation/course", {
      courseId: "course_1",
      action: "approve",
    }, "POST"));
    expect(approved.status).toBe(200);
    expect(mocks.courseUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "course_1",
        sharedStatus: "pending",
        status: "published",
        genStatus: "ready",
        origin: "user_created",
        presentationRevision: 5,
        title: "手工课",
        subtitle: "已审核副标题",
        description: "已审核简介",
      }),
      data: { sharedStatus: "shared", lastUpdatedAt: expect.any(Date) },
    });
  });
});
