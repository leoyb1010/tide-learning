"use client";

import { useEffect, useState } from "react";
import { LoadingSkeleton, ErrorState, Badge } from "@/components/ui";
import { DEMAND_STATUS } from "@/lib/format";

interface AdminDemand {
  id: string; title: string; description: string | null; category: string; status: string;
  riskLevel: string; officialReply: string | null; _count: { votes: number }; user: { nickname: string };
}

const NEXT_STATUS: Record<string, string[]> = {
  pending_review: ["collecting", "rejected", "merged"],
  collecting: ["evaluating", "rejected"],
  evaluating: ["scheduled", "rejected"],
  scheduled: ["producing"],
  producing: ["launched"],
};

export function AdminDemandManager() {
  const [demands, setDemands] = useState<AdminDemand[] | null>(null);
  const [error, setError] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  async function load() {
    setError(false);
    try {
      const json = await fetch("/api/admin/demands/pending").then((r) => r.json());
      if (!json.ok) throw new Error();
      setDemands(json.data.demands);
    } catch { setError(true); }
  }
  useEffect(() => { load(); }, []);

  if (error) return <ErrorState hint="需求加载失败" onRetry={load} />;
  if (demands === null) return <LoadingSkeleton lines={6} />;

  return (
    <div className="space-y-2">
      {demands.map((d) => (
        <div key={d.id} className="rounded-2xl border border-ink-100 bg-paper-raised p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink-950">{d.title}</span>
                <Badge tone={DEMAND_STATUS[d.status]?.tone ?? "muted"}>{DEMAND_STATUS[d.status]?.label ?? d.status}</Badge>
                {d.riskLevel !== "low" && <Badge tone="warning">风险 {d.riskLevel}</Badge>}
              </div>
              {d.description && <p className="mt-1 line-clamp-2 text-sm text-ink-500">{d.description}</p>}
              <p className="mt-1 text-xs text-ink-400">{d._count.votes} 人投票 · 由 {d.user.nickname} 提出</p>
            </div>
            <button onClick={() => setActive(active === d.id ? null : d.id)} className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm hover:border-tide-400">审核</button>
          </div>
          {active === d.id && <DemandReviewPanel demand={d} allDemands={demands} onDone={() => { setActive(null); load(); }} />}
        </div>
      ))}
    </div>
  );
}

function DemandReviewPanel({ demand, allDemands, onDone }: { demand: AdminDemand; allDemands: AdminDemand[]; onDone: () => void }) {
  const [status, setStatus] = useState(demand.status);
  const [reply, setReply] = useState(demand.officialReply ?? "");
  const [reason, setReason] = useState("");
  const [risk, setRisk] = useState(demand.riskLevel);
  const [mergeTarget, setMergeTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const options = NEXT_STATUS[demand.status] ?? Object.keys(DEMAND_STATUS);

  async function saveStatus() {
    if (status === "rejected" && !reason.trim()) { alert("未采纳必须填写原因"); return; }
    setBusy(true);
    await fetch(`/api/admin/demands/${demand.id}/status`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, officialReply: reply, reason, riskLevel: risk }),
    });
    setBusy(false);
    onDone();
  }
  async function merge() {
    if (!mergeTarget) return;
    setBusy(true);
    await fetch(`/api/admin/demands/${demand.id}/merge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetDemandId: mergeTarget }) });
    setBusy(false);
    onDone();
  }

  return (
    <div className="mt-4 space-y-3 border-t border-ink-100 pt-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="text-ink-500">变更状态</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm">
            <option value={demand.status}>{DEMAND_STATUS[demand.status]?.label}（当前）</option>
            {options.filter((o) => o !== "merged").map((s) => <option key={s} value={s}>{DEMAND_STATUS[s]?.label ?? s}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-ink-500">风险等级</span>
          <select value={risk} onChange={(e) => setRisk(e.target.value)} className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm">
            <option value="low">低</option><option value="medium">中</option><option value="high">高</option>
          </select>
        </label>
      </div>
      <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="官方反馈（展示给用户）" className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-tide-400" />
      {status === "rejected" && (
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="未采纳原因（必填）" className="w-full rounded-lg border border-error/40 px-3 py-2 text-sm outline-none focus:border-error" />
      )}
      <button disabled={busy} onClick={saveStatus} className="rounded-lg bg-tide-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50">保存状态</button>

      <div className="flex items-center gap-2 border-t border-ink-100 pt-3">
        <span className="text-sm text-ink-500">合并到：</span>
        <select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} className="flex-1 rounded-lg border border-ink-200 px-3 py-2 text-sm">
          <option value="">选择目标需求</option>
          {allDemands.filter((x) => x.id !== demand.id).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
        </select>
        <button disabled={busy || !mergeTarget} onClick={merge} className="rounded-lg border border-ink-200 px-4 py-2 text-sm hover:border-tide-400 disabled:opacity-50">合并</button>
      </div>
      <p className="text-xs text-ink-400">合并后原投票会迁移到目标需求，不会丢失。</p>
    </div>
  );
}
