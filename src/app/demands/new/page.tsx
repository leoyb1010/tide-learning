"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SealCheck } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import { TRACKS } from "@/lib/tracks";

const CATEGORIES = TRACKS.map((t) => ({ key: t.key, label: t.label }));
const DEPTHS = [
  { key: "intro", label: "入门" },
  { key: "advanced", label: "进阶" },
  { key: "mastery", label: "精通" },
];

export default function NewDemandPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("ai_skill");
  const [desiredDepth, setDepth] = useState("intro");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/demands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, description, category, desiredDepth }),
      });
      // 网关 502 等非 JSON 响应时不把解析原文当错误文案：解析失败兜底为 null，统一可读文案
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.ok !== true) throw new Error(json?.error || "服务异常，请稍后再试");
      setDone(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <SealCheck size={44} weight="fill" className="mx-auto text-success" />
        <h1 className="mt-5 text-xl font-semibold tracking-tight text-ink-950">需求已提交</h1>
        <p className="mt-2 text-ink-500">进入待审核，通过后将出现在需求广场。审核结果和状态变化你都能在需求详情看到。</p>
        <div className="mt-7 flex justify-center gap-3">
          <Button href="/demands" variant="primary">返回需求广场</Button>
          <button onClick={() => { setDone(false); setTitle(""); setDescription(""); }} className="rounded-xl border border-ink-200 px-5 py-2.5 text-sm transition-colors hover:border-accent-400">再提一个</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg py-6">
      <Link href="/demands" className="text-sm text-accent-700 hover:underline">← 返回需求广场</Link>
      <h1 className="mt-3 text-2xl font-semibold text-ink-950">提交学习需求</h1>
      <p className="mt-1 text-ink-500">告诉我们你想学什么，重复需求会被合并，不会石沉大海。</p>

      <form onSubmit={submit} className="mt-6 space-y-5">
        <div>
          <label htmlFor="demand-title" className="mb-1.5 block text-sm text-ink-800">想学的内容 *</label>
          <input id="demand-title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：AI 数据分析入门" required className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 outline-none focus:border-[var(--ink3)]" />
        </div>
        <div>
          <label htmlFor="demand-description" className="mb-1.5 block text-sm text-ink-800">补充说明</label>
          <textarea id="demand-description" name="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="你希望覆盖哪些场景、达到什么程度" className="w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 outline-none focus:border-[var(--ink3)]" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="demand-category" className="mb-1.5 block text-sm text-ink-800">分类</label>
            <select id="demand-category" name="category" value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 outline-none">
              {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="demand-depth" className="mb-1.5 block text-sm text-ink-800">深度</label>
            <select id="demand-depth" name="desiredDepth" value={desiredDepth} onChange={(e) => setDepth(e.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 outline-none">
              {DEPTHS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          </div>
        </div>
        {err && <p className="text-sm text-error">{err === "需要登录" ? "请先登录后再提交需求" : err}</p>}
        <Button type="submit" full size="lg" loading={loading}>提交需求</Button>
      </form>
    </div>
  );
}
