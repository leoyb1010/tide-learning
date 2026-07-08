import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, getCurrentUser } from "@/lib/session";
import { listRankedDemands } from "@/lib/queries";
import { track } from "@/lib/analytics";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { TRACK_MAP } from "@/lib/tracks";
import { weekKey, WEEKLY_VOTE_BUDGET } from "@/lib/week";
import { assessDemandRisk } from "@/lib/demand-score";

const DEMAND_TITLE_MAX = 80;
const DEMAND_DESC_MAX = 2000;
const DEMAND_DEPTHS = new Set(["intro", "advanced", "mastery"]);

// GET /api/demands?status=
// 契约补齐（流2-U1b）：列表每条附 votedByMe（当前用户是否已投过该需求），
// 顶层附 remainingVotes（本周剩余票额，语义与 /vote、/me/voted 完全一致）。
// 越权铁律：投票查询严格 where userId=当前用户；游客（未登录）votedByMe 恒 false、remainingVotes=0。
export async function GET(req: NextRequest) {
  return handle(async () => {
    const status = req.nextUrl.searchParams.get("status");
    const demands = await listRankedDemands(
      status ? [status] : undefined,
    );

    // 当前用户的投票态：votedByMe 逐条标注 + remainingVotes 全局剩余票额。
    const user = await getCurrentUser();
    let remainingVotes = 0;
    // 我投过的 demandId 集合（votedByMe 判据；跨周任意一票即视为已投过该需求）。
    let votedDemandIds = new Set<string>();
    if (user) {
      // 一次拉齐当前用户全部投票行：既得「我投过哪些需求」，又能按本周聚合算剩余票额。
      const myVotes = await prisma.demandVote.findMany({
        where: { userId: user.id },
        select: { demandId: true, voteCount: true, weekKey: true },
      });
      votedDemandIds = new Set(myVotes.map((v) => v.demandId));
      const wk = weekKey();
      const usedThisWeek = myVotes
        .filter((v) => v.weekKey === wk)
        .reduce((s, v) => s + v.voteCount, 0);
      remainingVotes = Math.max(0, WEEKLY_VOTE_BUDGET - usedThisWeek);
    }

    const enriched = demands.map((d) => ({
      ...d,
      votedByMe: votedDemandIds.has(d.id),
    }));

    return ok({ demands: enriched, remainingVotes });
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
    // P2-3：提交阶段做风险初评（XSS 载荷 / 外链 / 导流联系方式），写入 riskLevel，
    // 让审核队列拿到正确优先级（此前恒为默认 low，恶意导流也被当低危）。
    const riskLevel = assessDemandRisk(title, description);
    const demand = await prisma.demand.create({
      data: {
        userId: user.id,
        title,
        description,
        category,
        desiredDepth,
        status: "pending_review",
        riskLevel,
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
