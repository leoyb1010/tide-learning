import { listUpdates } from "@/lib/queries";
import { ok, handle } from "@/lib/api";

// GET /api/updates — 本周上新
export async function GET() {
  return handle(async () => ok({ updates: await listUpdates(30) }));
}
