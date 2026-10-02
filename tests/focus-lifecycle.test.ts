import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFocusSessionRun } from "@/lib/focus-session-run";

const mock = vi.hoisted(() => ({ find: vi.fn(), create: vi.fn(), claim: vi.fn(), update: vi.fn(), count: vi.fn(), notes: vi.fn(), entitlement: vi.fn(), rate: vi.fn(), chat: vi.fn(), track: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { focusSession: { findFirst: mock.find, create: mock.create, updateMany: mock.claim, update: mock.update }, note: { count: mock.count, findMany: mock.notes } } }));
vi.mock("@/lib/session", () => ({ requireUser: async () => ({ id: "learner" }), AuthError: class extends Error { status = 401; } }));
vi.mock("@/lib/entitlement", () => ({ resolveEntitlement: mock.entitlement }));
vi.mock("@/lib/rate-limit", () => ({ assertUserRateLimit: mock.rate, RateLimitError: class extends Error { status = 429; } }));
vi.mock("@/lib/llm", () => ({ chat: mock.chat }));
vi.mock("@/lib/analytics", () => ({ track: mock.track }));
import { POST, PATCH } from "@/app/api/focus/route";
const started = new Date("2026-10-01T10:00:00Z");
const ended = new Date("2026-10-01T10:25:00Z");
const session = { id: "visit", userId: "learner", startAt: started, endAt: null as Date | null, minutes: 0, summary: null as string | null, goal: "Review", courseId: "course" };
function request(body: unknown, method = "PATCH") { return new NextRequest("http://localhost:3100/api/focus", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
beforeEach(() => {
  vi.resetAllMocks(); vi.useRealTimers();
  mock.find.mockResolvedValue({ ...session }); mock.claim.mockResolvedValue({ count: 1 });
  mock.update.mockImplementation(async ({ data }) => ({ ...session, ...data, minutes: 25 }));
  mock.count.mockResolvedValue(2); mock.notes.mockResolvedValue([]);
  mock.entitlement.mockResolvedValue({ canUseLLM: true }); mock.chat.mockResolvedValue("Done");
  mock.create.mockResolvedValue({ id: "new", startAt: started });
});

describe("focus route completion truth", () => {
  it.each([null, [], 42, { goal: {} }, { lessonId: 5 }, { courseId: [] }])("rejects malformed start without persistence: %j", async body => {
    expect((await POST(request(body, "POST"))).status).toBe(400); expect(mock.create).not.toHaveBeenCalled();
  });
  it.each([null, [], { sessionId: {} }, { sessionId: "visit", aiSummary: "false" }])("rejects malformed finish without persistence: %j", async body => {
    expect((await PATCH(request(body))).status).toBe(400); expect(mock.claim).not.toHaveBeenCalled();
  });
  it("replays completed truth, without reopening, overwriting or another AI call", async () => {
    mock.find.mockResolvedValue({ ...session, endAt: ended, minutes: 25, summary: "Saved" });
    const res = await PATCH(request({ sessionId: "visit", aiSummary: true }));
    expect(res.status).toBe(200); expect((await res.json()).data).toMatchObject({ minutes: 25, summary: "Saved", noteCount: 2 });
    expect(mock.claim).not.toHaveBeenCalled(); expect(mock.chat).not.toHaveBeenCalled(); expect(mock.update).not.toHaveBeenCalled();
    expect(mock.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "learner", createdAt: { gte: started, lte: ended } }) }));
  });
  it("claims completion before optional AI; entitlement outage still returns completed statistics", async () => {
    mock.entitlement.mockRejectedValue(new Error("Unavailable"));
    const res = await PATCH(request({ sessionId: "visit", aiSummary: true }));
    expect(res.status).toBe(200); expect(mock.claim).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "visit", userId: "learner", endAt: null } }));
    expect(mock.claim.mock.invocationCallOrder[0]).toBeLessThan(mock.entitlement.mock.invocationCallOrder[0]);
    expect(mock.update).toHaveBeenCalledWith(expect.objectContaining({ data: { summary: null } }));
  });
  it("concurrent loser returns the winning visit and never calls AI", async () => {
    mock.claim.mockResolvedValue({ count: 0 });
    mock.find.mockResolvedValueOnce({ ...session }).mockResolvedValueOnce({ ...session, endAt: ended, minutes: 25, summary: "First" });
    const res = await PATCH(request({ sessionId: "visit", aiSummary: true }));
    expect((await res.json()).data).toMatchObject({ minutes: 25, summary: "First" });
    expect(mock.chat).not.toHaveBeenCalled(); expect(mock.update).not.toHaveBeenCalled();
    expect(mock.count).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ createdAt: { gte: started, lte: ended } }) }));
  });
  it("does not manufacture completion after a failed storage claim", async () => {
    mock.claim.mockRejectedValue(new Error("Storage unavailable"));
    expect((await PATCH(request({ sessionId: "visit" }))).status).toBe(500);
    expect(mock.chat).not.toHaveBeenCalled(); expect(mock.update).not.toHaveBeenCalled();
  });
  it("keeps another user's visit inaccessible", async () => {
    mock.find.mockResolvedValue(null);
    expect((await PATCH(request({ sessionId: "other" }))).status).toBe(404);
    expect(mock.find).toHaveBeenCalledWith({ where: { id: "other", userId: "learner" } }); expect(mock.claim).not.toHaveBeenCalled();
  });
});

describe("focus client visit ownership", () => {
  it("leaving before creation resolves finishes that exact visit once", async () => {
    let resolve!: (id: string) => void;
    const start = vi.fn(() => new Promise<string>(r => { resolve = r; }));
    const finish = vi.fn().mockResolvedValue({ minutes: 1, noteCount: 0, summary: null });
    const run = createFocusSessionRun(start, finish);
    const end = run.end(false); expect(run.ending).toBe(true);
    expect(run.end(true)).toBe(end);
    await Promise.resolve(); resolve("slow-visit"); await end;
    expect(start).toHaveBeenCalledTimes(1); expect(finish).toHaveBeenCalledExactlyOnceWith("slow-visit", false);
  });
  it("independent runs retain their own start and end even when replies arrive out of order", async () => {
    let resolveOld!: (id: string) => void;
    const finish = vi.fn().mockResolvedValue(null);
    const old = createFocusSessionRun(() => new Promise<string>(r => { resolveOld = r; }), finish);
    const oldEnd = old.end(); const next = createFocusSessionRun(async () => "new-visit", finish);
    await next.started; expect(next.ending).toBe(false);
    resolveOld("old-visit"); await oldEnd;
    expect(next.ending).toBe(false); expect(finish).toHaveBeenCalledExactlyOnceWith("old-visit", false);
    await next.end(); expect(finish).toHaveBeenLastCalledWith("new-visit", false);
  });
  it("failed start degrades to local focus without an invalid PATCH", async () => {
    const finish = vi.fn(); const run = createFocusSessionRun(async () => { throw new Error("offline"); }, finish);
    expect(await run.end()).toBeNull(); expect(finish).not.toHaveBeenCalled();
  });
});
