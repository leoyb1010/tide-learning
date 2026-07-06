import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { track } from "@/lib/analytics";
import { ok, handle } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";

/**
 * P1-7：eventName 基本校验。
 * 客户端埋点词表分散在 ~30 个组件里且持续演进（见 analytics-client.ts 各调用点），
 * 硬穷举白名单会误丢真实埋点、成为维护负担；这里改为「长度 + 字符集」校验丢弃明显异常：
 * 只放行小写字母/数字/下划线、1-64 长度的事件名（覆盖现有全部埋点命名规范），
 * 拦掉超长串、注入式字符、乱码等匿名滥写。配合入口限流，堵住匿名无限写库。
 */
const EVENT_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;

// POST /api/analytics — 客户端埋点上报（§10 埋点 SDK 包装层）
export async function POST(req: NextRequest) {
  return handle(async () => {
    // 限流：匿名亦可上报，按 IP 限每分钟 60 次，堵住无限写库
    assertRateLimit(req, "analytics", 60, 60_000);
    const user = await getCurrentUser();
    const { eventName, properties, anonymousId, platform } = (await req.json()) as {
      eventName: string;
      properties?: Record<string, unknown>;
      anonymousId?: string;
      platform?: string;
    };
    // 非法/缺失 eventName 一律静默忽略、不写库（返回 ok 不暴露校验细节）
    if (!eventName || typeof eventName !== "string" || !EVENT_NAME_RE.test(eventName)) {
      return ok({ tracked: false });
    }
    await track({ eventName, userId: user?.id, anonymousId, properties, platform });
    return ok({ tracked: true });
  });
}
