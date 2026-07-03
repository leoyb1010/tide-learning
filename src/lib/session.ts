import { cache } from "react";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies, headers } from "next/headers";
import { prisma } from "./db";
import type { User } from "@prisma/client";

const SESSION_COOKIE = "tide_session";
const SESSION_DAYS = 30;

// ---------- 密码哈希（scrypt，无外部依赖）----------
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const derived = scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, "hex");
  return keyBuf.length === derived.length && timingSafeEqual(keyBuf, derived);
}

// ---------- A1-10：密码强度校验 + 常见密码黑名单 ----------
const WEAK_PASSWORDS = new Set([
  "12345678", "123456789", "password", "qwerty123", "abc12345",
  "11111111", "00000000", "88888888", "123123123", "666666666",
]);

/** 返回错误文案；null 表示通过。要求 ≥8 位、含字母与数字、非黑名单。 */
export function validatePasswordStrength(pw: string): string | null {
  if (pw.length < 8) return "密码至少 8 位";
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return "密码需同时包含字母和数字";
  if (WEAK_PASSWORDS.has(pw.toLowerCase())) return "密码过于常见，请更换";
  return null;
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function anonId(seed?: string): string {
  return createHash("sha256")
    .update((seed ?? randomBytes(8).toString("hex")) + Date.now())
    .digest("hex")
    .slice(0, 24);
}

// ---------- Session ----------
export async function createSession(userId: string): Promise<string> {
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  const session = await prisma.session.create({ data: { userId, expiresAt } });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: "strict", // A2：从 lax 收紧到 strict，堵住 CSRF
    path: "/",
    expires: expiresAt,
    secure: process.env.NODE_ENV === "production",
  });
  return session.id;
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const sid = cookieStore.get(SESSION_COOKIE)?.value;
  if (sid) {
    await prisma.session.deleteMany({ where: { id: sid } });
    cookieStore.delete(SESSION_COOKIE);
  }
}

/**
 * 服务端读取当前用户，null 表示游客。所有权益判断以此为准。
 * 用 React cache() 包裹：同一次请求内 layout 与各 page 多次调用只查一次库
 * （去重按参数计算，此处无参数 → 每请求命中同一缓存）。cache 仅在服务端生效。
 */
/**
 * 取当前会话 id：优先 Authorization: Bearer <sid>（iOS/原生 App），回退 cookie（Web）。
 * sessionId 本身即不透明随机 token，双通道复用同一张 session 表，无需另签发。
 */
async function currentSessionId(): Promise<string | null> {
  const h = await headers();
  const auth = h.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const t = auth.slice(7).trim();
    if (t) return t;
  }
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value ?? null;
}

export const getCurrentUser = cache(async (): Promise<User | null> => {
  const sid = await currentSessionId();
  if (!sid) return null;
  const session = await prisma.session.findUnique({
    where: { id: sid },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  if (session.user.deletedAt) return null;
  return session.user;
});

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("需要登录");
  return user;
}

// ---------- A1-5：细粒度后台权限（RBAC）----------
export type Permission =
  | "course:write"      // 课程/章节/更新日志/排期
  | "demand:moderate"   // 需求审核/合并/状态/官方回复
  | "order:read"        // 订单/订阅报表
  | "order:refund"      // 退款/权益补偿
  | "user:read"         // 用户查询
  | "lead:manage"       // 建联队列
  | "content:review"    // 健康/财务/防诈骗内容审核
  | "dashboard:read";   // 运营看板

/**
 * 代码兜底权限矩阵（Record<role, Permission[]>）。
 * DB 的 RolePermission 表可对某个角色做「覆盖」；某角色一旦在 DB 有任意记录，
 * 该角色的有效权限就完全以 DB 为准（见 hasPermission）；DB 无该角色记录时回退此常量。
 * 关键：DB 空表时行为与改造前完全一致。
 */
export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  admin: [
    "course:write", "demand:moderate", "order:read", "order:refund",
    "user:read", "lead:manage", "content:review", "dashboard:read",
  ],
  content_manager: ["course:write", "dashboard:read"],
  demand_moderator: ["demand:moderate", "dashboard:read"],
  support: ["user:read", "lead:manage", "order:read"],
  finance: ["order:read", "order:refund", "dashboard:read"],
  reviewer: ["content:review"],
};

/** 全部可枚举权限点（供权限矩阵 UI 列渲染 / 校验入参合法性）。 */
export const ALL_PERMISSIONS: Permission[] = [
  "course:write", "demand:moderate", "order:read", "order:refund",
  "user:read", "lead:manage", "content:review", "dashboard:read",
];

