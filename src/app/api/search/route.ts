import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { ok, handle } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";
import { searchAll } from "@/lib/search";
import { track } from "@/lib/analytics";

export const dynamic = "force-dynamic";

// 每域返回上限：默认 5，客户端可传 limit 覆盖（在 search lib 内钳制到 [1,10]）。
const PER_DOMAIN_DEFAULT = 5;

/**
 * GET /api/search?q=xxx&limit=n —— 五域联搜（courses/notes/posts/market/demands）。
 *
 * 权限：getCurrentUser()（可空，游客可搜公开域）。notes 域越权铁律在 searchAll 内落实
 *      （严格 where userId=当前用户；未登录返空）。其余域按各自公开口径过滤。
 *
 * 限流：按 IP，search 30 次 / 60s（复用 assertRateLimit 模式，与 note_search 同量级），
 *      拦搜索接口被当枚举/爬虫刷。
 *
 * 空 q：不查库，直接返回空结果（前端此时展示快捷动作/最近访问，不打搜索）。
 *
 * 响应：{ ok, data: { results: [{type,id,title,snippet,href,meta?}], counts: {course,note,post,market,demand} } }
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    assertRateLimit(req, "search", 30, 60_000);

    const sp = req.nextUrl.searchParams;
    const q = sp.get("q")?.trim() ?? "";

    // limit：非法/缺省回落默认；search lib 内再钳制上限，双保险。
    const limitRaw = Number.parseInt(sp.get("limit") ?? "", 10);
    const perDomain = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : PER_DOMAIN_DEFAULT;

    // 空查询短路：返回空结果的联搜信封，前端据此显示快捷动作。
    if (!q) {
      return ok({
        results: [],
        counts: { course: 0, note: 0, post: 0, market: 0, demand: 0 },
      });
    }

    const user = await getCurrentUser();
    const data = await searchAll(q, user?.id ?? null, perDomain);

    // 埋点（尽力而为，不阻塞响应）：只记查询长度与命中总数，不落原始 q（隐私）。track 内部已吞异常。
    void track({
      eventName: "search",
      userId: user?.id ?? null,
      properties: { q_len: q.length, total: data.results.length },
    });

    return ok(data);
  });
}
