import { cookies, headers } from "next/headers";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { ok, fail, handle } from "@/lib/api";

const SESSION_COOKIE = "tide_session";

/**
 * 是否「携带了会话凭证」——与 session.currentSessionId 的取值口径一致：
 * 优先 Authorization: Bearer <sid>（iOS/原生），回退 tide_session cookie（Web）。
 * 仅判「有没有带凭证」，不判有效性（有效性交由 getCurrentUser）。
 */
async function hasSessionCredential(): Promise<boolean> {
  const h = await headers();
  const auth = h.get("authorization");
  if (auth?.startsWith("Bearer ") && auth.slice(7).trim()) return true;
  const cookieStore = await cookies();
  return Boolean(cookieStore.get(SESSION_COOKIE)?.value);
}

/**
 * GET /api/auth/me —— 当前登录态 + 权益快照。
 *
 * 语义（流2-U1b 契约补齐，区分「无凭证的游客」与「坏凭证」）：
 *   - 已登录（凭证有效）：200 { user, entitlement }。
 *   - 无凭证（Web 未登录游客，压根没带 cookie/Bearer）：200 { user:null, entitlement:null }。
 *     保持 Web 匿名浏览行为不变——review 页依赖 200{data.user:null} 判「需登录」，不新增控制台报错。
 *   - 坏凭证（带了 cookie/Bearer 但会话失效/过期/用户已删）：401 { ok:false }。
 *     iOS AuthManager.bootstrap 仅在有 token 时才调本接口，坏 token 走 401 → isAuthExpired
 *     → logoutLocal 清掉死 token（修「过期 token 永不失效」）。Web 带旧 cookie 命中 401 时，
 *     fetch 不抛错、.json() 得 {ok:false} → !me?.data?.user 仍为 true → 照常判「需登录」，行为不破。
 *
 * 决策依据：Web（src/app/review/page.tsx L84/L393）读的是 me.data?.user，对 200/401 均能收敛为
 *   「需登录」，故只把「带了坏凭证」这一类升级为 401；「完全没带凭证」的匿名态维持 200 不变，
 *   风险最低且真正修好 iOS 侧死 token 清理。
 */
export async function GET() {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) {
      // 带了凭证却拿不到用户 → 坏 token，401 让原生端清理死 token。
      if (await hasSessionCredential()) return fail("登录状态已失效，请重新登录", 401);
      // 压根没带凭证 → 匿名游客，保持 Web 既有 200{user:null} 行为。
      return ok({ user: null, entitlement: null });
    }
    const entitlement = await resolveEntitlement(user.id);
    return ok({
      user: { id: user.id, nickname: user.nickname, email: user.email, phone: user.phone, role: user.role },
      entitlement,
    });
  });
}
