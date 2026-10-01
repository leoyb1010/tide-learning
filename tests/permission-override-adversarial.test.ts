import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ rows: new Set<string>() }));
const permission = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn(), createMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ authorization: `Bearer ${"a".repeat(64)}` }), cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/db", () => ({ prisma: {
  session: { findUnique: async () => ({ user: { id: "synthetic-admin", role: "admin", deletedAt: null }, expiresAt: new Date(Date.now() + 60_000) }) },
  rolePermission: permission,
  $transaction: async (fn: (tx: unknown) => unknown) => fn({ rolePermission: permission }),
} }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn().mockResolvedValue(undefined) }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); state.rows.clear();
  permission.findMany.mockImplementation(async () => [...state.rows].map(p => ({ role: "reviewer", permission: p })));
  permission.count.mockImplementation(async () => state.rows.size);
  permission.createMany.mockImplementation(async ({ data }: { data: Array<{ permission: string }> }) => { data.forEach(x => state.rows.add(x.permission)); return { count: data.length }; });
  permission.upsert.mockImplementation(async ({ create }: { create: { permission: string } }) => { state.rows.add(create.permission); return create; });
  permission.deleteMany.mockImplementation(async ({ where }: { where: { permission?: string } }) => { if (where.permission) state.rows.delete(where.permission); else state.rows.clear(); return { count: 1 }; });
});
describe("permission override persistence", () => {
  it.each([null, [], 1])("rejects a non-object permission body: %j", async body => {
    const { POST } = await import("@/app/api/admin/permissions/route");
    const response = await POST(new NextRequest("http://localhost:3100/api/admin/permissions", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
    expect(response.status).toBe(400);
  });
  it("revoking the last default permission leaves an intentional empty override", async () => {
    const { POST } = await import("@/app/api/admin/permissions/route");
    const response = await POST(new NextRequest("http://localhost:3100/api/admin/permissions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "reviewer", permission: "content:review", granted: false }),
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.permissions.every((p: { granted: boolean }) => !p.granted)).toBe(true);
    expect((await import("@/lib/session")).hasPermission("reviewer", "content:review")).toBe(false);
  });
});
