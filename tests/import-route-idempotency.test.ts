import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireAccess: vi.fn(),
  inspect: vi.fn(),
  start: vi.fn(),
  reconcile: vi.fn(),
  acquireInflight: vi.fn(),
  releaseInflight: vi.fn(),
  assertUniqueRequestAdmission: vi.fn(),
  assertUserRateLimit: vi.fn(),
  structure: vi.fn(),
  presentation: vi.fn(),
  scorm: vi.fn(),
  contentHash: vi.fn(),
  payloadHash: vi.fn(),
  selectModel: vi.fn(),
}));

vi.mock("@/lib/session", () => {
  class AuthError extends Error { status = 401; }
  return { AuthError, requireUser: mocks.requireUser };
});
vi.mock("@/lib/ai-guard", () => ({ requireCourseGenAccess: mocks.requireAccess }));
vi.mock("@/lib/rate-limit", () => {
  class RateLimitError extends Error {
    status = 429;
    constructor(public retryAfterSec: number) {
      super("请求过于频繁，请稍后再试");
    }
  }
  return {
    RateLimitError,
    assertUniqueRequestAdmission: mocks.assertUniqueRequestAdmission,
    assertUserRateLimit: mocks.assertUserRateLimit,
  };
});
vi.mock("@/lib/ai/inflight", () => ({
  acquireInflight: mocks.acquireInflight,
  releaseInflight: mocks.releaseInflight,
}));
vi.mock("@/lib/ai/templates", () => ({ isValidTemplate: vi.fn(() => true) }));
vi.mock("@/lib/ai/models", () => ({ selectModelFor: mocks.selectModel }));
vi.mock("@/lib/course-import", () => ({
  MIN_IMPORT_TEXT: 100,
  MAX_IMPORT_TEXT: 50_000,
  MAX_FILE_IMPORT_TEXT: 500_000,
  structureImportedTextIntoCourse: mocks.structure,
}));
vi.mock("@/lib/import-faithful", () => ({
  createPresentationCourse: mocks.presentation,
  createScormCourse: mocks.scorm,
}));
vi.mock("@/lib/import-operation", () => {
  class ImportReversalPendingError extends Error { status = 503; }
  return {
    ImportReversalPendingError,
    importContentSha256: mocks.contentHash,
    importPayloadHash: mocks.payloadHash,
    inspectImportOperation: mocks.inspect,
    reconcileImportOperationFailure: mocks.reconcile,
    startImportOperation: mocks.start,
    validateImportRequestId: vi.fn((value: unknown) => String(value)),
  };
});

import { POST as importSource } from "@/app/api/ai/import-source/route";
import { POST as importFile } from "@/app/api/ai/import-file/route";
import { AppError } from "@/lib/api";
import { RateLimitError } from "@/lib/rate-limit";

const replay = {
  courseId: "import-course-1",
  slug: "import-course-1",
  title: "导入课",
  charCount: 120,
  lessons: [{ id: "lesson-1", title: "第一节", summary: null }],
};
const operation = {
  lease: { jobId: "import-job", dedupeKey: "key", fencingToken: 1, leaseUntil: new Date(), heartbeatAt: new Date() },
  userId: "user-1",
  payloadHash: "sha256:" + "b".repeat(64),
  operationKey: "import-job",
};

function pasteRequest(requestId = "paste-import-request-0001") {
  return new NextRequest("http://localhost/api/ai/import-source", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId, rawText: "导入资料".repeat(30) }),
  });
}

