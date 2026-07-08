import { destroySession } from "@/lib/session";
import { ok, handle } from "@/lib/api";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  return handle(async () => {
    await destroySession();
    const accept = req.headers.get("accept") ?? "";
    if (accept.includes("text/html")) {
      return NextResponse.redirect(new URL("/", req.url), 303);
    }
    return ok({ loggedOut: true });
  });
}
