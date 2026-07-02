import { NextResponse } from "next/server";
import { AuthError } from "./session";

export function ok(data: unknown, init?: number) {
  return NextResponse.json({ ok: true, data }, { status: init ?? 200 });
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/** 统一异常处理，保证核心接口有错误处理（§19 技术验收）。 */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AuthError) return fail(e.message, e.status);
    const msg = e instanceof Error ? e.message : "服务异常";
    console.error("[api]", msg);
    return fail(msg, 500);
  }
}
