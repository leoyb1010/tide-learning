import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, verifyPassword, destroySession } from "@/lib/session";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";
import { track } from "@/lib/analytics";

export const dynamic = "force-dynamic";

/**
 * POST /api/account/delete — 注销账号（App Store 5.1.1(v) 要求可在 App 内删号）。
 * 入参：{ password }。
 * 校验：同源(CSRF) + 登录态 + 限流 + 当前密码正确。
 * 处理：软删 user（deletedAt=now）+ 吊销该用户全部会话（含当前 cookie 会话）。
 *   - 软删而非硬删：保留订单/审计等关联数据；getCurrentUser 已对 deletedAt!=null 返回 null，
 *     login 也拒绝 deletedAt 账号，故软删后即不可再登录。
 * 第三方登录账号（authProvider!=password 或无 passwordHash）无本地密码，走原渠道，此处拒绝。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    assertRateLimit(req, `account-delete:${user.id}`, 5, 60_000);

    const body = (await req.json().catch(() => null)) as { password?: string } | null;
    const password = (body?.password ?? "").trim();
    if (!password) return fail("请输入密码以确认注销");

    if (user.authProvider !== "password" || !user.passwordHash) {
      return fail("第三方登录账号请通过原渠道注销");
    }
    if (!verifyPassword(password, user.passwordHash)) {
      return fail("密码不正确");
    }

    // 越权铁律：where userId
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
      // 吊销全部会话，立即失效所有端登录态
      await tx.session.deleteMany({ where: { userId: user.id } });
    });

    // 清理当前浏览器的 cookie 会话（Bearer 端无 cookie，无副作用）
    await destroySession();

    await track({ eventName: "account_delete", userId: user.id });

    return ok({ deleted: true });
  });
}
