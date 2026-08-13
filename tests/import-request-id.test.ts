import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  clearImportRequestId,
  getOrCreateImportRequestId,
  shouldPreserveImportRequestId,
} from "@/lib/import-request-id";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
    clear: vi.fn(() => values.clear()),
    key: vi.fn((index: number) => [...values.keys()][index] ?? null),
    get length() { return values.size; },
  } satisfies Storage;
}

afterEach(() => vi.unstubAllGlobals());

describe("browser import request id", () => {
  it("粘贴与文件 scope 各自稳定，且只清理精确完成的 ID", () => {
    const session = storage();
    let sequence = 0;
    vi.stubGlobal("sessionStorage", session);
    vi.stubGlobal("crypto", { randomUUID: () => `import-browser-request-${++sequence}-0000` });
    const paste = getOrCreateImportRequestId("paste");
    const file = getOrCreateImportRequestId("file");
    expect(file).not.toBe(paste);
    expect(getOrCreateImportRequestId("paste")).toBe(paste);
    expect(getOrCreateImportRequestId("file")).toBe(file);
    clearImportRequestId("file", "stale-import-response-0000");
    expect(getOrCreateImportRequestId("file")).toBe(file);
    clearImportRequestId("paste", paste);
    expect(getOrCreateImportRequestId("paste")).not.toBe(paste);
    expect(getOrCreateImportRequestId("file")).toBe(file);
  });

  it("running/非 JSON/5xx 保留，明确终态 4xx 清理", () => {
    expect(shouldPreserveImportRequestId({ data: { code: "IMPORT_RUNNING", preserveRequestId: true } }, 409)).toBe(true);
    expect(shouldPreserveImportRequestId(null, 504)).toBe(true);
    expect(shouldPreserveImportRequestId({ error: "gateway" }, 502)).toBe(true);
    expect(shouldPreserveImportRequestId({ error: "文件无效" }, 422)).toBe(false);
    expect(shouldPreserveImportRequestId({ error: "余额不足" }, 402)).toBe(false);
  });

  it("创作台两路请求都发送 requestId，并按机器契约管理生命周期", () => {
    const studio = readFileSync("src/components/CreateStudio.tsx", "utf8");
    expect(studio).toContain('getOrCreateImportRequestId("paste")');
    expect(studio).toContain('getOrCreateImportRequestId("file")');
    expect(studio).toContain('fd.append("requestId", requestId)');
    expect(studio).toContain("shouldPreserveImportRequestId(json, res.status)");
    expect(studio).toContain("clearImportRequestId(opts.requestScope, opts.requestId)");
  });
});
