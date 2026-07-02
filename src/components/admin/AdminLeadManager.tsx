"use client";

import { useEffect, useState } from "react";
import { LoadingSkeleton, ErrorState, Badge } from "@/components/ui";
import { LEAD_STATUS, CHANNEL_LABELS } from "@/lib/format";
import { trackLabel } from "@/lib/tracks";

interface Lead {
  id: string; name: string | null; phone: string | null; track: string | null;
  source: string; status: string; followUpNote: string | null; createdAt: string;
}

const FLOW = ["new", "contacting", "booked", "trialing", "converted", "lost"];

export function AdminLeadManager() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [bySource, setBySource] = useState<Record<string, { total: number; converted: number }>>({});
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState("all");

  async function load() {
    setError(false);
    try {
      const json = await fetch("/api/admin/leads").then((r) => r.json());
      if (!json.ok) throw new Error();
      setLeads(json.data.leads);
      setBySource(json.data.bySource);
    } catch { setError(true); }
  }
  useEffect(() => { load(); }, []);

  async function update(id: string, patch: { status?: string; followUpNote?: string }) {
    await fetch(`/api/admin/leads/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    load();
  }

  if (error) return <ErrorState hint="线索加载失败" onRetry={load} />;
  if (leads === null) return <LoadingSkeleton lines={6} />;

  const shown = filter === "all" ? leads : leads.filter((l) => l.status === filter);

  return (
    <div className="space-y-5">
      {/* 渠道转化漏斗 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Object.entries(bySource).map(([src, s]) => (
          <div key={src} className="rounded-2xl border border-ink-100 bg-paper-raised p-4">
            <div className="text-xs text-ink-400">{CHANNEL_LABELS[src] ?? src}</div>
            <div className="mt-1 text-xl font-semibold text-ink-950 tabular">{s.converted}/{s.total}</div>
            <div className="text-xs text-accent-700">转化 {s.total ? ((s.converted / s.total) * 100).toFixed(0) : 0}%</div>
          </div>
        ))}
      </div>

      {/* 状态过滤 */}
      <div className="flex flex-wrap gap-2">
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>全部</FilterChip>
        {FLOW.map((s) => <FilterChip key={s} active={filter === s} onClick={() => setFilter(s)}>{LEAD_STATUS[s].label}</FilterChip>)}
      </div>

      {/* 跟进队列 */}
      <div className="overflow-x-auto rounded-2xl border border-ink-100 bg-paper-raised">
        <table className="w-full text-sm">
          <thead className="border-b border-ink-100 text-left text-ink-400">
            <tr><th className="px-4 py-3">联系人</th><th className="px-4 py-3">意向赛道</th><th className="px-4 py-3">渠道</th><th className="px-4 py-3">状态</th><th className="px-4 py-3">跟进</th></tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {shown.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-ink-400">该状态下暂无线索</td></tr>}
            {shown.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-3"><p className="font-medium text-ink-950">{l.name ?? "—"}</p><p className="text-xs text-ink-400">{l.phone}</p></td>
                <td className="px-4 py-3 text-ink-500">{l.track ? trackLabel(l.track) : "—"}</td>
                <td className="px-4 py-3"><Badge tone="muted">{CHANNEL_LABELS[l.source] ?? l.source}</Badge></td>
                <td className="px-4 py-3">
                  <select value={l.status} onChange={(e) => update(l.id, { status: e.target.value })} className="rounded-lg border border-ink-200 px-2 py-1.5 text-sm">
                    {FLOW.map((s) => <option key={s} value={s}>{LEAD_STATUS[s].label}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <input
                    defaultValue={l.followUpNote ?? ""}
                    onBlur={(e) => { if (e.target.value !== (l.followUpNote ?? "")) update(l.id, { followUpNote: e.target.value }); }}
                    placeholder="电联备注…"
                    className="w-40 rounded-lg border border-ink-200 px-2 py-1.5 text-xs outline-none focus:border-accent-400"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={`rounded-full px-3 py-1.5 text-sm ${active ? "bg-accent-600 text-white" : "border border-ink-200 bg-white text-ink-500"}`}>{children}</button>;
}
