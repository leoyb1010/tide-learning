import { redirect } from "next/navigation";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { getCurrentUser } from "@/lib/session";
import { Badge, EmptyState } from "@/components/ui";

export const metadata = { title: "500 错误日志" };

// 一页展示的最大条数（近 N 条）。
const MAX_ROWS = 200;

type ErrLog = { ts: string; message: string; stack: string | null };

/**
 * 读取当天 logs/api-errors-YYYY-MM-DD.jsonl，解析为结构化条目。
 * 纯服务端（server component）直接读文件。文件不存在 / 解析失败均安全降级为空。
 */
async function readTodayErrors(): Promise<{ day: string; rows: ErrLog[]; totalToday: number; available: string[] }> {
  const dir = join(process.cwd(), "logs");
  const day = new Date().toISOString().slice(0, 10);
  const file = join(dir, `api-errors-${day}.jsonl`);

  let available: string[] = [];
  try {
    const names = await readdir(dir);
    available = names
      .filter((n) => /^api-errors-\d{4}-\d{2}-\d{2}\.jsonl$/.test(n))
      .map((n) => n.replace(/^api-errors-|\.jsonl$/g, ""))
      .sort()
      .reverse();
  } catch {
    // logs 目录尚不存在（还没发生过 500）——正常情况。
  }

  let rows: ErrLog[] = [];
  try {
    const content = await readFile(file, "utf8");
    rows = content
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        try {
          const o = JSON.parse(l);
          return {
            ts: typeof o.ts === "string" ? o.ts : "",
            message: typeof o.message === "string" ? o.message : String(o.message ?? ""),
            stack: typeof o.stack === "string" ? o.stack : null,
          } as ErrLog;
        } catch {
          return null;
        }
      })
      .filter((x): x is ErrLog => x !== null);
  } catch {
    rows = [];
  }

  const totalToday = rows.length;
  // 最新在前，截断到 MAX_ROWS。
  rows = rows.reverse().slice(0, MAX_ROWS);
  return { day, rows, totalToday, available };
}

export default async function AdminErrorsPage() {
  // 页级鉴权：错误日志含堆栈（潜在敏感），仅超级管理员可看。
  // layout 已保证是后台角色，此处再收窄到 admin。
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/errors");
  if (user.role !== "admin") redirect("/admin");

  const { day, rows, totalToday, available } = await readTodayErrors();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-bold text-[var(--ink)]">500 错误日志</h1>
        <p className="mt-1 text-[13px] text-[var(--ink3)]">
          未被业务错误捕获的服务端异常（handle() 500 分支）会结构化落盘到{" "}
          <code className="rounded bg-[var(--surface2)] px-1 py-0.5 text-[12px]">logs/api-errors-{day}.jsonl</code>。
          此页读取当天日志，最新在前，最多 {MAX_ROWS} 条。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3">
          <p className="text-[12px] text-[var(--ink4)]">今日 500 总数</p>
          <p className={`text-2xl font-bold tabular ${totalToday > 0 ? "text-[var(--red)]" : "text-[var(--ink)]"}`}>
            {totalToday}
          </p>
        </div>
        {available.length > 0 && (
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3">
            <p className="text-[12px] text-[var(--ink4)]">有日志的日期</p>
            <p className="mono text-[13px] text-[var(--ink2)]">{available.slice(0, 7).join(" · ")}</p>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState title="今日无 500 错误" hint="服务端未捕获异常会显示在这里。当前一切正常。" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--line)] text-left text-[var(--ink4)]">
              <tr>
                <th className="px-4 py-3 whitespace-nowrap">时间</th>
                <th className="px-4 py-3">错误信息 / 堆栈</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {rows.map((r, i) => {
                const timeText = r.ts && !Number.isNaN(Date.parse(r.ts))
                  ? new Date(r.ts).toLocaleString("zh-CN")
                  : r.ts || "—";
                return (
                  <tr key={i} className="align-top">
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-[var(--ink4)]">{timeText}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-2">
                        <Badge tone="error">500</Badge>
                        <span className="font-medium text-[var(--ink)]">{r.message || "（无 message）"}</span>
                      </div>
                      {r.stack && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-[var(--ink4)] hover:text-[var(--ink2)]">
                            展开堆栈
                          </summary>
                          <pre className="mono mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--surface2)] p-3 text-[11px] leading-relaxed text-[var(--ink3)]">
                            {r.stack}
                          </pre>
                        </details>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
