/**
 * 进程内 in-flight 锁 —— 造课 / 导入端点级幂等（P2）。
 *
 * 同一用户同一时刻只允许一个未完成的 generate-course / import-source 请求，
 * 防止双击 / 重放导致并发建两门课、双份大纲扣费。仅进程内（Map），单实例部署足够；
 * 多实例时退化为「每实例各一把锁」，仍显著收敛并发面。
 * 带时间戳 TTL 兜底：异常路径未释放（如进程内未捕获错误）时 10 分钟后自动失效，不会永久锁死。
 */

const inflight = new Map<string, number>(); // key: `${scope}:${userId}` → 加锁时间戳

/** 兜底 TTL：超过此时长视为遗留锁，允许重新加锁。 */
const INFLIGHT_TTL_MS = 10 * 60_000;

/** 尝试加锁：该用户在此 scope 已有未完成请求则返回 false（调用方应 409）。 */
export function acquireInflight(scope: string, userId: string): boolean {
  const key = `${scope}:${userId}`;
  const at = inflight.get(key);
  if (at !== undefined && Date.now() - at < INFLIGHT_TTL_MS) return false;
  inflight.set(key, Date.now());
  return true;
}

/** 释放锁（务必放 finally，成功 / 抛错都要释放）。 */
export function releaseInflight(scope: string, userId: string): void {
  inflight.delete(`${scope}:${userId}`);
}
