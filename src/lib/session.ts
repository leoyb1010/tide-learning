import { cache } from "react";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
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
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const cookieStore = await cookies();
  const sid = cookieStore.get(SESSION_COOKIE)?.value;
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

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
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

const ADMIN_ROLES = Object.keys(ROLE_PERMISSIONS);

export function hasPermission(role: string, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(perm) ?? false;
}

/** 后台入口：任一后台角色即可（用于布局壳）。 */
export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (!ADMIN_ROLES.includes(user.role)) throw new AuthError("需要后台权限");
  return user;
}

/** 细粒度：要求具体权限，否则 403。 */
export async function requirePermission(perm: Permission): Promise<User> {
  const user = await requireUser();
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
