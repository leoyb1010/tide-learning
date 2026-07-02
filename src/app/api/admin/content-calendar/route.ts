import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { ok, handle } from "@/lib/api";

// GET /api/admin/content-calendar — 内容排期（§8.2.2）
export async function GET() {
  return handle(async () => {
    await requirePermission("course:write");
    const items = await prisma.contentCalendar.findMany({
      orderBy: { plannedPublishDate: "asc" },
      include: { course: { select: { title: true, slug: true } } },
    });
    return ok({ items });
  });
}
