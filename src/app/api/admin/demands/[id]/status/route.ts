import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { audit } from "@/lib/audit";
import { ok, fail, handle } from "@/lib/api";

const VALID = ["pending_review", "collecting", "evaluating", "scheduled", "producing", "launched", "rejected", "merged"];

// PATCH /api/admin/demands/:id/status — 变更状态 + 官方反馈（§6.6：未采纳必须填原因）
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await params;
    const body = (await req.json()) as {
      status: string;
      officialReply?: string;
      reason?: string;
      launchedCourseId?: string;
      riskLevel?: string;
    };
    if (!VALID.includes(body.status)) return fail("非法状态");
    if (body.status === "rejected" && !body.reason?.trim()) return fail("未采纳必须填写原因");

    const demand = await prisma.demand.findUnique({ where: { id } });
    if (!demand) return fail("需求不存在", 404);

    const updated = await prisma.demand.update({
      where: { id },
      data: {
        status: body.status,
        officialReply: body.officialReply ?? demand.officialReply,
        launchedCourseId: body.launchedCourseId ?? demand.launchedCourseId,
        riskLevel: body.riskLevel ?? demand.riskLevel,
      },
    });
    await prisma.demandStatusLog.create({
      data: {
        demandId: id,
        fromStatus: demand.status,
        toStatus: body.status,
        operatorId: admin.id,
        reason: body.reason ?? body.officialReply,
      },
    });
    await audit({ operatorId: admin.id, action: "demand.status", targetType: "demand", targetId: id, detail: `${demand.status}→${body.status}` });
    return ok(updated);
  });
}
