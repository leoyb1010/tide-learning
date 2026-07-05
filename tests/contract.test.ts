import { describe, it, expect, beforeAll } from "vitest";

/**
 * 契约形状测试（流3-U6 · 契约防断裂制度 —— vitest 版）
 * ---------------------------------------------------------------------------
 * 目的：把 5 个高危 DTO 的「非 Optional 字段」形状锁进 npm test，
 *       后端一旦悄悄删字段/改类型，CI 立刻红，而不是等 iOS 解码崩才发现。
 *
 * 与 scripts/contract-smoke.sh 互补：脚本覆盖面更广（~19 端点）、给运维手跑；
 * 本文件只挑 5 个最致命的 DTO，纳入单测流水线。
 *
 * 依赖真实运行的生产服务器（http://localhost:3100）。
 * 若服务器未起（如纯 CI 单测环境），beforeAll 探活失败 → 整组 skip，绝不误红。
 * 需要真跑时：确保 3100 在跑，再 `npm test`。
 */

const BASE = process.env.CONTRACT_BASE ?? "http://localhost:3100";
const CT = { "Content-Type": "application/json" };

let SERVER_UP = false;
let TOKEN = "";

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: CT,
    body: JSON.stringify({ identifier: "demo@tide.learning", password: "demo123" }),
  });
  const json = await res.json();
  return json?.data?.sessionToken ?? "";
}

async function getData(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.ok).toBe(true);
  return json.data;
}

/** 断言字段存在且类型正确（非 null）。 */
function expectField(obj: any, key: string, type: "string" | "number" | "boolean" | "array" | "object") {
  expect(obj, `对象缺失 ${key}`).toBeTruthy();
  const v = obj[key];
  expect(v, `字段 ${key} 缺失或为 null`).not.toBeUndefined();
  expect(v, `字段 ${key} 为 null（非 Optional）`).not.toBeNull();
  if (type === "array") expect(Array.isArray(v), `字段 ${key} 应为数组`).toBe(true);
  else if (type === "object") expect(typeof v === "object" && !Array.isArray(v), `字段 ${key} 应为对象`).toBe(true);
  else expect(typeof v, `字段 ${key} 类型应为 ${type}`).toBe(type);
}

function expectIsoDate(obj: any, key: string) {
  expect(obj?.[key], `缺失日期字段 ${key}`).toBeTruthy();
  const t = Date.parse(obj[key]);
  expect(Number.isNaN(t), `日期 ${key} 无法解析：${obj?.[key]}`).toBe(false);
}

beforeAll(async () => {
  try {
    const ping = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: CT,
      body: JSON.stringify({ identifier: "demo@tide.learning", password: "demo123" }),
    });
    SERVER_UP = ping.ok;
    if (SERVER_UP) {
      const j = await ping.json();
      TOKEN = j?.data?.sessionToken ?? "";
      SERVER_UP = !!TOKEN;
    }
  } catch {
    SERVER_UP = false;
  }
  if (!SERVER_UP) {
    // eslint-disable-next-line no-console
    console.warn(`[contract] 生产服务器不可达（${BASE}），契约测试整组跳过。`);
  }
});

