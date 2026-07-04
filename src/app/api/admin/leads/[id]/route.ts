import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { audit } from "@/lib/audit";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";

const VALID = ["new", "contacting", "booked", "trialing", "converted", "lost"];

// PATCH /api/admin/leads/:id — 更新建联状态/跟进备注（电联建联流转）
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requirePermission("lead:manage");
    assertSameOrigin(req);
    const { id } = await params;
    const body = (await req.json()) as { status?: string; followUpNote?: string };
    if (body.status && !VALID.includes(body.status)) return fail("非法状态");
    const lead = await prisma.lead.update({
      where: { id },
      data: {
        ...(body.status ? { status: body.status } : {}),
        ...(body.followUpNote != null ? { followUpNote: body.followUpNote } : {}),
        assigneeId: admin.id,
      },
    });
    await audit({ operatorId: admin.id, action: "lead.update", targetType: "lead", targetId: id, detail: body.status ?? "" });
    return ok(lead);
  });
}
