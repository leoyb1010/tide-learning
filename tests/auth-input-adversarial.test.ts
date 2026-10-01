import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const db = vi.hoisted(() => ({ user: { findFirst: vi.fn() }, passwordReset: { create: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/rate-limit", () => ({ assertRateLimit: vi.fn(), RateLimitError: class extends Error {} }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/credits", () => ({ ensureAccount: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
import { CONSENT_VERSION } from "@/lib/consent";
function request(body: unknown) { return new NextRequest("http://localhost:3100/api/auth/signup", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }); }
beforeEach(() => { vi.clearAllMocks(); db.user.findFirst.mockResolvedValue(null); });
afterEach(() => vi.unstubAllEnvs());
describe("authentication input and delivery truth", () => {
  it.each([null, [], 42])("signup returns a client error for %j", async body => {
    const { POST } = await import("@/app/api/auth/signup/route");
    expect((await POST(request(body))).status).toBe(400);
  });
  it("rejects a non-string nickname before account creation", async () => {
    const { POST } = await import("@/app/api/auth/signup/route");
    const response = await POST(request({ identifier: "synthetic@example.test", password: "Synthetic-test-123", nickname: {}, termsAccepted: true, privacyAccepted: true, consentVersion: CONSENT_VERSION }));
    expect(response.status).toBe(400);
  });
  it("never claims production recovery email was sent without a delivery adapter", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { POST } = await import("@/app/api/auth/password-reset/route");
    expect((await POST(request({ email: "synthetic@example.test" }))).status).toBe(503);
    expect(db.passwordReset.create).not.toHaveBeenCalled();
    expect(db.user.findFirst).not.toHaveBeenCalled();
  });
});
