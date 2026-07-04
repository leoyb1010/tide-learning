import { requireUser } from "@/lib/session";
import { getMyShelf } from "@/lib/shelf";
import { ok, handle } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/shelf —— 按需拉取当前用户的书架（五个分类课）。
 *
 * 设计取舍：书桌首屏不带书架数据（避免拖慢 SSR），书架弹层（DeskShelf）打开时
 * 才 fetch 本接口按需拉全量。纯读接口，走 requireUser 强制登录 + 越权隔离
 * （getMyShelf 内部所有查询 where userId，只返回该用户自己的书架）。
 *
 * 返回：{ ok:true, data: { shelf: MyShelf, total: number } }。
 * total = 五类课去重后的总册数（供书桌入口角标与弹层标题使用）。
 */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const shelf = await getMyShelf(user.id);
    const total =
      shelf.ai_created.length +
      shelf.imported.length +
      shelf.learning.length +
      shelf.collected.length +
      shelf.completed.length;
    return ok({ shelf, total });
  });
}
