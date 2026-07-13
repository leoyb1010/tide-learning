"use client";

import { useState, type FormEvent } from "react";
import { Badge, Button } from "@/components/ui";

type Item = { id: string; courseId: string; title: string; plannedPublishDate: string; owner: string | null; status: string; riskLevel: string; demandId: string | null; course: { title: string } };
type Course = { id: string; title: string };

const STATUS_LABEL: Record<string, string> = { planned: "已计划", recording: "录制中", editing: "剪辑中", review: "审核中", scheduled: "已排期", published: "已发布", delayed: "延期" };

export function AdminContentCalendar({ initialItems, courses }: { initialItems: Item[]; courses: Course[] }) {
  const [items, setItems] = useState(initialItems);
  const [error, setError] = useState("");

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError("");
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/admin/content-calendar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(form)) });
    const json = await res.json();
    if (!res.ok) return setError(json.error ?? "创建失败");
    setItems((old) => [...old, { ...json.data.item, plannedPublishDate: new Date(json.data.item.plannedPublishDate).toISOString() }].sort((a, b) => a.plannedPublishDate.localeCompare(b.plannedPublishDate)));
    e.currentTarget.reset();
  }

  async function update(id: string, status: string) {
    setError("");
    const res = await fetch("/api/admin/content-calendar", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, status }) });
    const json = await res.json();
    if (!res.ok) return setError(json.error ?? "更新失败");
    setItems((old) => old.map((x) => x.id === id ? { ...x, status } : x));
  }

  async function remove(id: string) {
    if (!window.confirm("确定删除这条排期？")) return;
    const res = await fetch(`/api/admin/content-calendar?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) return setError(json.error ?? "删除失败");
    setItems((old) => old.filter((x) => x.id !== id));
  }

  return <div className="space-y-4">
    <form onSubmit={create} className="grid gap-3 rounded-2xl border border-ink-100 bg-paper-raised p-4 md:grid-cols-5">
      <select name="courseId" aria-label="课程" required className="rounded-xl border border-ink-100 bg-paper-raised px-3 py-2"><option value="">选择课程</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select>
      <input name="title" aria-label="内容标题" required maxLength={200} placeholder="内容标题" className="rounded-xl border border-ink-100 bg-paper-raised px-3 py-2" />
      <input name="plannedPublishDate" aria-label="计划发布日期" required type="date" className="rounded-xl border border-ink-100 bg-paper-raised px-3 py-2" />
      <input name="owner" aria-label="负责人" maxLength={100} placeholder="负责人（可选）" className="rounded-xl border border-ink-100 bg-paper-raised px-3 py-2" />
      <Button type="submit">新建排期</Button>
    </form>
    {error && <p role="alert" className="text-sm text-[var(--red)]">{error}</p>}
    <div className="overflow-x-auto rounded-2xl border border-ink-100 bg-paper-raised"><table className="w-full text-sm"><thead className="border-b border-ink-100 text-left text-ink-400"><tr><th className="px-4 py-3">计划发布</th><th className="px-4 py-3">课程</th><th className="px-4 py-3">内容</th><th className="px-4 py-3">负责人</th><th className="px-4 py-3">风险</th><th className="px-4 py-3">状态</th><th className="px-4 py-3">操作</th></tr></thead><tbody className="divide-y divide-ink-100">{items.map((it) => <tr key={it.id}><td className="px-4 py-3 tabular text-ink-950">{new Date(it.plannedPublishDate).toLocaleDateString("zh-CN")}</td><td className="px-4 py-3">{it.course.title}</td><td className="px-4 py-3 text-ink-500">{it.title}{it.demandId && <Badge tone="tide">共创选题</Badge>}</td><td className="px-4 py-3 text-ink-500">{it.owner ?? "—"}</td><td className="px-4 py-3"><Badge tone={it.riskLevel === "high" ? "error" : it.riskLevel === "medium" ? "warning" : "muted"}>{it.riskLevel}</Badge></td><td className="px-4 py-3"><select aria-label={`${it.title}状态`} value={it.status} onChange={(e) => update(it.id, e.target.value)} className="rounded-lg border border-ink-100 bg-paper-raised px-2 py-1">{Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td><td className="px-4 py-3"><button type="button" onClick={() => remove(it.id)} className="min-h-11 text-[var(--red)]">删除</button></td></tr>)}</tbody></table></div>
  </div>;
}
