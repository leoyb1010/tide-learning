import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { audit } from "@/lib/audit";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * 后台优惠券管理（流3-U4b）。
 * 鉴权：复用 order:refund 权限点（admin + finance 具备），与 /api/admin/credits 调账口同级——
 * 优惠券直接影响成交金额，属财务运营范畴，不新开权限点避免权限矩阵膨胀。
 */

const VALID_KINDS = ["percent", "fixed"];

// GET /api/admin/coupons — 列出全部券（含已核销数），最新在前。
export async function GET() {
  return handle(async () => {
    await requirePermission("order:refund");
    const coupons = await prisma.coupon.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true, code: true, kind: true, value: true,
        maxRedeem: true, redeemedCount: true, planScope: true,
        expiresAt: true, isActive: true, createdAt: true,
      },
    });
    return ok({ coupons });
  });
}

// POST /api/admin/coupons — 发券。
export async function POST(req: NextRequest) {
  return handle(async () => {
    const admin = await requirePermission("order:refund");
    assertSameOrigin(req);
    const body = (await req.json()) as {
      code?: string;
      kind?: string;
      value?: number;
      maxRedeem?: number;
      planScope?: string;
      expiresAt?: string | null;
      isActive?: boolean;
    };

    const code = (body.code ?? "").trim().toUpperCase();
    if (!code) return fail("请填写券码");
    if (!/^[A-Z0-9_-]{2,32}$/.test(code)) return fail("券码仅限字母数字与 -_，长度 2-32");

    const kind = body.kind ?? "percent";
    if (!VALID_KINDS.includes(kind)) return fail("券类型仅支持 percent / fixed");

    const value = Number(body.value);
    if (!Number.isInteger(value) || value <= 0) return fail("面值须为正整数");
    if (kind === "percent" && value > 100) return fail("百分比折扣不能超过 100");

    const maxRedeem = body.maxRedeem == null ? 0 : Number(body.maxRedeem);
    if (!Number.isInteger(maxRedeem) || maxRedeem < 0) return fail("限领数须为 ≥0 整数（0=不限）");

    const planScope = (body.planScope ?? "any").trim() || "any";
    // planScope 若非 "any" 须为存在的套餐 id，避免发出永不生效的僵尸券
    if (planScope !== "any") {
      const plan = await prisma.plan.findUnique({ where: { id: planScope } });
      if (!plan) return fail("指定套餐不存在");
    }

    let expiresAt: Date | null = null;
    if (body.expiresAt) {
      const d = new Date(body.expiresAt);
      if (Number.isNaN(d.getTime())) return fail("过期时间格式错误");
      expiresAt = d;
    }

    const existing = await prisma.coupon.findUnique({ where: { code } });
    if (existing) return fail("券码已存在");

    const coupon = await prisma.coupon.create({
      data: {
        code, kind, value, maxRedeem, planScope, expiresAt,
        isActive: body.isActive ?? true,
      },
    });

    await audit({
      operatorId: admin.id,
      action: "coupon:create",
      targetType: "coupon",
      targetId: coupon.id,
      detail: JSON.stringify({ code, kind, value, maxRedeem, planScope }),
    }).catch(() => {});

    return ok({ coupon });
  });
}
