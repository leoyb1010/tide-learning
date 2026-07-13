import { NextResponse, NextRequest } from "next/server";
import { AuthError } from "./session";
import { RateLimitError } from "./rate-limit";
import { AppError } from "./errors";

// AppError 抽到零依赖的 errors.ts（供 client 侧安全 import）；此处 re-export 保持既有引用兼容。
export { AppError };

/**
 * 日志目录：env LOG_DIR 可配（部署时指向持久卷），默认 <cwd>/logs。
 * persistInternalError 与 /admin/errors 页必须读同一目录，统一从这里取。
 * 不引 node:path（简单拼接足够），保持本模块被 client 侧 import 时不拖 node 内置模块。
 */
export function getLogDir(): string {
  return process.env.LOG_DIR || `${process.cwd()}/logs`;
}

/**
 * 500 错误结构化落盘（流3-U6 · 契约防断裂制度）。
 * 追加写 logs/api-errors-YYYY-MM-DD.jsonl，一行一条 {ts,path?,message,stack}，
 * 供 /admin/errors 页查看。仅服务端调用（node fs），且完全「尽力而为」：
 * 目录不存在则建，任何写失败都吞掉，绝不影响正常错误响应。
 *
 * 轮转/保留（审计 2026-07-12 P2-15）：此前单日文件无上限、旧文件永不清理。现补：
 *   - 单文件超 LOG_MAX_FILE_BYTES 即滚存为 .1（覆盖上一份），当日重新起写 → 单日磁盘上限 ≈ 2×上限；
 *   - 按 LOG_RETAIN_DAYS 保留近若干天，超期文件清理（每小时至多扫一次目录，避免每条 500 都 readdir）。
 */
const LOG_MAX_FILE_BYTES = 5 * 1024 * 1024; // 单文件 5MB 上限
const LOG_RETAIN_DAYS = 14; // 保留近 14 天
let lastLogSweepAt = 0; // 目录清理节流水位（模块级）

async function persistInternalError(e: unknown): Promise<void> {
  try {
    // 动态 import，避免把 node:fs 拖进任何可能被 client 侧 import 的路径。
    const { appendFile, mkdir, stat, rename, readdir, unlink } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const now = new Date();
    const day = now.toISOString().slice(0, 10); // YYYY-MM-DD（UTC；与 /admin/errors 同口径）
    const dir = getLogDir();
    await mkdir(dir, { recursive: true });
    const file = join(dir, `api-errors-${day}.jsonl`);

    // 轮转：当前文件超上限则滚存为 .1（覆盖旧滚存），随后当日从空文件重新累积。
    try {
      const st = await stat(file);
      if (st.size >= LOG_MAX_FILE_BYTES) {
        await rename(file, join(dir, `api-errors-${day}.1.jsonl`)).catch(() => {});
      }
    } catch {
      /* 文件尚不存在：无需轮转 */
    }

    const entry = {
      ts: now.toISOString(),
      message: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack ?? null : null,
    };
    await appendFile(file, JSON.stringify(entry) + "\n", "utf8");

    // 保留期清理（每小时至多一次）：删掉超过 LOG_RETAIN_DAYS 的 api-errors-*.jsonl。
    if (now.getTime() - lastLogSweepAt > 3_600_000) {
      lastLogSweepAt = now.getTime();
      try {
        const cutoff = now.getTime() - LOG_RETAIN_DAYS * 864e5;
        const files = await readdir(dir);
        for (const f of files) {
          const m = f.match(/^api-errors-(\d{4}-\d{2}-\d{2})(?:\.\d+)?\.jsonl$/);
          if (!m) continue;
          const fileDay = Date.parse(m[1] + "T00:00:00Z");
          if (Number.isFinite(fileDay) && fileDay < cutoff) {
            await unlink(join(dir, f)).catch(() => {});
          }
        }
      } catch {
        /* 清理失败无所谓，下轮再试 */
      }
    }
  } catch {
    // 落盘失败（只读文件系统 / 权限 / 磁盘满等）绝不能影响响应——静默吞掉。
  }
}

export function ok(data: unknown, init?: number) {
  return NextResponse.json({ ok: true, data }, { status: init ?? 200 });
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/** 统一异常处理（§19 技术验收 + A1-6 安全错误折叠）。 */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AuthError) return fail(e.message, e.status);
    if (e instanceof RateLimitError) {
      const res = fail(e.message, e.status);
      res.headers.set("Retry-After", String(e.retryAfterSec));
      return res;
    }
    if (e instanceof AppError) return fail(e.message, e.status);
    // 畸形请求体（req.json() 解析失败抛 SyntaxError）：客户端错误，收敛为 400 而非 500
    if (e instanceof SyntaxError) return fail("请求体格式错误", 400);
    // 其余：记录服务端日志，返回通用文案，避免泄露数据结构 / 配置
    console.error("[api:internal]", e instanceof Error ? e.stack ?? e.message : e);
    // 结构化落盘（尽力而为，不 await —— 绝不阻塞/影响响应）。
    void persistInternalError(e);
    return fail("服务异常，请稍后再试", 500);
  }
}

/**
 * A2：对写操作做同源校验（轻量 CSRF 防护，配合 sameSite=strict cookie）。
 * 校验 Origin/Referer 与目标 Host 一致；不一致直接拒绝。
 */
export function assertSameOrigin(req: NextRequest) {
  // 原生 App：携带 Authorization: Bearer 的请求天然防 CSRF（token 不会被浏览器自动附带），放行。
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return;
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin) return; // 同源导航式请求可能无 origin，放行（GET 已被路由方法限制）
  try {
    const o = new URL(origin);
    if (host && o.host !== host) throw new AppError("跨域请求被拒绝", 403);
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("非法请求来源", 403);
  }
}
