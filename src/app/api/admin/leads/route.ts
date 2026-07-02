import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { ok, handle } from "@/lib/api";

// GET /api/admin/leads — 建联跟进队列（support 角色）
export async function GET() {
  return handle(async () => {
    await requirePermission("lead:manage");
    const leads = await prisma.lead.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
    // 渠道 × 状态 漏斗聚合
    const bySource: Record<string, { total: number; converted: number }> = {};
    for (const l of leads) {
      const s = (bySource[l.source] ??= { total: 0, converted: 0 });
      s.total++;
      if (l.status === "converted") s.converted++;
    }
    return ok({ leads, bySource });
  });
}
