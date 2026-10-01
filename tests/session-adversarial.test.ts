import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const mocks = vi.hoisted(() => ({
  bearer: "", cookie: "", rows: new Map<string, unknown>(),
  get: vi.fn(), remove: vi.fn(), cookiesDelete: vi.fn(), permissions: vi.fn(),
}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(mocks.bearer ? { authorization: mocks.bearer } : {}),
  cookies: async () => ({ get: () => mocks.cookie ? { value: mocks.cookie } : undefined, delete: mocks.cookiesDelete }),
}));
vi.mock("@/lib/db", () => ({ prisma: { session: { findUnique: mocks.get, deleteMany: mocks.remove }, rolePermission: { findMany: mocks.permissions } } }));
const token = "a".repeat(64);
const digest = createHash("sha256").update(token).digest("hex");
const user = { id: "synthetic-user", role: "reviewer", deletedAt: null };
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); mocks.bearer = ""; mocks.cookie = ""; mocks.rows.clear();
  mocks.rows.set(digest, { id: digest, user, expiresAt: new Date(Date.now() + 60_000) });
  mocks.get.mockImplementation(async ({ where }: { where: { id: string } }) => mocks.rows.get(where.id) ?? null);
  mocks.remove.mockResolvedValue({ count: 1 }); mocks.permissions.mockResolvedValue([]);
});
describe("session credential boundaries", () => {
  it("accepts the original bearer token", async () => {
    mocks.bearer = `Bearer ${token}`;
    expect(await (await import("@/lib/session")).getCurrentUser()).toEqual(user);
  });
  it("never accepts the stored digest as a bearer credential", async () => {
    mocks.bearer = `Bearer ${digest}`;
    expect(await (await import("@/lib/session")).getCurrentUser()).toBeNull();
  });
  it("revokes native bearer sessions on logout", async () => {
    mocks.bearer = `Bearer ${token}`;
    await (await import("@/lib/session")).destroySession();
    expect(mocks.remove).toHaveBeenCalledWith({ where: { id: digest } });
  });
  it("does not fall back to cookie identity for malformed bearer credentials", async () => {
    mocks.bearer = "Bearer "; mocks.cookie = token;
    expect(await (await import("@/lib/session")).getCurrentUser()).toBeNull();
  });
  it("fails closed when permission overrides cannot be loaded", async () => {
    mocks.permissions.mockRejectedValue(new Error("synthetic database outage"));
    await expect((await import("@/lib/session")).primePermissionCache(true)).rejects.toMatchObject({ status: 503 });
  });
});
