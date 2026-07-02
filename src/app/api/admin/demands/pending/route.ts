import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { ok, handle } from "@/lib/api";

// GET /api/admin/demands/pending — 待审核 + 全部需求（后台审核队列）
export async function GET() {
  return handle(async () => {
    await requirePermission("demand:moderate");
    const demands = await prisma.demand.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { votes: true } }, user: { select: { nickname: true } } },
    });
    return ok({ demands });
  });
}
