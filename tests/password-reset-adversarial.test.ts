import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/db", () => ({ get prisma() { return holder.client; } }));
vi.mock("@/lib/rate-limit", () => ({ assertRateLimit: vi.fn(), RateLimitError: class extends Error {} }));
let root: string;
let client: PrismaClient;
const token = "b".repeat(64);
const tokenHash = createHash("sha256").update(token).digest("hex");
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "tide-reset-test-")); const db = `file:${join(root, "test.db")}`;
  execFileSync("bash", ["scripts/migrate-deploy.sh"], { env: { ...process.env, DATABASE_URL: db }, stdio: "pipe" });
  client = new PrismaClient({ datasources: { db: { url: `${db}?connection_limit=1` } } }); holder.client = client;
  await client.user.create({ data: { id: "reset-audit-user", nickname: "Synthetic reset user", passwordHash: "before" } });
}, 30_000);
afterAll(async () => { await client?.$disconnect(); if (root) rmSync(root, { recursive: true, force: true }); });
beforeEach(async () => {
  await client.passwordReset.deleteMany(); await client.session.deleteMany();
  await client.passwordReset.create({ data: { userId: "reset-audit-user", tokenHash, expiresAt: new Date(Date.now() + 60_000) } });
  await client.session.create({ data: { id: "old-synthetic-session", userId: "reset-audit-user", expiresAt: new Date(Date.now() + 60_000) } });
});
function request(body: unknown) { return new NextRequest("http://localhost:3100/api/auth/password-reset/confirm", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }); }
describe("single-use password reset", () => {
  it("allows exactly one concurrent claimant and revokes sessions", async () => {
    const { POST } = await import("@/app/api/auth/password-reset/confirm/route");
    const responses = await Promise.all([POST(request({ token, password: "Synthetic-one-123" })), POST(request({ token, password: "Synthetic-two-123" }))]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 400]);
    expect(await client.session.count()).toBe(0);
  });
  it.each([null, { token: {}, password: "Synthetic-password-123" }, { token, password: 12345678 }])("rejects malformed bodies without a server error: %j", async body => {
    const { POST } = await import("@/app/api/auth/password-reset/confirm/route");
    expect((await POST(request(body))).status).toBe(400);
  });
});
