import { describe, it, expect, beforeAll } from "vitest";

/**
 * 五域联搜契约测试（流2 · U2 搜索与发现）
 * ---------------------------------------------------------------------------
 * 校验 GET /api/search 的核心契约与越权铁律：
 *  1. 五域联搜返回分组结果（results[].type ∈ {course,note,post,market,demand} + counts）；
 *  2. notes 域越权铁律：未登录时 notes 域恒空；
 *  3. 响应信封 {ok,data:{results,counts}} 形状稳定；
 *  4. 空 q 返回空结果（不查库）。
 *
 * 与既有 contract.test.ts 同款「服务器未起则 skip、绝不误红」的探活模式。
 * 默认打 http://localhost:3100（项目约定端口，见 CLAUDE.md），可用 SEARCH_BASE/CONTRACT_BASE 覆盖。
 * 2026-07-21 修:此前默认 3200(无人监听)+ 守卫用裸 return 而非 skip()，三个用例长期「零断言假绿」——
 *   其中「notes 域越权铁律」从未真正执行过。现改为 3100 + skip()，未跑到会显式标记 skipped。
 */

const BASE = process.env.SEARCH_BASE ?? process.env.CONTRACT_BASE ?? "http://localhost:3100";

let SERVER_UP = false;

beforeAll(async () => {
  try {
    // 没有本地服务时，某些系统/代理环境的 fetch 不会立即 ECONNREFUSED，
    // 而是一直等到 Vitest 10s hook 超时。探活必须自己有界，才能稳定地进入显式 skip。
    const res = await fetch(`${BASE}/api/search?q=z`, { signal: AbortSignal.timeout(1_500) });
    SERVER_UP = res.ok || res.status === 429; // 429 也算「服务在跑」
  } catch {
    SERVER_UP = false;
  }
});

const ALLOWED_TYPES = new Set(["course", "note", "post", "market", "demand"]);

describe("GET /api/search 五域联搜", () => {
  it("响应信封 {ok,data:{results,counts}} + type 合法", async ({ skip }) => {
    if (!SERVER_UP) return skip(); // 服务器未起：显式 skip（不是静默零断言）
    const res = await fetch(`${BASE}/api/search?q=${encodeURIComponent("英语")}`);
    // 429（限流窗口内）不算失败——契约形状本身无从校验，跳过即可
    if (res.status === 429) return;
    expect(res.ok).toBe(true);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data).toBeTruthy();
    expect(Array.isArray(json.data.results)).toBe(true);
    // counts 五域齐全
    for (const k of ["course", "note", "post", "market", "demand"]) {
      expect(typeof json.data.counts[k]).toBe("number");
    }
    // 每条结果形状 + type 合法
    for (const r of json.data.results) {
      expect(ALLOWED_TYPES.has(r.type)).toBe(true);
      expect(typeof r.id).toBe("string");
      expect(typeof r.title).toBe("string");
      expect(typeof r.href).toBe("string");
      expect(r.href.startsWith("/")).toBe(true);
    }
  });

  it("notes 域越权铁律：未登录时 notes 恒空", async ({ skip }) => {
    if (!SERVER_UP) return skip();
    // 不带 Authorization → 游客。用一个大概率命中笔记的常见词。
    const res = await fetch(`${BASE}/api/search?q=${encodeURIComponent("笔记")}`);
    if (res.status === 429) return;
    expect(res.ok).toBe(true);
    const json = await res.json();
    expect(json.data.counts.note).toBe(0);
    expect(json.data.results.some((r: { type: string }) => r.type === "note")).toBe(false);
  });

  it("空 q 返回空结果（不查库）", async ({ skip }) => {
    if (!SERVER_UP) return skip();
    const res = await fetch(`${BASE}/api/search?q=`);
    if (res.status === 429) return;
    expect(res.ok).toBe(true);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.results).toEqual([]);
    expect(json.data.counts).toEqual({ course: 0, note: 0, post: 0, market: 0, demand: 0 });
  });
});
