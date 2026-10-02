/** Synthetic role journeys only. Never point this harness at a deployed database. */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";
import { restrictToLocalApp } from "./audit-browser-network.mjs";

const base = process.env.BASE_URL || "http://127.0.0.1:3100";
const target = new URL(base);
assert(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname), "Synthetic audit requires loopback");
assert.equal(process.env.ROLE_AUDIT_ALLOW_SYNTHETIC, "1", "Explicit disposable-database opt-in required");
assert(process.env.DATABASE_URL?.startsWith("file:"), "Synthetic audit requires a disposable SQLite file");
const out = process.env.QA_OUT || path.join(process.cwd(), "evidence", "browser-qa");
await mkdir(out, { recursive: true });
const prisma = new PrismaClient();
const browser = await chromium.launch({ headless: true });
const stamp = randomBytes(6).toString("hex");
const actors = new Map();
const results = [];
const roleMatrix = {
  user: [],
  admin: ["course:write", "demand:moderate", "order:read", "order:refund", "user:read", "lead:manage", "content:review", "dashboard:read"],
  content_manager: ["course:write", "dashboard:read"],
  demand_moderator: ["demand:moderate", "dashboard:read"],
  support: ["user:read", "lead:manage", "order:read"],
  finance: ["order:read", "order:refund", "dashboard:read"],
  reviewer: ["content:review"],
};
const nav = [
  ["/admin", "dashboard:read"], ["/admin/courses", "course:write"],
  ["/admin/content-calendar", "course:write"], ["/admin/demands", "demand:moderate"],
  ["/admin/moderation", "content:review"], ["/admin/gen-quality", "content:review"],
  ["/admin/leads", "lead:manage"], ["/admin/orders", "order:read"],
  ["/admin/credits", "order:refund"], ["/admin/billing", "order:refund"],
  ["/admin/users", "user:read"], ["/admin/redemption-codes", "admin"],
  ["/admin/permissions", "admin"], ["/admin/errors", "admin"],
];
const probes = [
  ["/api/admin/courses", "course:write"], ["/api/admin/demands/pending", "demand:moderate"],
  ["/api/admin/orders", "order:read"], ["/api/admin/users", "user:read"],
  ["/api/admin/leads", "lead:manage"], ["/api/admin/dashboard", "dashboard:read"],
  // Invalid inert writes distinguish authorized validation (400) from forbidden (403).
  ["/api/admin/credits/adjust", "order:refund", {}],
  ["/api/admin/moderation/post", "content:review", {}],
];
const originalOverrides = await prisma.rolePermission.findMany({ where: { role: "reviewer" } });
async function api(actor, route, body) {
  return actor.context.request.fetch(`${base}${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { origin: target.origin },
    ...(body === undefined ? {} : { data: body }),
  });
}
async function snap(page, name) {
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: false });
}
try {
  for (const [role, permissions] of Object.entries(roleMatrix)) {
    const user = await prisma.user.create({ data: {
      email: `role-${role}-${stamp}@example.test`, nickname: `合成 ${role}`, role,
      profile: { create: {} },
    } });
    const token = randomBytes(32).toString("hex");
    const sessionId = createHash("sha256").update(token).digest("hex");
    await prisma.session.create({ data: { id: sessionId, userId: user.id, expiresAt: new Date(Date.now() + 3600_000) } });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    await restrictToLocalApp(context, base);
    await context.addCookies([{ name: "tide_session", value: token, url: base, httpOnly: true, sameSite: "Strict" }]);
    const page = await context.newPage();
    const actor = { user, sessionId, context, page };
    actors.set(role, actor);
    const landing = role === "user" ? "/me" : nav.find(([, permission]) => permissions.includes(permission))?.[0];
    await page.goto(`${base}${landing}`, { waitUntil: "networkidle" });
    assert.equal(new URL(page.url()).pathname, landing, `${role}: allowed page unexpectedly redirected`);
    if (role === "user") assert((await page.getByRole("main").innerText()).includes(user.nickname), "Learner profile did not render its own identity");
    else assert.equal(await page.locator("h1").count(), 1, `${role}: missing primary page heading`);
    if (role !== "user") {
      const actual = await page.locator('aside nav a[href^="/admin"]').evaluateAll(links => links.map(a => a.getAttribute("href")));
      const expected = nav.filter(([, permission]) => permission === "admin" ? role === "admin" : permissions.includes(permission)).map(([route]) => route);
      assert.deepEqual(actual, expected, `${role}: sidebar permission mismatch`);
    }
    const statuses = {};
    for (const [route, permission, body] of probes) {
      const response = await api(actor, route, body);
      const expected = permissions.includes(permission) ? (body === undefined ? 200 : 400) : 403;
      assert.equal(response.status(), expected, `${role}: ${route}`);
      statuses[permission] = response.status();
    }
    const adminOnly = await api(actor, "/api/admin/permissions");
    assert.equal(adminOnly.status(), role === "admin" ? 200 : 403, `${role}: admin-only matrix`);
    await snap(page, `role-r1-${role}`);
    if (role !== "admin") {
      await page.goto(`${base}/admin/permissions`, { waitUntil: "networkidle" });
      if (new URL(page.url()).pathname === "/admin/permissions") {
        assert(await page.getByRole("heading", { name: "无权访问", exact: true }).isVisible(), `${role}: admin-only deep link escaped gate`);
      }
    }
    results.push({ round: 1, role, landing, permissionStatuses: statuses, adminOnlyStatus: adminOnly.status(), status: "passed" });
  }

  // R2: revoke a role while its authenticated page remains open, then retry and navigate Back.
  const admin = actors.get("admin");
  const reviewer = actors.get("reviewer");
  const support = actors.get("support");
  await reviewer.page.setViewportSize({ width: 390, height: 844 });
  await reviewer.page.goto(`${base}/admin/moderation`, { waitUntil: "networkidle" });
  const forged = await api(support, "/api/admin/permissions", { role: "reviewer", permission: "content:review", granted: true, operatorId: admin.user.id });
  assert.equal(forged.status(), 403, "Support must not change permissions by forging operator ID");
  const revoke = await api(admin, "/api/admin/permissions", { role: "reviewer", permission: "content:review", granted: false });
  assert.equal(revoke.status(), 200);
  // Other server workers have a documented 10s snapshot TTL; never claim instant global revocation.
  const deadline = Date.now() + 12_000;
  let revokedStatus;
  do {
    revokedStatus = (await api(reviewer, "/api/admin/moderation/post", {})).status();
    if (revokedStatus === 403) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  assert.equal(revokedStatus, 403, "Revoked reviewer retained authority beyond cache TTL");
  do {
    await reviewer.page.reload({ waitUntil: "networkidle" });
    // The public-home fallback redirects authenticated users to their own desk.
    if (new URL(reviewer.page.url()).pathname === "/desk") break;
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  assert.equal(new URL(reviewer.page.url()).pathname, "/desk", "Revoked role did not land safely within cache TTL");
  await reviewer.page.goto(`${base}/courses`, { waitUntil: "networkidle" });
  await reviewer.page.goBack({ waitUntil: "networkidle" });
  assert.equal(new URL(reviewer.page.url()).pathname, "/desk", "Back resurrected revoked page");
  await snap(reviewer.page, "role-r2-revoked-reviewer-mobile");
  results.push({ round: 2, journey: "support impersonation denied; reviewer revoked in open session; reload and Back safe", status: "passed" });

  // R2: a role downgrade and session expiration cannot retain the old admin authority.
  await prisma.user.update({ where: { id: admin.user.id }, data: { role: "support" } });
  assert.equal((await api(admin, "/api/admin/permissions")).status(), 403, "Session retained old admin role");
  assert.equal((await api(admin, "/api/admin/leads")).status(), 200, "Downgraded support lost legitimate lead access");
  await prisma.session.update({ where: { id: admin.sessionId }, data: { expiresAt: new Date(0) } });
  assert.equal((await api(admin, "/api/admin/leads")).status(), 401, "Expired session retained role authority");
  await admin.page.goto(`${base}/admin/leads`, { waitUntil: "networkidle" });
  assert.equal(new URL(admin.page.url()).pathname, "/login");
  await snap(admin.page, "role-r2-expired-session-login");
  results.push({ round: 2, journey: "admin downgrade preserves support duties; expired session returns to login", status: "passed" });
  await writeFile(path.join(out, "role-journeys.json"), JSON.stringify({ roles: roleMatrix, results }, null, 2));
  console.log(`Role journeys passed: ${Object.keys(roleMatrix).length} actual roles, 56 permission probes, 7 admin-only probes, 2 interrupted authority flows`);
} finally {
  await prisma.$transaction(async tx => {
    await tx.rolePermission.deleteMany({ where: { role: "reviewer" } });
    if (originalOverrides.length) await tx.rolePermission.createMany({ data: originalOverrides });
  });
  await browser.close();
  await prisma.user.deleteMany({ where: { id: { in: [...actors.values()].map(actor => actor.user.id) } } });
  await prisma.$disconnect();
}
