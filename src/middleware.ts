import { NextResponse } from "next/server";

/** 历史版本曾把私有笔记附件放在 public/uploads；统一阻断静态直读。 */
export function middleware() {
  return new NextResponse("Not Found", { status: 404, headers: { "cache-control": "private, no-store" } });
}

export const config = { matcher: "/uploads/:path*" };
