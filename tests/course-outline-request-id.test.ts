import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  clearCourseOutlineRequestId,
  getOrCreateCourseOutlineRequestId,
  shouldPreserveCourseOutlineRequestId,
} from "@/lib/course-outline-request-id";

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

describe("browser course outline request id", () => {
  it("survives remounts and only clears the exact completed request", () => {
    const session = storage();
    let sequence = 0;
    vi.stubGlobal("sessionStorage", session);
    vi.stubGlobal("crypto", { randomUUID: () => `course-outline-browser-${++sequence}-0000` });

    const first = getOrCreateCourseOutlineRequestId();
    expect(getOrCreateCourseOutlineRequestId()).toBe(first);

    clearCourseOutlineRequestId("course-outline-stale-response-0000");
    expect(getOrCreateCourseOutlineRequestId()).toBe(first);

    clearCourseOutlineRequestId(first);
    expect(getOrCreateCourseOutlineRequestId()).not.toBe(first);
  });

  it("创作台在正常造课请求中发送稳定 requestId，不再让 UI 直接 400", () => {
    const studio = readFileSync("src/components/CreateStudio.tsx", "utf8");
    expect(studio).toContain("getOrCreateCourseOutlineRequestId()");
    expect(studio).toContain("requestId,");
    expect(studio).toContain("clearCourseOutlineRequestId(requestId)");
  });

  it("结构化 running 与不确定的代理失败保留 requestId，明确终态 4xx 才清理", () => {
    expect(shouldPreserveCourseOutlineRequestId({
      error: "任意文案",
      data: { code: "COURSE_OUTLINE_RUNNING", preserveRequestId: true },
    }, 409)).toBe(true);
    expect(shouldPreserveCourseOutlineRequestId(null, 504)).toBe(true);
    expect(shouldPreserveCourseOutlineRequestId(null, 503)).toBe(true);
    expect(shouldPreserveCourseOutlineRequestId({ error: "网关返回了非标准错误" }, 502)).toBe(true);
    expect(shouldPreserveCourseOutlineRequestId({ error: "来源材料不足" }, 422)).toBe(false);
    expect(shouldPreserveCourseOutlineRequestId({ error: "余额不足" }, 402)).toBe(false);
    expect(shouldPreserveCourseOutlineRequestId({
      data: { code: "COURSE_OUTLINE_RUNNING", preserveRequestId: false },
    }, 409)).toBe(false);
  });

  it("路由按 inspect → 唯一 ID 准入 → atomic start → 动态门排序", () => {
    const route = readFileSync("src/app/api/ai/generate-course/route.ts", "utf8");
    const inspectIndex = route.indexOf("inspectCourseOutlineOperation({ userId: authenticatedUser.id, requestId, payloadHash })");
    expect(inspectIndex).toBeGreaterThanOrEqual(0);
    const admissionIndex = route.indexOf('assertUniqueRequestAdmission(authenticatedUser.id, "ai_gen_course", requestId, 30, 86_400_000)');
    expect(admissionIndex).toBeGreaterThanOrEqual(0);
    const inflightIndex = route.indexOf('acquireInflight("course_gen", authenticatedUser.id)');
    expect(inflightIndex).toBeGreaterThanOrEqual(0);
    const startIndex = route.indexOf("startCourseOutlineOperation({ userId: authenticatedUser.id, requestId, payloadHash })");
    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(inspectIndex).toBeLessThan(admissionIndex);
    expect(admissionIndex).toBeLessThan(startIndex);
    expect(startIndex).toBeLessThan(inflightIndex);
    expect(startIndex).toBeLessThan(route.indexOf("requireCourseGenAccess({ precheckSpend: false })"));
    expect(startIndex).toBeLessThan(route.indexOf('assertUserRateLimit(user.id, "ai_gen_course"'));
    expect(route).toContain('code: "COURSE_OUTLINE_RUNNING"');
    expect(route).toContain("preserveRequestId: true");
    const studio = readFileSync("src/components/CreateStudio.tsx", "utf8");
    expect(studio).toContain("shouldPreserveCourseOutlineRequestId(json, res.status)");
    expect(studio).not.toContain('errorMessage.includes("仍在进行")');
  });
});
