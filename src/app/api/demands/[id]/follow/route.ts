import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { track } from "@/lib/analytics";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// POST /api/demands/:id/follow — 关注（幂等）
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    assertRateLimit(req, `demand-follow:${user.id}`, 20, 60_000);
    const { id } = await params;

    const demand = await prisma.demand.findUnique({ where: { id }, select: { id: true } });
    if (!demand) return fail("需求不存在", 404);

    // upsert 保证幂等：已关注不报错。
    await prisma.demandFollow.upsert({
      where: { demandId_userId: { demandId: id, userId: user.id } },
      create: { demandId: id, userId: user.id },
      update: {},
    });

    const followerCount = await prisma.demandFollow.count({ where: { demandId: id } });
    await track({
      eventName: "demand_follow",
      userId: user.id,
      properties: { demand_id: id, action: "follow" },
    });

    return ok({ following: true, followerCount });
  });
}

// DELETE /api/demands/:id/follow — 取关（幂等）
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    assertRateLimit(req, `demand-follow:${user.id}`, 20, 60_000);
    const { id } = await params;

    // deleteMany：不存在时不抛错，天然幂等。
    await prisma.demandFollow.deleteMany({ where: { demandId: id, userId: user.id } });

    const followerCount = await prisma.demandFollow.count({ where: { demandId: id } });
    await track({
      eventName: "demand_follow",
      userId: user.id,
      properties: { demand_id: id, action: "unfollow" },
    });

    return ok({ following: false, followerCount });
  });
}
