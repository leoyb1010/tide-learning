import { NextRequest, NextResponse } from "next/server";

/** 历史版本曾把私有笔记附件放在 public/uploads；统一阻断静态直读。 */
export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/uploads/")) {
    return new NextResponse("Not Found", { status: 404, headers: { "cache-control": "private, no-store" } });
  }
  const nonce = btoa(crypto.randomUUID());
  const devEval = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
  const csp = `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'nonce-${nonce}'${devEval}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self'`;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"] };
