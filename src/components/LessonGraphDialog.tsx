"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Plus, Trash } from "@phosphor-icons/react";
import { Dialog } from "@/components/Dialog";
import { Spinner } from "@/components/GenProgress";
import { useToast } from "@/components/Toast";

interface LessonNode { id: string; title: string; sortOrder: number }
interface EdgeRow {
  id?: string;
  fromLessonId: string;
  toLessonId: string;
  label: string;
  sortOrder: number;
  condition: { type: "always" | "quiz" | "choice"; blockId?: string; answerIndex?: number; optionIndex?: number };
}

export function LessonGraphDialog({ courseId, onClose }: { courseId: string; onClose: () => void }) {
  const { toast } = useToast();
  const [lessons, setLessons] = useState<LessonNode[]>([]);
  const [edges, setEdges] = useState<EdgeRow[]>([]);
  const [mode, setMode] = useState<"linear" | "graph">("linear");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/courses/${courseId}/graph`, { credentials: "same-origin" })
      .then((response) => response.json())
      .then((json) => {
        if (cancelled || !json?.ok) return;
        const nodes = json.data?.lessons ?? [];
        setLessons(nodes);
        setMode(json.data?.navigationMode === "graph" ? "graph" : "linear");
        setEdges((json.data?.edges ?? []).map((edge: EdgeRow) => ({ ...edge, label: edge.label ?? "" })));
      })
      .catch(() => toast("读取课程路径失败", { tone: "warn" }))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [courseId, toast]);

  function addEdge() {
    if (lessons.length < 2) return;
    const used = new Set(edges.map((edge) => `${edge.fromLessonId}:${edge.toLessonId}`));
    for (const from of lessons) {
      const to = lessons.find((candidate) => candidate.id !== from.id && !used.has(`${from.id}:${candidate.id}`));
      if (to) {
        setEdges((current) => [...current, { fromLessonId: from.id, toLessonId: to.id, label: "", sortOrder: current.length, condition: { type: "always" } }]);
        return;
      }
    }
    toast("可用连接已经全部添加", { tone: "info" });
  }

  function patchEdge(index: number, patch: Partial<EdgeRow>) {
    setEdges((current) => current.map((edge, i) => i === index ? { ...edge, ...patch } : edge));
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/courses/${courseId}/graph`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ navigationMode: mode, edges: edges.map((edge, index) => ({ ...edge, sortOrder: index })) }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) throw new Error(json?.error || "保存失败");
      toast(mode === "graph" ? "非线性学习路径已启用" : "已切回线性章节顺序", { tone: "success" });
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : "保存失败", { tone: "warn" });
    } finally { setSaving(false); }
  }

  const nodeTitle = (id: string) => lessons.find((lesson) => lesson.id === id)?.title ?? id;
  return (
    <Dialog open onClose={onClose} title="课程路径图" className="max-w-3xl">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-3">
        <p className="text-[13px] font-semibold text-[var(--ink)]">导航真值</p>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--ink3)]">线性模式按章节顺序前进；路径图模式允许选择、测验答案和热点决定下一节。图必须无环，章节顺序仍作为无障碍回退。</p>
        <div className="mt-3 flex gap-2">
          {(["linear", "graph"] as const).map((value) => (
            <button key={value} type="button" onClick={() => setMode(value)} className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${mode === value ? "bg-[var(--ink)] text-[var(--surface)]" : "border border-[var(--border)] bg-[var(--surface)] text-[var(--ink2)]"}`}>
              {value === "linear" ? "线性顺序" : "非线性路径图"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-[13px] text-[var(--ink3)]"><Spinner size={14} /> 读取路径…</div>
      ) : (
        <div className="mt-4 max-h-[460px] space-y-2 overflow-y-auto pr-1">
          {edges.map((edge, index) => (
            <div key={edge.id ?? index} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr_auto]">
                <select value={edge.fromLessonId} onChange={(event) => patchEdge(index, { fromLessonId: event.target.value })} className="min-h-[38px] min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-2 text-[12px] text-[var(--ink2)]">
                  {lessons.map((lesson) => <option key={lesson.id} value={lesson.id}>{lesson.title}</option>)}
                </select>
                <ArrowRight size={15} className="hidden text-[var(--ink4)] sm:block" />
                <select value={edge.toLessonId} onChange={(event) => patchEdge(index, { toLessonId: event.target.value })} className="min-h-[38px] min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-2 text-[12px] text-[var(--ink2)]">
                  {lessons.map((lesson) => <option key={lesson.id} value={lesson.id}>{lesson.title}</option>)}
                </select>
                <button type="button" onClick={() => setEdges((current) => current.filter((_, i) => i !== index))} title="删除连接" className="rounded-lg p-2 text-[var(--ink3)] hover:text-[var(--red)]"><Trash size={14} /></button>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <input value={edge.label} onChange={(event) => patchEdge(index, { label: event.target.value.slice(0, 120) })} placeholder="路径标签（可空）" className="min-h-[36px] rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-2.5 text-[12px] outline-none" />
                <select value={edge.condition.type} onChange={(event) => patchEdge(index, { condition: event.target.value === "quiz" ? { type: "quiz", blockId: "", answerIndex: 0 } : event.target.value === "choice" ? { type: "choice", blockId: "", optionIndex: 0 } : { type: "always" } })} className="min-h-[36px] rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-2 text-[12px]">
                  <option value="always">默认路径</option>
                  <option value="quiz">测验答案触发</option>
                  <option value="choice">选择项触发</option>
                </select>
                {edge.condition.type !== "always" ? (
                  <div className="flex gap-1.5">
                    <input value={edge.condition.blockId ?? ""} onChange={(event) => patchEdge(index, { condition: { ...edge.condition, blockId: event.target.value } })} placeholder="内容块 ID" className="min-h-[36px] min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-2 text-[11px] outline-none" />
                    <input type="number" min={0} max={11} value={edge.condition.type === "quiz" ? edge.condition.answerIndex ?? 0 : edge.condition.optionIndex ?? 0} onChange={(event) => patchEdge(index, { condition: edge.condition.type === "quiz" ? { ...edge.condition, answerIndex: Number(event.target.value) } : { ...edge.condition, optionIndex: Number(event.target.value) } })} aria-label="选项序号（从 0 开始）" className="min-h-[36px] w-16 rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-2 text-[11px]" />
                  </div>
                ) : <span className="self-center truncate text-[11px] text-[var(--ink4)]">{nodeTitle(edge.fromLessonId)} 的默认下一节</span>}
              </div>
            </div>
          ))}
          <button type="button" onClick={addEdge} disabled={lessons.length < 2} className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full border border-dashed border-[var(--border2)] px-3 text-[12px] font-semibold text-[var(--ink2)] disabled:opacity-40"><Plus size={13} /> 添加连接</button>
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={() => void save()} disabled={loading || saving} className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--red)] px-4 text-[13px] font-semibold text-white disabled:opacity-50">{saving ? <Spinner size={13} /> : null}{saving ? "保存中" : "保存路径图"}</button>
        <button type="button" onClick={onClose} disabled={saving} className="rounded-xl border border-[var(--border)] px-4 text-[13px] font-semibold text-[var(--ink2)]">取消</button>
      </div>
    </Dialog>
  );
}
