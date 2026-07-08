import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { ok, handle } from "@/lib/api";

// GET /api/admin/demands/pending — 待审核 + 全部需求（后台审核队列）
// P2-3：高危需求优先审核——先按风险等级(high>medium>low)、再按提交时间倒序，让疑似导流/脚本浮到队首。
const RISK_RANK: Record<string, number> = { high: 2, medium: 1, low: 0 };
export async function GET() {
  return handle(async () => {
    await requirePermission("demand:moderate");
    const demands = await prisma.demand.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { votes: true } }, user: { select: { nickname: true } } },
    });
    demands.sort(
      (a, b) =>
        (RISK_RANK[b.riskLevel] ?? 0) - (RISK_RANK[a.riskLevel] ?? 0) ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    );
    return ok({ demands });
  });
}
