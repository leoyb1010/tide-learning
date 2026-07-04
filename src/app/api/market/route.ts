import { NextRequest } from "next/server";
import { ok, handle } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { buildMarketStalls } from "@/lib/market-data";
import { sortStalls, type MarketSort } from "@/lib/market-view";

export const dynamic = "force-dynamic";

/**
 * GET /api/market —— 课程集市顶层数据（iOS 集市主路径）。
 *
 * 与 Web /market 页共用同一份组装逻辑（src/lib/market-data.ts::buildMarketStalls），
 * 字段/语义完全一致，iOS 直接按此解码。
 *
 * 数据：sharedStatus="shared" 的用户造课 → 摊位数组。
 *   collectCount = 去重学习用户数，**排除作者本人**（与 collect 端点、Web 集市页一致）。
 * 越权：getCurrentUser()（可空，游客也能看集市）→ collectedByMe/mine 严格 where userId=当前用户。
 * 排序：?sort=hot（默认，最热=collectCount desc）| newest / new（最新=createdAtMs desc）。
 *
 * 返回：ok({ items: MarketStall[] })。
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    // 游客可看集市：user 为 null 时 collectedByMe/mine 恒 false，不报错。
    const user = await getCurrentUser();

    const stalls = await buildMarketStalls(user?.id ?? null);

    // 排序：接受 hot / newest / new；非法值回落最热（与 Web 交易市场默认一致）。
    const raw = req.nextUrl.searchParams.get("sort");
    const sort: MarketSort = raw === "newest" || raw === "new" ? "new" : "hot";
    const items = sortStalls(stalls, sort);

    return ok({ items });
  });
}
