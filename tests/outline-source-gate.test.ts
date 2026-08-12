import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  courseFindUnique: vi.fn(),
  importedSourceFindFirst: vi.fn(),
  lessonFindMany: vi.fn(),
  transaction: vi.fn(),
  txLessonDeleteMany: vi.fn(),
  txLessonUpdate: vi.fn(),
  txLessonCreate: vi.fn(),
  txLessonFindMany: vi.fn(),
  txCourseUpdateMany: vi.fn(),
  txGenerationJobCount: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    course: { findUnique: mocks.courseFindUnique },
    importedSource: { findFirst: mocks.importedSourceFindFirst },
    lesson: { findMany: mocks.lessonFindMany },
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

import { PATCH } from "@/app/api/courses/[id]/outline/route";

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/courses/course_1/outline", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function contentBrief(input: { request?: string; sourceBased?: boolean; sourceAsOf?: string } = {}) {
  return JSON.stringify({
    v: 1,
    request: input.request ?? "学习 JavaScript 基础",
    sourceBased: input.sourceBased ?? false,
    ...(input.sourceAsOf ? { sourceAsOf: input.sourceAsOf } : {}),
  });
}

function course(overrides: Record<string, unknown> = {}) {
  return {
    id: "course_1",
    title: "JavaScript 基础",
    category: "ai_skill",
    origin: "ai_generated",
    authorUserId: "user_1",
    status: "published",
    genStatus: "outline_draft",
    presentationRevision: 0,
    blueprintJson: null,
    contentBriefJson: contentBrief(),
    lessons: [{ id: "lesson_1", title: "闭包", summary: "理解作用域" }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: "user_1" });
  mocks.courseFindUnique.mockResolvedValue(course());
  mocks.importedSourceFindFirst.mockResolvedValue(null);
  mocks.txLessonDeleteMany.mockResolvedValue({ count: 0 });
  mocks.txLessonUpdate.mockResolvedValue({});
  mocks.txLessonCreate.mockResolvedValue({});
  mocks.txLessonFindMany.mockResolvedValue([{ title: "闭包", summary: "理解作用域" }]);
  mocks.txCourseUpdateMany.mockResolvedValue({ count: 1 });
  mocks.txGenerationJobCount.mockResolvedValue(0);
  mocks.lessonFindMany.mockResolvedValue([{ id: "lesson_1", title: "闭包", summary: "理解作用域" }]);
  mocks.transaction.mockImplementation(async (callback) => callback({
    lesson: {
      deleteMany: mocks.txLessonDeleteMany,
      update: mocks.txLessonUpdate,
      create: mocks.txLessonCreate,
      findMany: mocks.txLessonFindMany,
    },
    course: { updateMany: mocks.txCourseUpdateMany },
    generationJob: { count: mocks.txGenerationJobCount },
  }));
});

describe("outline PATCH 最终内容来源门", () => {
  it("用请求体的最终课名重算，快变改名缺来源时拒绝", async () => {
    const response = await PATCH(request({
      title: "OpenAI API 最新价格",
      lessons: [{ id: "lesson_1", title: "计费结构", summary: "对比当前费率" }],
    }), { params: Promise.resolve({ id: "course_1" }) });

    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain("参考资料");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("省略已有课节 summary 时仍按数据库最终值判定，不能绕过高风险门", async () => {
    mocks.courseFindUnique.mockResolvedValue(course({
      lessons: [{ id: "lesson_1", title: "风险边界", summary: "给出具体用药建议" }],
    }));

    const response = await PATCH(request({
      lessons: [{ id: "lesson_1", title: "风险边界" }],
    }), { params: Promise.resolve({ id: "course_1" }) });

    expect(response.status).toBe(422);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("已持久化参考资料仍不能替代快变主题的截至日期", async () => {
    mocks.courseFindUnique.mockResolvedValue(course({
      blueprintJson: JSON.stringify({ referenceText: "官方价格文档" }),
    }));

    const response = await PATCH(request({
      title: "OpenAI API 最新价格",
      lessons: [{ id: "lesson_1", title: "计费结构" }],
    }), { params: Promise.resolve({ id: "course_1" }) });

    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain("截至日期");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("安全的 proposed title 能替代旧的快变课名并正常落库", async () => {
    mocks.courseFindUnique.mockResolvedValue(course({
      title: "OpenAI API 最新价格",
      contentBriefJson: contentBrief({ request: "学习 JavaScript 基础" }),
    }));

    const response = await PATCH(request({
      title: "JavaScript 闭包基础",
      lessons: [{ id: "lesson_1", title: "闭包", summary: "理解作用域" }],
    }), { params: Promise.resolve({ id: "course_1" }) });

    expect(response.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.txCourseUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ title: "JavaScript 闭包基础" }),
    }));
  });

  it("持久化来源和截至日期齐全时允许快变大纲，导入来源也能满足高风险来源门", async () => {
    mocks.courseFindUnique.mockResolvedValue(course({
      blueprintJson: JSON.stringify({ referenceText: "官方价格文档" }),
      contentBriefJson: contentBrief({ sourceAsOf: "2026-08-12" }),
    }));
    let response = await PATCH(request({
      title: "OpenAI API 最新价格",
      lessons: [{ id: "lesson_1", title: "计费结构" }],
    }), { params: Promise.resolve({ id: "course_1" }) });
    expect(response.status).toBe(200);

    mocks.courseFindUnique.mockResolvedValue(course({
      category: "user_imported",
      origin: "user_imported",
      contentBriefJson: contentBrief({ request: "整理导入资料", sourceBased: true }),
      lessons: [{ id: "lesson_1", title: "用药边界", summary: "导入资料中的用药建议" }],
    }));
    mocks.importedSourceFindFirst.mockResolvedValueOnce({ rawText: "导入药物资料原文" });
    response = await PATCH(request({
      title: "药物资料整理",
      lessons: [{ id: "lesson_1", title: "用药边界" }],
    }), { params: Promise.resolve({ id: "course_1" }) });
    expect(response.status).toBe(200);
  });

  it("归档草稿不可编辑，与 confirm/重拟活租约冲突时整个事务不写课节", async () => {
    mocks.courseFindUnique.mockResolvedValueOnce(course({ status: "archived" }));
    let response = await PATCH(request({
      lessons: [{ id: "lesson_1", title: "闭包", summary: "理解作用域" }],
    }), { params: Promise.resolve({ id: "course_1" }) });
    expect(response.status).toBe(409);
    expect(mocks.transaction).not.toHaveBeenCalled();

    mocks.courseFindUnique.mockResolvedValueOnce(course());
    mocks.txGenerationJobCount.mockResolvedValueOnce(1);
    response = await PATCH(request({
      lessons: [{ id: "lesson_1", title: "闭包", summary: "理解作用域" }],
    }), { params: Promise.resolve({ id: "course_1" }) });
    expect(response.status).toBe(409);
    expect(mocks.txLessonDeleteMany).not.toHaveBeenCalled();
    expect(mocks.txLessonUpdate).not.toHaveBeenCalled();
    expect(mocks.txLessonCreate).not.toHaveBeenCalled();
  });
});
