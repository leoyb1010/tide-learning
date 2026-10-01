import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const db = vi.hoisted(() => ({ user: { findUnique: vi.fn(), update: vi.fn() }, session: { deleteMany: vi.fn() }, passwordReset: { updateMany: vi.fn() }, $transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/session", () => ({ AuthError: class extends Error {}, requireAdminRole: async () => ({ id: "synthetic-admin" }), hashPassword: () => "synthetic-hash", validatePasswordStrength: () => null, ALL_ROLES: ["admin", "reviewer"] }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn().mockResolvedValue(undefined) }));
import { PATCH } from "@/app/api/admin/users/[id]/route";
beforeEach(() => { vi.clearAllMocks(); db.user.findUnique.mockResolvedValue({ id: "synthetic-target", nickname: "Synthetic target", role: "user" }); db.$transaction.mockImplementation(async (operations: unknown[]) => Promise.all(operations)); });
describe("admin credential lifecycle", () => {
  it.each(["reset-password", "disable"])("%s also invalidates outstanding recovery links", async action => {
    const response = await PATCH(new NextRequest("http://localhost:3100/api/admin/users/synthetic-target", { method: "PATCH", body: JSON.stringify({ action, password: "Synthetic-only-123" }), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ id: "synthetic-target" }) });
    expect(response.status).toBe(200);
    expect(db.passwordReset.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "synthetic-target", usedAt: null } }));
  });
  it("rejects a null body as a client error", async () => {
    const response = await PATCH(new NextRequest("http://localhost:3100/api/admin/users/synthetic-target", { method: "PATCH", body: "null", headers: { "content-type": "application/json" } }), { params: Promise.resolve({ id: "synthetic-target" }) });
    expect(response.status).toBe(400);
  });
});
