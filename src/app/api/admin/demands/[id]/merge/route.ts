import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { audit } from "@/lib/audit";
import { ok, fail, handle } from "@/lib/api";

// POST /api/admin/demands/:id/merge — 合并重复需求（原投票不丢失，§6.6 验收）
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await params; // 被合并的需求
    const { targetDemandId } = (await req.json()) as { targetDemandId: string };
    if (!targetDemandId || targetDemandId === id) return fail("请选择合并到的目标需求");

    const [source, target] = await Promise.all([
      prisma.demand.findUnique({ where: { id } }),
      prisma.demand.findUnique({ where: { id: targetDemandId } }),
    ]);
    if (!source || !target) return fail("需求不存在", 404);

    // 迁移投票（保留原投票，避免同一用户同周重复冲突则累加）
    const sourceVotes = await prisma.demandVote.findMany({ where: { demandId: id } });
    for (const v of sourceVotes) {
      const existing = await prisma.demandVote.findUnique({
        where: { demandId_userId_weekKey: { demandId: targetDemandId, userId: v.userId, weekKey: v.weekKey } },
      });
      if (existing) {
        await prisma.demandVote.update({ where: { id: existing.id }, data: { voteCount: existing.voteCount + v.voteCount } });
        await prisma.demandVote.delete({ where: { id: v.id } });
      } else {
        await prisma.demandVote.update({ where: { id: v.id }, data: { demandId: targetDemandId } });
      }
    }

    await prisma.demand.update({
      where: { id },
      data: { status: "merged", mergedToDemandId: targetDemandId },
    });
    await prisma.demandStatusLog.create({
      data: { demandId: id, fromStatus: source.status, toStatus: "merged", operatorId: admin.id, reason: `合并到 ${target.title}` },
    });
    await audit({ operatorId: admin.id, action: "demand.merge", targetType: "demand", targetId: id, detail: `→${targetDemandId}` });
    return ok({ merged: true, targetDemandId });
  });
}
