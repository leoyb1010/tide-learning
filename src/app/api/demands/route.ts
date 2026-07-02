import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, getCurrentUser } from "@/lib/session";
import { listRankedDemands } from "@/lib/queries";
import { track } from "@/lib/analytics";
import { ok, fail, handle } from "@/lib/api";

// GET /api/demands?status=
export async function GET(req: NextRequest) {
  return handle(async () => {
    const status = req.nextUrl.searchParams.get("status");
    const demands = await listRankedDemands(
      status ? [status] : undefined,
    );
    return ok({ demands });
  });
}

// POST /api/demands — 提交需求（进入待审核）
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = (await req.json()) as {
      title: string;
      description?: string;
      category?: string;
      desiredDepth?: string;
    };
    if (!body.title?.trim()) return fail("请填写需求标题");
    const demand = await prisma.demand.create({
      data: {
        userId: user.id,
        title: body.title.trim(),
        description: body.description,
        category: body.category ?? "ai_skill",
        desiredDepth: body.desiredDepth ?? "intro",
        status: "pending_review",
      },
    });
    await prisma.demandStatusLog.create({
      data: { demandId: demand.id, toStatus: "pending_review", operatorId: user.id, reason: "用户提交" },
    });
    await track({
      eventName: "demand_submit",
      userId: user.id,
      properties: { category: demand.category, depth: demand.desiredDepth },
    });
    return ok(demand);
  });
}