describe("契约 · 高危 DTO 形状", () => {
  it("DeskData: litToday/streak/recentNotes/myCourseCount/dueReviewCount", async ({ skip }) => {
    if (!SERVER_UP) return skip();
    const d = await getData("/api/desk");
    expectField(d, "litToday", "boolean");
    expectField(d, "streak", "number");
    expectField(d, "recentNotes", "array");
    expectField(d, "myCourseCount", "number");
    expectField(d, "dueReviewCount", "number");
  });

  it("MarketStall: items[].{id,title,collectCount,learnersCount,isPaid,salesCount,collectedByMe,mine,seller}", async ({ skip }) => {
    if (!SERVER_UP) return skip();
    const d = await getData("/api/market");
    expectField(d, "items", "array");
    if (d.items.length === 0) return; // 空货架时跳过元素级断言
    const it0 = d.items[0];
    expectField(it0, "id", "string");
    expectField(it0, "title", "string");
    expectField(it0, "collectCount", "number");
    expectField(it0, "learnersCount", "number");
    // priceCredits 允许 null（付费才有值），仅当非 null 时校验为 number
    expect(it0).toHaveProperty("priceCredits");
    if (it0.priceCredits !== null) expect(typeof it0.priceCredits).toBe("number");
    expectField(it0, "isPaid", "boolean");
    expectField(it0, "salesCount", "number");
    expectField(it0, "collectedByMe", "boolean");
    expectField(it0, "mine", "boolean");
    expectField(it0, "seller", "object");
    expectField(it0.seller, "id", "string");
    expectField(it0.seller, "nickname", "string");
  });

  it("ShelfCourse: shelf.<bucket>[].{id,slug,title,category,categoryLabel,lessonsCount,origin,progress,coverSrc}", async ({ skip }) => {
    if (!SERVER_UP) return skip();
    const d = await getData("/api/shelf");
    expectField(d, "shelf", "object");
    // 取任一非空桶做元素级断言
    const buckets: any[] = Object.values(d.shelf).filter((v) => Array.isArray(v) && v.length > 0) as any[];
    if (buckets.length === 0) return; // 书架全空，跳过
    const c0 = buckets[0][0];
    expectField(c0, "id", "string");
    expectField(c0, "slug", "string");
    expectField(c0, "title", "string");
    expectField(c0, "category", "string");
    expectField(c0, "categoryLabel", "string");
    expectField(c0, "lessonsCount", "number");
    expectField(c0, "origin", "string");
    expectField(c0, "progress", "number");
    expectField(c0, "coverSrc", "string");
  });

  it("LessonAggregate: access + course{id,title} + lesson{id,title,contentType,durationSec,isFree} + outline[]", async ({ skip }) => {
    if (!SERVER_UP) return skip();
    // 动态取一个 lessonId：从课程详情首讲
    const courses = await getData("/api/courses");
    const courseId = courses?.courses?.[0]?.id;
    expect(courseId, "无可用 courseId").toBeTruthy();
    const detail = await getData(`/api/courses/${courseId}`);
    const lessonId = detail?.course?.lessons?.[0]?.id;
    expect(lessonId, "无可用 lessonId").toBeTruthy();

    const d = await getData(`/api/lessons/${lessonId}`);
    expectField(d, "access", "boolean");
    expectField(d, "course", "object");
    expectField(d.course, "id", "string");
    expectField(d.course, "title", "string");
    expectField(d, "lesson", "object");
    expectField(d.lesson, "id", "string");
    expectField(d.lesson, "title", "string");
    expectField(d.lesson, "contentType", "string");
    expectField(d.lesson, "durationSec", "number");
    expectField(d.lesson, "isFree", "boolean");
    expectField(d, "outline", "array");
    if (d.outline.length > 0) {
      const o0 = d.outline[0];
      expectField(o0, "id", "string");
      expectField(o0, "title", "string");
      expectField(o0, "isFree", "boolean");
      expectField(o0, "durationSec", "number");
    }
  });

  it("Note: GET 列表元素含 id/createdAt/updatedAt/source/kind/pinned/tags[]", async ({ skip }) => {
    if (!SERVER_UP) return skip();
    const d = await getData("/api/notes");
    expectField(d, "notes", "array");
    if (d.notes.length === 0) return;
    const n0 = d.notes[0];
    expectField(n0, "id", "string");
    expectField(n0, "source", "string");
    expectField(n0, "kind", "string");
    expectField(n0, "pinned", "boolean");
    expectField(n0, "tags", "array");
    expectIsoDate(n0, "createdAt");
    expectIsoDate(n0, "updatedAt");
  });

  it("Note: POST 响应必须含 tags（非 Optional），随后 DELETE 清理", async ({ skip }) => {
    if (!SERVER_UP) return skip();
    const res = await fetch(`${BASE}/api/notes`, {
      method: "POST",
      headers: { ...CT, Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ contentMd: "__contract_test_probe__", source: "manual", kind: "text" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    const note = json.data;
    expectField(note, "id", "string");
    expectField(note, "source", "string");
    expectField(note, "kind", "string");
    expectField(note, "pinned", "boolean");
    expect(note, "POST /api/notes 响应缺失 tags（回归！iOS Note.tags 非 Optional）").toHaveProperty("tags");
    expect(Array.isArray(note.tags)).toBe(true);

    // 清理，避免留脏数据
    const del = await fetch(`${BASE}/api/notes/${note.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(del.status).toBe(200);
  });
});