function fileRequest(requestId = "file-import-request-00001", name = "notes.txt") {
  const form = new FormData();
  form.append("requestId", requestId);
  form.append("file", new File(["导入资料".repeat(30)], name, { type: "text/plain" }));
  return new NextRequest("http://localhost/api/ai/import-file", { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertUniqueRequestAdmission.mockReset();
  mocks.assertUserRateLimit.mockReset();
  mocks.requireUser.mockResolvedValue({ id: "user-1" });
  mocks.requireAccess.mockResolvedValue({ user: { id: "user-1" }, snapshot: { isSubscriber: true } });
  mocks.inspect.mockResolvedValue(null);
  mocks.acquireInflight.mockReturnValue(true);
  mocks.start.mockResolvedValue({ status: "acquired", operation });
  mocks.structure.mockResolvedValue(replay);
  mocks.presentation.mockResolvedValue({ ...replay, directReady: true, faithfulKind: "presentation" });
  mocks.scorm.mockResolvedValue({ ...replay, directReady: true, faithfulKind: "scorm" });
  mocks.reconcile.mockResolvedValue({ status: "failed" });
  mocks.contentHash.mockReturnValue("sha256:" + "a".repeat(64));
  mocks.payloadHash.mockReturnValue("sha256:" + "b".repeat(64));
  mocks.selectModel.mockReturnValue({ key: "deepseek-chat" });
});

describe("import routes durable replay", () => {
  it("粘贴导入 done 在权益、限流、进程锁和 LLM 前直接回放", async () => {
    mocks.inspect.mockResolvedValue({ status: "replay", response: replay });
    mocks.requireAccess.mockRejectedValue(new AppError("当前权益已失效", 402, false));
    mocks.assertUserRateLimit.mockImplementation(() => { throw new RateLimitError(1); });
    const response = await importSource(pasteRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: replay });
    expect(mocks.requireAccess).not.toHaveBeenCalled();
    expect(mocks.assertUniqueRequestAdmission).not.toHaveBeenCalled();
    expect(mocks.assertUserRateLimit).not.toHaveBeenCalled();
    expect(mocks.acquireInflight).not.toHaveBeenCalled();
    expect(mocks.selectModel).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.structure).not.toHaveBeenCalled();
  });

  it("文件导入 done 在权益/限流/解析与资产写入前回放", async () => {
    mocks.inspect.mockResolvedValue({ status: "replay", response: { ...replay, directReady: true, faithfulKind: "presentation" } });
    mocks.requireAccess.mockRejectedValue(new AppError("当前权益已失效", 402, false));
    mocks.assertUserRateLimit.mockImplementation(() => { throw new RateLimitError(1); });
    const response = await importFile(fileRequest("file-replay-request-0001", "deck.pptx"));
    expect(response.status).toBe(200);
    expect(mocks.requireAccess).not.toHaveBeenCalled();
    expect(mocks.assertUniqueRequestAdmission).not.toHaveBeenCalled();
    expect(mocks.assertUserRateLimit).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.selectModel).not.toHaveBeenCalled();
    expect(mocks.presentation).not.toHaveBeenCalled();
    expect(mocks.scorm).not.toHaveBeenCalled();
    expect(mocks.structure).not.toHaveBeenCalled();
  });

  it("SCORM done 回放不再解包或写入第二份资产", async () => {
    mocks.inspect.mockResolvedValue({
      status: "replay",
      response: { ...replay, directReady: true, faithfulKind: "scorm" },
    });
    const response = await importFile(fileRequest("scorm-replay-request-001", "package.scorm"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { ...replay, directReady: true, faithfulKind: "scorm" },
    });
    expect(mocks.requireAccess).not.toHaveBeenCalled();
    expect(mocks.assertUniqueRequestAdmission).not.toHaveBeenCalled();
    expect(mocks.assertUserRateLimit).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.scorm).not.toHaveBeenCalled();
    expect(mocks.presentation).not.toHaveBeenCalled();
    expect(mocks.structure).not.toHaveBeenCalled();
  });

  it("running 返回机器可读保留契约，不消耗限流", async () => {
    mocks.inspect.mockResolvedValue({ status: "running" });
    const response = await importSource(pasteRequest("paste-running-request-001"));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      ok: false,
      data: { code: "IMPORT_RUNNING", preserveRequestId: true },
    });
    expect(mocks.requireAccess).not.toHaveBeenCalled();
    expect(mocks.assertUniqueRequestAdmission).not.toHaveBeenCalled();
    expect(mocks.assertUserRateLimit).not.toHaveBeenCalled();
  });

  it("全新文本文件把耐久 operation 传入原子写入内核", async () => {
    const response = await importFile(fileRequest());
    expect(response.status).toBe(200);
    expect(mocks.contentHash).toHaveBeenCalledWith(expect.any(Buffer));
    expect(mocks.payloadHash).toHaveBeenCalledWith(expect.objectContaining({
      scope: "file",
      contentSha256: "sha256:" + "a".repeat(64),
      kind: "text",
    }));
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.assertUniqueRequestAdmission).toHaveBeenCalledWith(
      "user-1", "ai_import", "file-import-request-00001", 15, 86_400_000,
    );
    expect(mocks.structure).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      operation,
      kind: "file_text",
      rawText: expect.stringContaining("导入资料"),
    }));
    expect(mocks.releaseInflight).toHaveBeenCalledWith("course_gen", "user-1");
    expect(mocks.assertUniqueRequestAdmission.mock.invocationCallOrder[0]).toBeLessThan(mocks.start.mock.invocationCallOrder[0]);
    expect(mocks.start.mock.invocationCallOrder[0]).toBeLessThan(mocks.requireAccess.mock.invocationCallOrder[0]);
    expect(mocks.start.mock.invocationCallOrder[0]).toBeLessThan(mocks.selectModel.mock.invocationCallOrder[0]);
    expect(mocks.start.mock.invocationCallOrder[0]).toBeLessThan(mocks.acquireInflight.mock.invocationCallOrder[0]);
    expect(mocks.start.mock.invocationCallOrder[0]).toBeLessThan(mocks.assertUserRateLimit.mock.invocationCallOrder[0]);
    expect(mocks.start.mock.invocationCallOrder[0]).toBeLessThan(mocks.structure.mock.invocationCallOrder[0]);
  });

  const routes = [
    { label: "粘贴", invoke: () => importSource(pasteRequest("paste-cross-instance-request-01")) },
    { label: "文件", invoke: () => importFile(fileRequest("file-cross-instance-request-001")) },
  ] as const;

  describe.each(routes)("$label导入跨实例 late start", ({ invoke }) => {
    it("在当前权益与限流已失效时仍回放其它实例已提交的结果", async () => {
      mocks.start.mockResolvedValue({ status: "replay", response: replay });
      mocks.requireAccess.mockRejectedValue(new AppError("当前权益已失效", 402, false));
      mocks.assertUserRateLimit.mockImplementation(() => { throw new RateLimitError(1); });

      const response = await invoke();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, data: replay });
      expect(mocks.assertUniqueRequestAdmission).toHaveBeenCalledOnce();
      expect(mocks.start).toHaveBeenCalledOnce();
      expect(mocks.requireAccess).not.toHaveBeenCalled();
      expect(mocks.selectModel).not.toHaveBeenCalled();
      expect(mocks.acquireInflight).not.toHaveBeenCalled();
      expect(mocks.assertUserRateLimit).not.toHaveBeenCalled();
      expect(mocks.structure).not.toHaveBeenCalled();
    });

    it("新 requestId 准入超限时不 start、不 reconcile、不进动态门", async () => {
      mocks.assertUniqueRequestAdmission.mockImplementation(() => { throw new RateLimitError(60); });

      const response = await invoke();

      expect(response.status).toBe(429);
      expect(mocks.inspect).toHaveBeenCalledOnce();
      expect(mocks.assertUniqueRequestAdmission).toHaveBeenCalledOnce();
      expect(mocks.start).not.toHaveBeenCalled();
      expect(mocks.reconcile).not.toHaveBeenCalled();
      expect(mocks.requireAccess).not.toHaveBeenCalled();
      expect(mocks.selectModel).not.toHaveBeenCalled();
      expect(mocks.acquireInflight).not.toHaveBeenCalled();
      expect(mocks.assertUserRateLimit).not.toHaveBeenCalled();
      expect(mocks.structure).not.toHaveBeenCalled();
    });

    it.each([
      ["running", true],
      ["failed", false],
    ] as const)("在可变门前返回其它实例的 %s 终态", async (status, preserveRequestId) => {
      mocks.start.mockResolvedValue({ status });
      mocks.requireAccess.mockRejectedValue(new AppError("不应该读取当前权益", 402, false));

      const response = await invoke();
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.ok).toBe(false);
      if (preserveRequestId) {
        expect(body.data).toMatchObject({ code: "IMPORT_RUNNING", preserveRequestId: true });
      } else {
        expect(body.data).toBeUndefined();
      }
      expect(mocks.requireAccess).not.toHaveBeenCalled();
      expect(mocks.selectModel).not.toHaveBeenCalled();
      expect(mocks.acquireInflight).not.toHaveBeenCalled();
      expect(mocks.assertUserRateLimit).not.toHaveBeenCalled();
      expect(mocks.reconcile).not.toHaveBeenCalled();
    });

    it("在可变门前拒绝 requestId 载荷漂移", async () => {
      mocks.start.mockRejectedValue(new AppError("requestId 不能用于不同的导入内容，请重新发起", 409, false));

      const response = await invoke();

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ ok: false, error: expect.stringContaining("requestId") });
      expect(mocks.requireAccess).not.toHaveBeenCalled();
      expect(mocks.selectModel).not.toHaveBeenCalled();
      expect(mocks.acquireInflight).not.toHaveBeenCalled();
      expect(mocks.assertUserRateLimit).not.toHaveBeenCalled();
      expect(mocks.reconcile).not.toHaveBeenCalled();
    });

    it("权益/余额门失败时先 fenced 反向结算再返回原错误", async () => {
      mocks.requireAccess.mockRejectedValue(new AppError("当前权益不足", 402, false));

      const response = await invoke();

      expect(response.status).toBe(402);
      expect(mocks.start).toHaveBeenCalledOnce();
      expect(mocks.reconcile).toHaveBeenCalledWith(operation, "当前权益不足");
      expect(mocks.selectModel).not.toHaveBeenCalled();
      expect(mocks.acquireInflight).not.toHaveBeenCalled();
      expect(mocks.assertUserRateLimit).not.toHaveBeenCalled();
      expect(mocks.structure).not.toHaveBeenCalled();
      expect(mocks.releaseInflight).not.toHaveBeenCalled();
    });

    it("限流门失败时先 fenced 反向结算，且释放已取得的进程锁", async () => {
      mocks.assertUserRateLimit.mockImplementation(() => { throw new RateLimitError(1); });

      const response = await invoke();

      expect(response.status).toBe(429);
      expect(mocks.start).toHaveBeenCalledOnce();
      expect(mocks.reconcile).toHaveBeenCalledWith(operation, "请求过于频繁，请稍后再试");
      expect(mocks.structure).not.toHaveBeenCalled();
      expect(mocks.releaseInflight).toHaveBeenCalledWith("course_gen", "user-1");
      expect(mocks.start.mock.invocationCallOrder[0]).toBeLessThan(mocks.requireAccess.mock.invocationCallOrder[0]);
      expect(mocks.start.mock.invocationCallOrder[0]).toBeLessThan(mocks.selectModel.mock.invocationCallOrder[0]);
      expect(mocks.start.mock.invocationCallOrder[0]).toBeLessThan(mocks.acquireInflight.mock.invocationCallOrder[0]);
      expect(mocks.start.mock.invocationCallOrder[0]).toBeLessThan(mocks.assertUserRateLimit.mock.invocationCallOrder[0]);
    });
  });

  describe("旧客户端不带 requestId 的兜底", () => {
    it("粘贴导入缺 requestId 不再 400：服务端生成合法 ID 走完整流程", async () => {
      const request = new NextRequest("http://localhost/api/ai/import-source", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rawText: "导入资料".repeat(30) }),
      });
      const response = await importSource(request);
      expect(response.status).toBe(200);
      expect(mocks.inspect).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: expect.stringMatching(/^srv-[0-9a-f]{32}$/) }),
      );
    });

    it("文件导入缺 requestId 不再 400：服务端生成合法 ID 走完整流程", async () => {
      const form = new FormData();
      form.append("file", new File(["导入资料".repeat(30)], "notes.txt", { type: "text/plain" }));
      const request = new NextRequest("http://localhost/api/ai/import-file", { method: "POST", body: form });
      const response = await importFile(request);
      expect(response.status).toBe(200);
      expect(mocks.inspect).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: expect.stringMatching(/^srv-[0-9a-f]{32}$/) }),
      );
    });

    it("有值但格式非法仍 400，不兜底", async () => {
      const response = await importSource(pasteRequest("short"));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ ok: false, error: "requestId 格式错误" });
      expect(mocks.inspect).not.toHaveBeenCalled();
      expect(mocks.start).not.toHaveBeenCalled();
    });
  });
});
