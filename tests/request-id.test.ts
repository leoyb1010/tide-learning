import { describe, expect, it } from "vitest";
import { ensureRequestId, validateRequestId } from "@/lib/request-id";
import { AppError } from "@/lib/errors";

describe("ensureRequestId 旧客户端兜底", () => {
  it("缺失/空串回落为服务端生成的合法 requestId（旧 iOS/Mac 客户端不再 400）", () => {
    for (const value of [undefined, null, "", "   "]) {
      const requestId = ensureRequestId(value);
      expect(requestId).toMatch(/^srv-[0-9a-f]{32}$/);
      // 生成值必须能通过下游 operation 层的严格校验。
      expect(validateRequestId(requestId)).toBe(requestId);
    }
  });

  it("每次兜底生成的 requestId 不同：旧客户端每次请求都是新操作", () => {
    expect(ensureRequestId(undefined)).not.toBe(ensureRequestId(undefined));
  });

  it("有值但格式非法仍 400（客户端 bug，不是旧客户端）", () => {
    for (const value of ["short", "包含中文的键值对不合法", "a".repeat(129), "bad key with spaces!"]) {
      expect(() => ensureRequestId(value)).toThrow(AppError);
      expect(() => ensureRequestId(value)).toThrow("requestId 格式错误");
    }
    expect(() => ensureRequestId(42)).toThrow("缺少 requestId");
  });

  it("合法值原样透传，保持发送 requestId 客户端的完整幂等", () => {
    expect(ensureRequestId("  paste-import-request-0001  ")).toBe("paste-import-request-0001");
  });
});
