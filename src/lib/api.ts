import { NextResponse, NextRequest } from "next/server";
import { AuthError } from "./session";
import { RateLimitError } from "./rate-limit";

export function ok(data: unknown, init?: number) {
  return NextResponse.json({ ok: true, data }, { status: init ?? 200 });
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/**
 * 业务级错误：message 可安全回传客户端。
 * 与之相对，未包裹的 Error / Prisma 错误一律折叠为通用文案（A1-6：不泄露内部）。
 */
export class AppError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** 统一异常处理（§19 技术验收 + A1-6 安全错误折叠）。 */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AuthError) return fail(e.message, e.status);
    if (e instanceof RateLimitError) {
      const res = fail(e.message, e.status);
      res.headers.set("Retry-After", String(e.retryAfterSec));
      return res;
    }
    if (e instanceof AppError) return fail(e.message, e.status);
    // 其余：记录服务端日志，返回通用文案，避免泄露数据结构 / 配置
    console.error("[api:internal]", e instanceof Error ? e.stack ?? e.message : e);
    return fail("服务异常，请稍后再试", 500);
  }
}

/**
 * A2：对写操作做同源校验（轻量 CSRF 防护，配合 sameSite=strict cookie）。
 * 校验 Origin/Referer 与目标 Host 一致；不一致直接拒绝。
 */
export function assertSameOrigin(req: NextRequest) {
  // 原生 App：携带 Authorization: Bearer 的请求天然防 CSRF（token 不会被浏览器自动附带），放行。
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return;
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin) return; // 同源导航式请求可能无 origin，放行（GET 已被路由方法限制）
  try {
    const o = new URL(origin);
    if (host && o.host !== host) throw new AppError("跨域请求被拒绝", 403);
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("非法请求来源", 403);
  }
}
