import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * POST /api/devices — 注册 APNs 推送设备（iOS）。
 * 入参：{ token, platform? }。token 唯一，upsert：已存在则改绑到当前 userId 并更新时间戳。
 * DELETE /api/devices — 注销设备。入参：{ token }。仅删当前用户名下该 token（where userId 越权隔离）。
 * 均需 requireUser + assertSameOrigin。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();

    const body = (await req.json().catch(() => null)) as
      | { token?: string; platform?: string }
      | null;
    const token = (body?.token ?? "").trim();
    const platform = (body?.platform ?? "ios").trim() || "ios";
    if (!token) return fail("缺少 token");

    // upsert by token：换绑到当前用户（跨账号复用同一设备时把设备归到最新登录用户）
    const device = await prisma.device.upsert({
      where: { token },
      create: { token, platform, userId: user.id },
      update: { userId: user.id, platform },
      select: { id: true, platform: true },
    });

    return ok({ registered: true, deviceId: device.id, platform: device.platform });
  });
}

export async function DELETE(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();

    const body = (await req.json().catch(() => null)) as { token?: string } | null;
    const token = (body?.token ?? "").trim();
    if (!token) return fail("缺少 token");

    // 越权铁律：只删当前用户名下的设备；幂等（不存在也返回成功）
    await prisma.device.deleteMany({ where: { token, userId: user.id } });

    return ok({ unregistered: true });
  });
}
