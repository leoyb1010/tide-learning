import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminRole } from "@/lib/session";
import { audit } from "@/lib/audit";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { generateRedemptionCodes, REDEMPTION_TYPES, type RedemptionType } from "@/lib/redemption";

export const dynamic = "force-dynamic";

/**
 * 兑换码后台（v3.3）。高危发放口 → requireAdminRole（仅超级管理员）+ assertSameOrigin + 审计。
 */

// GET /api/admin/redemption-codes?batchId=&status= — 列出兑换码（含已兑次数），最新在前。
export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireAdminRole();
    const batchId = (req.nextUrl.searchParams.get("batchId") ?? "").trim();
    const status = (req.nextUrl.searchParams.get("status") ?? "").trim();

    const where: { batchId?: string; status?: string } = {};
    if (batchId) where.batchId = batchId;
    if (status === "active" || status === "disabled") where.status = status;

    const codes = await prisma.redemptionCode.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true, code: true, batchId: true, type: true, value: true,
        planId: true, maxUses: true, usedCount: true, status: true,
        note: true, expiresAt: true, createdAt: true,
      },
    });
    return ok({ codes });
  });
}

// POST /api/admin/redemption-codes — 批量生成。{type, value, count, maxUses?, planId?, note?, expiresAt?}
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const admin = await requireAdminRole();

    const body = (await req.json()) as {
      type?: unknown; value?: unknown; count?: unknown;
      maxUses?: unknown; planId?: unknown; note?: unknown; expiresAt?: unknown;
    };

    const type = typeof body.type === "string" ? body.type : "";
    if (!REDEMPTION_TYPES.includes(type as RedemptionType)) return fail("兑换码类型仅支持 credits / membership");
    const value = typeof body.value === "number" ? Math.trunc(body.value) : NaN;
    if (!Number.isInteger(value) || value <= 0) return fail("面值（积分数/会员天数）须为正整数");
    const count = typeof body.count === "number" ? Math.trunc(body.count) : NaN;
    if (!Number.isInteger(count) || count <= 0) return fail("生成数量须为正整数");
    if (count > 1000) return fail("单批最多生成 1000 个兑换码");

    const maxUses = body.maxUses == null ? 1 : Number(body.maxUses);
    if (!Number.isInteger(maxUses) || maxUses <= 0) return fail("可兑换次数须为正整数");

    const planId = typeof body.planId === "string" && body.planId.trim() ? body.planId.trim() : null;
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) || null : null;

    let expiresAt: Date | null = null;
    if (typeof body.expiresAt === "string" && body.expiresAt) {
      const d = new Date(body.expiresAt);
      if (Number.isNaN(d.getTime())) return fail("过期时间格式错误");
      expiresAt = d;
    }

    const { batchId, codes } = await generateRedemptionCodes({
      type: type as RedemptionType,
      value, count, maxUses, planId, note, expiresAt,
      createdById: admin.id,
    });

    await audit({
      operatorId: admin.id,
      action: "redemption:generate",
      targetType: "redemption_batch",
      targetId: batchId,
      detail: JSON.stringify({ type, value, count, maxUses, planId, note, expiresAt }),
    }).catch(() => {});

    return ok({ batchId, codes, count: codes.length });
  });
}
