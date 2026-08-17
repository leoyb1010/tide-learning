import { destroySession } from "@/lib/session";
import { ok, handle, assertSameOrigin } from "@/lib/api";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  return handle(async () => {
    // Cookie 会被浏览器自动携带；退出同样属于写操作，必须阻止第三方页面强制注销。
    // 原生 App 的 Bearer 请求由 assertSameOrigin 按既有规则安全放行。
    assertSameOrigin(req);
    await destroySession();
    const accept = req.headers.get("accept") ?? "";
    if (accept.includes("text/html")) {
      return NextResponse.redirect(new URL("/", req.url), 303);
    }
    return ok({ loggedOut: true });
  });
}
