import { ok, handle } from "@/lib/api";
import { getVersionPayload } from "@/lib/version";

export const dynamic = "force-dynamic";

/**
 * GET /api/version —— 版本 / 构建溯源（P1-2）。
 * 返回 commit / branch / builtAt / Next buildId / 进程启动时间 / NODE_ENV / DB 库文件名，
 * 用于证明 3100 上运行的构建来自哪个 commit（消除「运行版本不可追踪」）。
 * 不含任何密钥（DATABASE_URL 仅回传 basename）。force-dynamic 防静态缓存。
 */
export async function GET() {
  return handle(async () => ok(await getVersionPayload()));
}
