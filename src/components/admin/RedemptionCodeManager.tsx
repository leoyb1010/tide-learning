"use client";

import { useState, useCallback } from "react";
import { useToast } from "@/components/Toast";

interface CodeRow {
  id: string;
  code: string;
  batchId: string;
  type: "credits" | "membership";
  value: number;
  planId: string | null;
  maxUses: number;
  usedCount: number;
  status: "active" | "disabled";
  note: string | null;
  expiresAt: string | null;
  createdAt: string;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

const inputCls =
  "rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--ink3)]";

/**
 * 兑换码管理台：生成批次表单 + 列表（含已兑次数）+ 复制/导出 + 作废/启用。
 * 生成走 POST /api/admin/redemption-codes；列表 GET；作废/启用 PATCH /[id]。全走 STUDIO token。
 */
export function RedemptionCodeManager() {
  const { toast } = useToast();

  // —— 生成表单 ——
  const [type, setType] = useState<"credits" | "membership">("credits");
  const [value, setValue] = useState("");
  const [count, setCount] = useState("10");
  const [maxUses, setMaxUses] = useState("1");
  const [planId, setPlanId] = useState("");
  const [note, setNote] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [lastBatch, setLastBatch] = useState<{ batchId: string; codes: string[] } | null>(null);

  // —— 列表 ——
  const [codes, setCodes] = useState<CodeRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterBatch, setFilterBatch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (batchId = filterBatch, status = filterStatus) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (batchId.trim()) params.set("batchId", batchId.trim());
      if (status) params.set("status", status);
      const json = await fetch(`/api/admin/redemption-codes?${params.toString()}`).then((r) => r.json());
      if (json.ok) setCodes(json.data.codes as CodeRow[]);
      else toast(json.error ?? "加载失败", { tone: "warn" });
    } catch {
      toast("网络异常，请重试", { tone: "warn" });
    } finally {
      setLoading(false);
    }
  }, [filterBatch, filterStatus, toast]);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    const v = Number(value);
    const c = Number(count);
    const m = Number(maxUses);
    if (!Number.isInteger(v) || v <= 0) return toast("面值须为正整数", { tone: "warn" });
    if (!Number.isInteger(c) || c <= 0) return toast("生成数量须为正整数", { tone: "warn" });
    if (!Number.isInteger(m) || m <= 0) return toast("可兑换次数须为正整数", { tone: "warn" });
    setGenerating(true);
    try {
      const json = await fetch("/api/admin/redemption-codes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type, value: v, count: c, maxUses: m,
          planId: type === "membership" && planId.trim() ? planId.trim() : undefined,
          note: note.trim() || undefined,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        }),
      }).then((r) => r.json());
      if (json.ok) {
        setLastBatch({ batchId: json.data.batchId, codes: json.data.codes });
        toast(`已生成 ${json.data.count} 个兑换码`, { tone: "success" });
        setFilterBatch(json.data.batchId);
        load(json.data.batchId, "");
      } else {
        toast(json.error ?? "生成失败", { tone: "warn" });
      }
    } catch {
      toast("网络异常，请重试", { tone: "warn" });
    } finally {
      setGenerating(false);
    }
  }

  async function toggle(row: CodeRow) {
    const action = row.status === "active" ? "disable" : "enable";
    setBusyId(row.id);
    try {
      const json = await fetch(`/api/admin/redemption-codes/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      }).then((r) => r.json());
      if (json.ok) {
        setCodes((cs) => cs?.map((c) => (c.id === row.id ? { ...c, status: json.data.status } : c)) ?? null);
        toast(action === "disable" ? "已作废" : "已启用", { tone: "success" });
      } else {
        toast(json.error ?? "操作失败", { tone: "warn" });
      }
    } catch {
      toast("网络异常，请重试", { tone: "warn" });
    } finally {
      setBusyId(null);
    }
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${label}已复制`, { tone: "success" });
    } catch {
      toast("复制失败，请手动选择", { tone: "warn" });
    }
  }

  function exportCsv(batchId: string, list: string[]) {
    const csv = "code\n" + list.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${batchId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      {/* 生成表单 */}
      <form onSubmit={generate} className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)]">
        <p className="mb-3 text-[14px] font-semibold text-[var(--ink)]">批量生成</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[12px] text-[var(--ink3)]">
            类型
            <select value={type} onChange={(e) => setType(e.target.value as "credits" | "membership")} className={`${inputCls} w-[130px]`}>
              <option value="credits">积分</option>
              <option value="membership">会员天数</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-[var(--ink3)]">
            {type === "credits" ? "积分数" : "会员天数"}
            <input type="number" min={1} value={value} onChange={(e) => setValue(e.target.value)} placeholder={type === "credits" ? "如 500" : "如 30"} className={`${inputCls} mono w-[110px]`} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-[var(--ink3)]">
            生成数量
            <input type="number" min={1} value={count} onChange={(e) => setCount(e.target.value)} className={`${inputCls} mono w-[100px]`} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-[var(--ink3)]">
            每码可兑次数
            <input type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} className={`${inputCls} mono w-[110px]`} />
          </label>
          {type === "membership" && (
            <label className="flex flex-col gap-1 text-[12px] text-[var(--ink3)]">
              套餐 ID（可空=默认全站）
              <input value={planId} onChange={(e) => setPlanId(e.target.value)} placeholder="planId" className={`${inputCls} mono w-[160px]`} />
            </label>
          )}
          <label className="flex flex-col gap-1 text-[12px] text-[var(--ink3)]">
            过期时间（可空）
            <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className={`${inputCls} w-[150px]`} />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-[12px] text-[var(--ink3)]">
            备注（活动名等）
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="如 2026 暑期活动" className={`${inputCls} min-w-[160px]`} />
          </label>
          <button
            type="submit"
            disabled={generating}
            className="rounded-[10px] bg-[var(--ink)] px-4 py-2 text-[13px] font-semibold text-[var(--surface)] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {generating ? "生成中…" : "生成"}
          </button>
        </div>
      </form>

      {/* 刚生成的批次：一键复制全部 / 导出 CSV */}
      {lastBatch && (
        <div className="rounded-[16px] border border-[var(--ok-soft)] bg-[var(--ok-soft)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold text-[var(--ink)]">新批次 {lastBatch.codes.length} 个码</p>
              <p className="mono mt-0.5 text-[11px] text-[var(--ink3)]">批次 {lastBatch.batchId}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => copyText(lastBatch.codes.join("\n"), "全部码")} className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[12px] font-medium text-[var(--ink)] hover:border-[var(--ink3)]">复制全部</button>
              <button onClick={() => exportCsv(lastBatch.batchId, lastBatch.codes)} className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[12px] font-medium text-[var(--ink)] hover:border-[var(--ink3)]">导出 CSV</button>
            </div>
          </div>
          <div className="mono mt-3 max-h-[160px] overflow-y-auto rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3 text-[12px] leading-[1.7] text-[var(--ink2)]">
            {lastBatch.codes.map((c) => <div key={c}>{c}</div>)}
          </div>
        </div>
      )}

      {/* 列表筛选 */}
      <div className="flex flex-wrap items-center gap-2.5">
        <input value={filterBatch} onChange={(e) => setFilterBatch(e.target.value)} placeholder="按批次号筛选（可空）" className={`${inputCls} mono min-w-[220px] flex-1`} />
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={`${inputCls} w-[120px]`}>
          <option value="">全部状态</option>
          <option value="active">生效中</option>
          <option value="disabled">已作废</option>
        </select>
        <button onClick={() => load()} disabled={loading} className="rounded-[10px] bg-[var(--ink)] px-4 py-2 text-[13px] font-semibold text-[var(--surface)] transition-opacity hover:opacity-90 disabled:opacity-40">
          {loading ? "加载中…" : "查询"}
        </button>
      </div>

      {/* 列表 */}
      {codes === null ? (
        <p className="text-[13px] text-[var(--ink3)]">按批次号或状态查询已生成的兑换码。</p>
      ) : codes.length === 0 ? (
        <p className="text-[13px] text-[var(--ink3)]">无匹配兑换码。</p>
      ) : (
        <div className="overflow-x-auto rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card)]">
          <table className="w-full text-[13px]">
            <thead className="border-b border-[var(--border)] text-left text-[var(--ink4)]">
              <tr>
                <th className="px-3 py-2.5 font-medium">兑换码</th>
                <th className="px-3 py-2.5 font-medium">类型</th>
                <th className="px-3 py-2.5 font-medium">面值</th>
                <th className="px-3 py-2.5 font-medium">已兑/上限</th>
                <th className="px-3 py-2.5 font-medium">状态</th>
                <th className="px-3 py-2.5 font-medium">过期</th>
                <th className="px-3 py-2.5 font-medium">备注</th>
                <th className="px-3 py-2.5 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {codes.map((c) => (
                <tr key={c.id}>
                  <td className="mono px-3 py-2.5 text-[var(--ink)]">
                    <button onClick={() => copyText(c.code, "兑换码")} title="点击复制" className="hover:text-[var(--red)]">{c.code}</button>
                  </td>
                  <td className="px-3 py-2.5 text-[var(--ink2)]">{c.type === "credits" ? "积分" : "会员天数"}</td>
                  <td className="mono px-3 py-2.5 text-[var(--ink2)]">{c.value}{c.type === "membership" ? " 天" : ""}</td>
                  <td className="mono px-3 py-2.5 text-[var(--ink3)]">{c.usedCount}/{c.maxUses}</td>
                  <td className="px-3 py-2.5">
                    <span className={`mono inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${c.status === "active" ? "bg-[var(--ok-soft)] text-[var(--ok)]" : "bg-[var(--surface-inset)] text-[var(--ink3)]"}`}>
                      {c.status === "active" ? "生效" : "作废"}
                    </span>
                  </td>
                  <td className="mono px-3 py-2.5 text-[var(--ink3)]">{fmtDate(c.expiresAt)}</td>
                  <td className="max-w-[160px] truncate px-3 py-2.5 text-[var(--ink3)]" title={c.note ?? ""}>{c.note ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <button
                      onClick={() => toggle(c)}
                      disabled={busyId === c.id}
                      className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--ink)] transition-colors hover:border-[var(--ink3)] disabled:opacity-40"
                    >
                      {c.status === "active" ? "作废" : "启用"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