/** 全部内置角色（矩阵 UI 的行）。 */
export const ALL_ROLES = Object.keys(ROLE_PERMISSIONS);

const ADMIN_ROLES = ALL_ROLES;

/**
 * 防自锁：admin 角色必须永久保留的核心权限，任何 DB 覆盖都不能移空这些。
 * 只要 admin 保有这批权限，就无法把自己彻底锁在权限矩阵管理之外。
 */
export const ADMIN_LOCKED_PERMISSIONS: Permission[] = ["user:read", "dashboard:read"];

// ---------- DB 覆盖：模块级短缓存（让 hasPermission 保持同步）----------
// 存「哪些角色在 DB 有覆盖」+ 每个被覆盖角色的权限 Set。空 Map（无任何覆盖）时
// hasPermission 直接走代码兜底，行为与改造前一致。
type OverrideMap = Map<string, Set<string>>;
let overrideCache: OverrideMap = new Map();
let overrideCacheAt = 0;
let overrideInflight: Promise<void> | null = null;
const OVERRIDE_TTL_MS = 10_000; // 10s 短缓存：调整权限后最迟 10s 全量生效

/**
 * 刷新 DB 覆盖缓存（TTL 内直接命中，不查库）。
 * 权限校验路径在调用同步 hasPermission 前应先 await 本函数，
 * 以确保读到的是最新覆盖（requirePermission 已内置调用）。
 * 查库失败时保留旧缓存并放行（fail-safe：不因权限表抖动导致全站 403）。
 */
export async function primePermissionCache(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - overrideCacheAt < OVERRIDE_TTL_MS) return;
  if (overrideInflight) return overrideInflight;
  overrideInflight = (async () => {
    try {
      const rows = await prisma.rolePermission.findMany({
        select: { role: true, permission: true },
      });
      const next: OverrideMap = new Map();
      for (const r of rows) {
        let set = next.get(r.role);
        if (!set) { set = new Set(); next.set(r.role, set); }
        set.add(r.permission);
      }
      overrideCache = next;
      overrideCacheAt = Date.now();
    } catch (e) {
      // 保留旧缓存；仅记录，避免权限表读取失败拖垮请求
      console.error("[rbac:override-cache]", e instanceof Error ? e.message : e);
    } finally {
      overrideInflight = null;
    }
  })();
  return overrideInflight;
}

/** 手动失效缓存（写权限后调用，使下一次 prime 立即回源）。 */
export function invalidatePermissionCache(): void {
  overrideCacheAt = 0;
}

/**
 * 同步权限判断（调用方无需 await，兼容既有同步调用点）。
 * 逻辑：该角色在 DB 有覆盖 → 以 DB 覆盖为准；否则回退代码兜底 ROLE_PERMISSIONS。
 * 注意：读取的是模块级缓存快照，请在权限敏感路径先 await primePermissionCache()。
 */
export function hasPermission(role: string, perm: Permission): boolean {
  const override = overrideCache.get(role);
  if (override) return override.has(perm);
  return ROLE_PERMISSIONS[role]?.includes(perm) ?? false;
}

/**
 * 计算某角色的「有效权限」列表（DB 覆盖优先，否则代码兜底）。供矩阵 UI / GET 接口用。
 * 返回 { permissions, source }：source 标明该角色当前取自 DB 还是代码默认。
 */
export function effectivePermissions(role: string): { permissions: Permission[]; source: "db" | "default" } {
  const override = overrideCache.get(role);
  if (override) {
    return { permissions: ALL_PERMISSIONS.filter((p) => override.has(p)), source: "db" };
  }
  return { permissions: ROLE_PERMISSIONS[role] ?? [], source: "default" };
}

/** 后台入口：任一后台角色即可（用于布局壳）。 */
export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (!ADMIN_ROLES.includes(user.role)) throw new AuthError("需要后台权限");
  return user;
}

/**
 * 超级管理员闸门：仅 role==="admin" 可过（用于权限矩阵管理这类高危页）。
 * 不走细粒度权限点——避免「把 admin 权限调空后连管理页都进不去」的自锁死循环。
 */
export async function requireAdminRole(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "admin") throw new AuthError("仅超级管理员可访问", 403);
  return user;
}

/** 细粒度：要求具体权限，否则 403。先刷新 DB 覆盖缓存再同步判定。 */
export async function requirePermission(perm: Permission): Promise<User> {
  const user = await requireUser();
  await primePermissionCache();
  if (!hasPermission(user.role, perm)) {
    throw new AuthError("权限不足", 403);
  }
  return user;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}
