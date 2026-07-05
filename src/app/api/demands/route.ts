import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, getCurrentUser } from "@/lib/session";
import { listRankedDemands } from "@/lib/queries";
import { track } from "@/lib/analytics";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { TRACK_MAP } from "@/lib/tracks";

const DEMAND_TITLE_MAX = 80;
const DEMAND_DESC_MAX = 2000;
const DEMAND_DEPTHS = new Set(["intro", "advanced", "mastery"]);

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
    assertSameOrigin(req); // A2：写操作 CSRF 防护
    const user = await requireUser();
    const body = (await req.json()) as {
      title: string;
      description?: string;
      category?: string;
      desiredDepth?: string;
    };
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return fail("请填写需求标题");
    if (title.length > DEMAND_TITLE_MAX) return fail(`标题最多 ${DEMAND_TITLE_MAX} 字`);
    const description = typeof body.description === "string" ? body.description.trim() : undefined;
    if (description && description.length > DEMAND_DESC_MAX) return fail(`描述最多 ${DEMAND_DESC_MAX} 字`);
    // 分类/深度白名单：防任意字符串入库污染赛道统计
    const category = body.category ?? "ai_skill";
    if (!TRACK_MAP[category]) return fail("分类不存在");
    const desiredDepth = body.desiredDepth ?? "intro";
    if (!DEMAND_DEPTHS.has(desiredDepth)) return fail("深度取值不合法");
    const demand = await prisma.demand.create({
      data: {
        userId: user.id,
        title,
        description,
        category,
        desiredDepth,
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
