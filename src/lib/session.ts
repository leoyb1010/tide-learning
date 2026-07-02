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
    sameSite: "lax",
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

/** 服务端读取当前用户，null 表示游客。所有权益判断以此为准。 */
export async function getCurrentUser(): Promise<User | null> {
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
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("需要登录");
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  const adminRoles = ["admin", "content_manager", "demand_moderator", "support", "finance", "reviewer"];
  if (!adminRoles.includes(user.role)) throw new AuthError("需要后台权限");
  return user;
}

export class AuthError extends Error {
  status = 401;
}
