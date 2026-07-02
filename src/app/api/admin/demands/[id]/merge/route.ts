import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { audit } from "@/lib/audit";
import { MAX_VOTES_PER_DEMAND } from "@/lib/week";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";

// POST /api/admin/demands/:id/merge — 合并重复需求（原投票不丢失，§6.6 验收）
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req); // A2：写操作 CSRF 防护
    const admin = await requirePermission("demand:moderate");
    const { id } = await params; // 被合并的需求
    const { targetDemandId } = (await req.json()) as { targetDemandId: string };
    if (!targetDemandId || targetDemandId === id) return fail("请选择合并到的目标需求");

    const [source, target] = await Promise.all([
      prisma.demand.findUnique({ where: { id } }),
      prisma.demand.findUnique({ where: { id: targetDemandId } }),
    ]);
    if (!source || !target) return fail("需求不存在", 404);

    // 整个合并流程包入事务：任一步失败则回滚，避免「部分票已迁移、源需求状态未改」的不一致中间态。
    await prisma.$transaction(async (tx) => {
      const [sourceVotes, targetVotes] = await Promise.all([
        tx.demandVote.findMany({ where: { demandId: id } }),
        tx.demandVote.findMany({ where: { demandId: targetDemandId } }),
      ]);
      // 一次性建立目标票行索引（demandId+userId+weekKey 唯一），替代循环内逐条 findUnique（消除 N+1）
      const targetByKey = new Map(targetVotes.map((v) => [`${v.userId}::${v.weekKey}`, v]));

      for (const v of sourceVotes) {
        const existing = targetByKey.get(`${v.userId}::${v.weekKey}`);
        if (existing) {
          // 合并累加后钳制到单需求上限，避免同一用户同周在源、目标各投满导致 voteCount 破 3 票不变量
          const merged = Math.min(MAX_VOTES_PER_DEMAND, existing.voteCount + v.voteCount);
          await tx.demandVote.update({ where: { id: existing.id }, data: { voteCount: merged } });
          await tx.demandVote.delete({ where: { id: v.id } });
        } else {
          // 目标无该用户同周票行：直接改挂，同样钳制到上限
          const capped = Math.min(MAX_VOTES_PER_DEMAND, v.voteCount);
          await tx.demandVote.update({
            where: { id: v.id },
            data: { demandId: targetDemandId, voteCount: capped },
          });
        }
      }

      await tx.demand.update({
        where: { id },
        data: { status: "merged", mergedToDemandId: targetDemandId },
      });
      await tx.demandStatusLog.create({
        data: { demandId: id, fromStatus: source.status, toStatus: "merged", operatorId: admin.id, reason: `合并到 ${target.title}` },
      });
    });

    await audit({ operatorId: admin.id, action: "demand.merge", targetType: "demand", targetId: id, detail: `→${targetDemandId}` });
    return ok({ merged: true, targetDemandId });
  });
}
