"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button } from "@/components/ui";

type Item = { id: string; reservationId: string; userId: string; scene: string; reasonCode: string; providerStatus: number | null; status: string; createdAt: string };

export function BillingReconciliationQueue() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/admin/billing/reconciliation?status=pending", { cache: "no-store" });
      const json = await res.json() as { ok?: boolean; data?: { items?: Item[] }; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || "读取对账队列失败");
      setItems(json.data?.items ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "读取对账队列失败"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function resolve(id: string, status: "resolved" | "waived") {
    const reason = window.prompt(status === "resolved" ? "请输入核验依据（至少 8 个字符）" : "请输入豁免原因（至少 8 个字符）", "已核对供应商账单与内部预占记录");
    if (!reason?.trim()) return;
    setBusy(id);
    try {
      const res = await fetch("/api/admin/billing/reconciliation", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, status, reason }) });
      const json = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || "处理失败");
      setItems((current) => current.filter((item) => item.id !== id));
    } catch (e) { setError(e instanceof Error ? e.message : "处理失败"); }
    finally { setBusy(""); }
  }

  if (loading) return <div className="rounded-2xl border border-ink-100 bg-paper-raised p-6 text-sm text-ink-400" aria-busy="true">正在读取对账队列…</div>;
  if (error) return <div className="rounded-2xl border border-error/20 bg-error/[0.04] p-6 text-sm text-error">{error} <button className="ml-2 underline" onClick={() => void load()}>重试</button></div>;
  if (items.length === 0) return <div className="rounded-2xl border border-success/20 bg-success/[0.04] p-8 text-center"><p className="font-medium text-success">对账队列已清空</p><p className="mt-1 text-sm text-ink-400">没有待处理的供应商用量记录。</p></div>;

  return (
    <div className="overflow-hidden rounded-2xl border border-warning/30 bg-paper-raised">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 bg-warning/5 px-5 py-4"><div><p className="font-medium text-ink-950">待处理 {items.length} 条</p><p className="mt-1 text-xs text-ink-400">先核对供应商账单，再标记已解决或豁免。</p></div><Badge tone="warning">需要财务处理</Badge></div>
      <div className="divide-y divide-ink-100">
        {items.map((item) => (
          <article key={item.id} className="space-y-3 px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium text-ink-950">{item.scene}</p><p className="mt-1 text-xs text-ink-400">{item.reasonCode} · {new Date(item.createdAt).toLocaleString("zh-CN")} · 用户 {item.userId.slice(0, 10)}…</p></div><Badge tone="muted">{item.providerStatus ? `HTTP ${item.providerStatus}` : "供应商超时"}</Badge></div>
            <p className="break-all rounded-lg bg-ink-50 px-3 py-2 font-mono text-[11px] text-ink-500">reservation: {item.reservationId}</p>
            <div className="flex flex-wrap gap-2"><Button size="sm" loading={busy === item.id} disabled={Boolean(busy)} onClick={() => void resolve(item.id, "resolved")}>核验后标记已解决</Button><Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => void resolve(item.id, "waived")}>记录豁免</Button></div>
          </article>
        ))}
      </div>
    </div>
  );
}
