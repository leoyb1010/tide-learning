import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
const holder = vi.hoisted(() => ({ client: null as unknown, fail: false }));
vi.mock("@/lib/db", () => ({ get prisma() { return holder.client; } }));
vi.mock("@/lib/rate-limit", () => ({ assertRateLimit: vi.fn(), assertUserRateLimit: vi.fn(), RateLimitError: class extends Error {} }));
vi.mock("@/lib/entitlement", () => ({ resolveEntitlement: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/apple-iap", () => ({ isAppleConfigured: () => false, appleEnvironment: () => "Sandbox", verifySignedJws: vi.fn(), verifyAppleTransaction: async (input: { transactionId: string }) => ({ ok: true, payload: { transactionId: input.transactionId } }) }));
vi.mock("@/lib/credits", () => ({ ensureAccount: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/session", async (original) => ({ ...await original<typeof import("@/lib/session")>(), requireUser: async () => ({ id: "iap-audit-user" }) }));
vi.mock("@/lib/payment", () => ({ addMonthsClamped: vi.fn(), rollbackOnePeriod: (_period: string, date: Date) => new Date(date.getTime() - 30 * 864e5) }));
let root: string;
let client: PrismaClient;
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "tide-iap-test-")); const db = `file:${join(root, "test.db")}`;
  execFileSync("bash", ["scripts/migrate-deploy.sh"], { env: { ...process.env, DATABASE_URL: db }, stdio: "pipe" });
  client = new PrismaClient({ datasources: { db: { url: `${db}?connection_limit=1` } } });
  holder.client = new Proxy(client, { get(target, key) {
    if (key === "$transaction") return (...args: unknown[]) => { if (holder.fail) throw new Error("synthetic transient transaction failure"); return Reflect.apply(target.$transaction, target, args); };
    const result = Reflect.get(target, key); return typeof result === "function" ? result.bind(target) : result;
  } });
  await client.user.create({ data: { id: "iap-audit-user", nickname: "Synthetic IAP user" } });
  await client.plan.create({ data: { id: "iap-audit-plan", name: "Synthetic plan", scope: "all", billingPeriod: "month", priceCents: 100, currency: "CNY" } });
}, 30_000);
afterAll(async () => { await client?.$disconnect(); if (root) rmSync(root, { recursive: true, force: true }); });
beforeEach(async () => {
  holder.fail = false;
  await client.paymentWebhookLog.deleteMany(); await client.order.deleteMany(); await client.subscription.deleteMany(); await client.creditLedger.deleteMany();
  await client.creditAccount.upsert({ where: { userId: "iap-audit-user" }, create: { userId: "iap-audit-user", balance: 120 }, update: { balance: 120 } });
  await client.subscription.create({ data: { id: "iap-audit-sub", userId: "iap-audit-user", planId: "iap-audit-plan", channel: "apple_iap", scope: "all", status: "active", priceSnapshotCents: 100, currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 120 * 864e5) } });
  await client.order.create({ data: { id: "iap-audit-order", userId: "iap-audit-user", planId: "iap-audit-plan", channel: "apple_iap", amountCents: 100, currency: "CNY", status: "paid", subscriptionId: "iap-audit-sub", externalOrderId: "iap_tx-refund" } });
});
function request(uuid: string, txId = "tx-refund", original = "tx-original") { return new NextRequest("http://localhost:3100/api/iap/notifications", { method: "POST", body: JSON.stringify({ signedPayload: JSON.stringify({ notificationType: "REFUND", notificationUUID: uuid, data: { transactionId: txId, originalTransactionId: original } }) }), headers: { "content-type": "application/json" } }); }
describe("Apple refund delivery integrity", () => {
  it("does not refund an original order when the specific refunded renewal has not arrived", async () => {
    const { POST } = await import("@/app/api/iap/notifications/route");
    await POST(request("unknown-renewal", "tx-missing", "tx-refund"));
    expect((await client.order.findUniqueOrThrow({ where: { id: "iap-audit-order" } })).status).toBe("paid");
  });
  it("remembers refund-before-purchase and rejects a stale purchase claim", async () => {
    const { POST } = await import("@/app/api/iap/notifications/route");
    await POST(request("early-refund", "tx-not-granted", "tx-not-granted"));
    const { POST: verify } = await import("@/app/api/iap/verify/route");
    const response = await verify(new NextRequest("http://localhost:3100/api/iap/verify", { method: "POST", body: JSON.stringify({ productId: "credits_60", transactionId: "tx-not-granted" }), headers: { "content-type": "application/json" } }));
    expect(response.status).toBe(409);
    expect((await client.creditAccount.findUniqueOrThrow({ where: { userId: "iap-audit-user" } })).balance).toBe(120);
  });

  it("retries after a transient transaction failure", async () => {
    const { POST } = await import("@/app/api/iap/notifications/route"); holder.fail = true;
    expect((await POST(request("retry-event"))).status).toBe(500); holder.fail = false;
    expect((await POST(request("retry-event"))).status).toBe(200);
    expect((await client.order.findUniqueOrThrow({ where: { id: "iap-audit-order" } })).status).toBe("refunded");
  });
  it("does not refund the same transaction twice under different notification IDs", async () => {
    const { POST } = await import("@/app/api/iap/notifications/route");
    await POST(request("event-one")); const first = await client.subscription.findUniqueOrThrow({ where: { id: "iap-audit-sub" } });
    await POST(request("event-two")); const second = await client.subscription.findUniqueOrThrow({ where: { id: "iap-audit-sub" } });
    expect(second.currentPeriodEnd).toEqual(first.currentPeriodEnd);
  });
  it("does not claw back an unrelated original transaction's credits", async () => {
    const { POST } = await import("@/app/api/iap/notifications/route");
    for (const refId of ["tx-refund", "tx-original"]) await client.creditLedger.create({ data: { userId: "iap-audit-user", type: "recharge", refId, delta: 60, balanceAfter: 120, reason: "synthetic fixture" } });
    await POST(request("credit-event"));
    expect((await client.creditAccount.findUniqueOrThrow({ where: { userId: "iap-audit-user" } })).balance).toBe(60);
  });
});
