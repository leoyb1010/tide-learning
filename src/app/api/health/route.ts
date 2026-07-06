import { prisma } from "@/lib/db";
import { ok, fail, handle } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — 存活 + DB 连通探针（P1-10）。
 * 执行一条 SELECT 1 验 DB 可达：通则 200 {ok:true}，DB 异常则 503 {ok:false}。
 * 供部署健康检查 / 负载均衡摘除故障实例用；force-dynamic 避免被静态缓存。
 */
export async function GET() {
  return handle(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      // DB 不可达：返回 503，让健康检查判定实例不健康（不泄露内部错误细节）
      return fail("数据库不可用", 503);
    }
    return ok({ ok: true });
  });
}
