import { destroySession } from "@/lib/session";
import { ok, handle } from "@/lib/api";

export async function POST() {
  return handle(async () => {
    await destroySession();
    return ok({ loggedOut: true });
  });
}
