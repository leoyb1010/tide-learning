import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission, requireAdminRole, hashPassword, validatePasswordStrength, ALL_ROLES } from "@/lib/session";
import { audit } from "@/lib/audit";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { ensureAccount } from "@/lib/credits";

// GET /api/admin/users — 用户查询（§8.2.4）
export async function GET() {
  return handle(async () => {
    await requirePermission("user:read");
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        _count: { select: { notes: true, orders: true } },
        subscriptions: { orderBy: { currentPeriodEnd: "desc" }, take: 1 },
      },
    });
    return ok({
      users: users.map((u) => ({
        id: u.id,
        nickname: u.nickname,
        email: u.email,
        phone: u.phone,
        role: u.role,
        deletedAt: u.deletedAt,
        createdAt: u.createdAt,
        notesCount: u._count.notes,
        ordersCount: u._count.orders,
        subscriptionStatus: u.subscriptions[0]?.status ?? "free",
      })),
    });
  });
}

/**
 * POST /api/admin/users — 管理员创建账号（可指定角色）。
 * 高危（可造 admin）→ requireAdminRole + assertSameOrigin + 审计。
 * 复用 signup 的密码强度校验（validatePasswordStrength）与哈希（hashPassword），不另起规则。
 * body: { nickname?, email?, phone?, password, role? }（email/phone 至少一项）。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const admin = await requireAdminRole();

    const body = (await req.json()) as {
      nickname?: unknown; email?: unknown; phone?: unknown; password?: unknown; role?: unknown;
    };
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const role = typeof body.role === "string" && body.role ? body.role : "user";

    if (!email && !phone) return fail("请提供邮箱或手机号");
    if (email && !email.includes("@")) return fail("邮箱格式不正确");
    // 复用与注册/改密同一套强度校验（≥8 位、含字母数字、非黑名单）。
    const weak = validatePasswordStrength(password);
    if (weak) return fail(weak);
    // 角色白名单：仅内置角色 + 普通 user，避免写入非法 role 造成越权判断异常。
    if (role !== "user" && !ALL_ROLES.includes(role)) return fail("非法角色");

    // 昵称净化（对齐 signup）：去控制字符 + trim + 截断。
    const cleanNickname = typeof body.nickname === "string"
      ? body.nickname.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 20)
      : "";
    const finalNickname = cleanNickname || (email ? email.split("@")[0] : `用户${phone.slice(-4)}`);

    // 唯一性预检（email/phone 各自 @unique；create 仍可能撞并发，兜底捕获在下）。
    if (email) {
      const dup = await prisma.user.findUnique({ where: { email } });
      if (dup) return fail("邮箱已被占用");
    }
    if (phone) {
      const dup = await prisma.user.findUnique({ where: { phone } });
      if (dup) return fail("手机号已被占用");
    }

    const user = await prisma.user.create({
      data: {
        email: email || null,
        phone: phone || null,
        nickname: finalNickname,
        role,
        passwordHash: hashPassword(password),
        profile: { create: {} },
      },
    });
    // 建积分账户 + 注册赠送（幂等，失败不阻断创建）。
    await ensureAccount(user.id).catch((e) => console.error("[admin:createUser:ensureAccount]", e));

    await audit({
      operatorId: admin.id,
      action: "user:create",
      targetType: "user",
      targetId: user.id,
      detail: JSON.stringify({ nickname: finalNickname, email: email || null, phone: phone || null, role }),
    }).catch(() => {});

    return ok({ id: user.id, nickname: user.nickname, email: user.email, phone: user.phone, role: user.role });
  });
}
