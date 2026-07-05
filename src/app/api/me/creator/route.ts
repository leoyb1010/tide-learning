import { requireUser } from "@/lib/session";
import { ok, handle } from "@/lib/api";
import { getCreatorDashboard } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/me/creator —— 创作者中心数据（流2·U4-a，requireUser，任何登录用户看**自己**的收益）。
 *
 * 返回当前用户「作为作者」的收益看板：
 *   - totalIncome：累计售课收益（积分，course_sale_income 流水 delta 求和，与账本一致）。
 *   - totalSales：累计付费成交笔数（Course.salesCount 求和）。
 *   - courses：每门在架课的 { id, slug, title, salesCount, priceCredits, incomeCredits, rating, reviewCount }。
 *   - recentSales：近期 course_sale_income 流水（含课程标题，供「近期成交」时间线展示）。
 *
 * 复用铁律：数据组装复用 queries.ts::getCreatorDashboard（内部复用 credit-trade.ts::getAuthorEarnings
 *   求和，不重写交易逻辑），Web 页 /me/creator 与本路由共用同一函数，字段语义一致。
 *
 * 越权铁律：requireUser 得出当前用户，getCreatorDashboard(user.id) 内部所有查询恒 where userId=本人，
 *   无任何 ?userId 之类旁路，任何入参都无法看到他人收益。无需 LLM 权益（纯读本人数据）。
 */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const dashboard = await getCreatorDashboard(user.id);
    return ok(dashboard);
  });
}
