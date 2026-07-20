"use client";

/**
 * BlockEditor —— L4 块编辑器 v1（text / quiz / list 三类高频块可编辑，其余块可删/排序）。
 *
 * 打开时 GET /lessons/:id/blocks 拉当前块;编辑后 PUT 整块数组(服务端 validateBlocks 校验 + writeLessonBlocks
 * 存档 + 重渲)。text=concept/scene/example/callout/summary(标题+正文);quiz=题干/选项/答案/解析;
 * list=keypoint/objectives/steps。不识别的块显示只读预览,仍可删除/上移下移。
 */

import { useEffect, useState } from "react";
import { ArrowUp, ArrowDown, Trash, FloppyDisk } from "@phosphor-icons/react";
import { Dialog } from "@/components/Dialog";
import { useToast } from "@/components/Toast";
import { Spinner } from "@/components/GenProgress";
import { track } from "@/lib/analytics-client";

// 块是异构 JSON，这里按需读写已知字段。
type Blk = Record<string, unknown> & { id?: string; type: string };

const TEXT_TYPES = new Set(["concept", "scene", "example", "callout", "summary"]);
const TYPE_LABEL: Record<string, string> = {
  concept: "概念", scene: "场景", example: "举例", callout: "提示条", summary: "小结",
  quiz: "测验", keypoint: "要点", objectives: "学习目标", steps: "步骤",
  dialog: "对话", compare: "对照", code: "代码", flashcard: "记忆卡",
  diagram: "图示", formula: "公式", fillblank: "填空", dragwords: "选词", image: "配图",
};

export function BlockEditor({ lessonId, lessonTitle, onClose }: { lessonId: string; lessonTitle: string; onClose: () => void }) {
  const { toast } = useToast();
  const [blocks, setBlocks] = useState<Blk[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/lessons/${lessonId}/blocks`, { credentials: "same-origin" });
        const j = await r.json().catch(() => null);
        if (!cancelled) setBlocks(r.ok && j?.ok ? ((j.data?.blocks ?? []) as Blk[]) : []);
      } catch {
        if (!cancelled) setBlocks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [lessonId]);

  function patch(i: number, p: Partial<Blk>) {
    setBlocks((bs) => (bs ? bs.map((b, k) => (k === i ? { ...b, ...p } : b)) : bs));
  }
  function move(i: number, dir: -1 | 1) {
    setBlocks((bs) => {
      if (!bs) return bs;
      const j = i + dir;
      if (j < 0 || j >= bs.length) return bs;
      const next = [...bs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function remove(i: number) {
    setBlocks((bs) => (bs && bs.length > 1 ? bs.filter((_, k) => k !== i) : (toast("至少保留 1 个块", { tone: "info" }), bs)));
  }

  async function save() {
    if (saving || !blocks) return;
    setSaving(true);
    track("block_editor_save", { lesson_id: lessonId, blocks: blocks.length });
    try {
      const r = await fetch(`/api/lessons/${lessonId}/blocks`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ blocks }),
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok) {
        toast(`已保存 · 课件已重排（${j.data?.blocks ?? 0} 块）`, { tone: "success" });
        onClose();
      } else {
        toast(j?.error || "保存失败，请稍后再试", { tone: "warn" });
      }
    } catch {
      toast("网络异常，请稍后再试", { tone: "warn" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={`编辑「${lessonTitle}」内容`} className="max-w-2xl">
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-[13px] text-[var(--ink3)]"><Spinner size={14} /> 读取内容…</div>
      ) : !blocks || blocks.length === 0 ? (
        <p className="py-8 text-[13px] text-[var(--ink3)]">本节暂无可编辑内容。</p>
      ) : (
        <div className="max-h-[60vh] space-y-2.5 overflow-y-auto pr-1">
          {blocks.map((b, i) => (
            <div key={(b.id as string) ?? i} className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="mono rounded-full bg-[var(--surface-inset)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--ink3)]">{TYPE_LABEL[b.type] ?? b.type}</span>
                <div className="ml-auto flex items-center gap-1">
                  <button type="button" disabled={i === 0} onClick={() => move(i, -1)} title="上移" className="studio-press rounded-md p-1 text-[var(--ink3)] hover:text-[var(--ink)] disabled:opacity-30"><ArrowUp size={13} weight="bold" /></button>
                  <button type="button" disabled={i === blocks.length - 1} onClick={() => move(i, 1)} title="下移" className="studio-press rounded-md p-1 text-[var(--ink3)] hover:text-[var(--ink)] disabled:opacity-30"><ArrowDown size={13} weight="bold" /></button>
                  <button type="button" onClick={() => remove(i)} title="删除" className="studio-press rounded-md p-1 text-[var(--ink3)] hover:text-[var(--red)]"><Trash size={13} weight="bold" /></button>
                </div>
              </div>
              <BlockFields block={b} onPatch={(p) => patch(i, p)} />
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || loading || !blocks?.length}
          className="studio-press inline-flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-[12px] bg-[var(--red)] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--red-hover)] disabled:opacity-60"
        >
          {saving ? <Spinner size={13} /> : <FloppyDisk size={15} weight="fill" />}
          {saving ? "保存中" : "保存并重排课件"}
        </button>
        <button type="button" onClick={onClose} disabled={saving} className="rounded-[12px] border border-[var(--border)] px-4 py-2.5 text-[13px] font-semibold text-[var(--ink2)] transition-colors hover:border-[var(--border2)] disabled:opacity-60">取消</button>
      </div>
    </Dialog>
  );
}

/** 依块类型渲染可编辑字段；不支持的类型给只读预览（仍可删/排序）。 */
function BlockFields({ block, onPatch }: { block: Blk; onPatch: (p: Partial<Blk>) => void }) {
  const t = block.type;
  const input = "w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--ink3)]";

  if (TEXT_TYPES.has(t)) {
    return (
      <div className="space-y-2">
        {"title" in block && (
          <input className={input} placeholder="标题（可空）" value={(block.title as string) ?? ""} onChange={(e) => onPatch({ title: e.target.value })} />
        )}
        <textarea className={input} rows={3} placeholder="正文" value={(block.markdown as string) ?? ""} onChange={(e) => onPatch({ markdown: e.target.value })} />
        {t === "callout" && (
          <select className={input} value={(block.tone as string) ?? "info"} onChange={(e) => onPatch({ tone: e.target.value })}>
            <option value="info">info（提示）</option>
            <option value="warn">warn（警示）</option>
          </select>
        )}
        {t === "summary" && (
          <input className={input} placeholder="下节预告（next）" value={(block.next as string) ?? ""} onChange={(e) => onPatch({ next: e.target.value })} />
        )}
      </div>
    );
  }

  if (t === "quiz") {
    const options = Array.isArray(block.options) ? (block.options as string[]) : [];
    const answerIndex = typeof block.answerIndex === "number" ? block.answerIndex : 0;
    return (
      <div className="space-y-2">
        <input className={input} placeholder="题干" value={(block.question as string) ?? ""} onChange={(e) => onPatch({ question: e.target.value })} />
        {options.map((opt, oi) => (
          <div key={oi} className="flex items-center gap-2">
            <input type="radio" name={`ans-${block.id}`} checked={answerIndex === oi} onChange={() => onPatch({ answerIndex: oi })} title="标为正确答案" />
            <input className={input} placeholder={`选项 ${oi + 1}`} value={opt} onChange={(e) => onPatch({ options: options.map((o, k) => (k === oi ? e.target.value : o)) })} />
            <button type="button" onClick={() => onPatch({ options: options.filter((_, k) => k !== oi), answerIndex: answerIndex >= options.length - 1 ? Math.max(0, options.length - 2) : answerIndex })} className="studio-press rounded-md p-1 text-[var(--ink3)] hover:text-[var(--red)]"><Trash size={12} /></button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onPatch({ options: [...options, "新选项"] })} className="studio-press rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink2)] hover:border-[var(--red-soft-border)]">+ 加选项</button>
          <span className="text-[11px] text-[var(--ink4)]">圆点选正确答案</span>
        </div>
        <textarea className={input} rows={2} placeholder="解析（explain）" value={(block.explain as string) ?? ""} onChange={(e) => onPatch({ explain: e.target.value })} />
      </div>
    );
  }

  if (t === "keypoint" || t === "objectives") {
    const key = t === "keypoint" ? "points" : "items";
    const items = Array.isArray(block[key]) ? (block[key] as string[]) : [];
    return (
      <div className="space-y-1.5">
        {items.map((it, ii) => (
          <div key={ii} className="flex items-center gap-2">
            <input className={input} placeholder={`第 ${ii + 1} 条`} value={it} onChange={(e) => onPatch({ [key]: items.map((x, k) => (k === ii ? e.target.value : x)) } as Partial<Blk>)} />
            <button type="button" onClick={() => onPatch({ [key]: items.filter((_, k) => k !== ii) } as Partial<Blk>)} className="studio-press rounded-md p-1 text-[var(--ink3)] hover:text-[var(--red)]"><Trash size={12} /></button>
          </div>
        ))}
        <button type="button" onClick={() => onPatch({ [key]: [...items, ""] } as Partial<Blk>)} className="studio-press rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink2)] hover:border-[var(--red-soft-border)]">+ 加一条</button>
      </div>
    );
  }

  if (t === "steps") {
    const steps = Array.isArray(block.steps) ? (block.steps as { title?: string; detail?: string }[]) : [];
    return (
      <div className="space-y-2">
        {steps.map((s, si) => (
          <div key={si} className="flex items-center gap-2">
            <input className={input} placeholder={`步骤 ${si + 1} 标题`} value={s.title ?? ""} onChange={(e) => onPatch({ steps: steps.map((x, k) => (k === si ? { ...x, title: e.target.value } : x)) } as Partial<Blk>)} />
            <input className={input} placeholder="说明（可空）" value={s.detail ?? ""} onChange={(e) => onPatch({ steps: steps.map((x, k) => (k === si ? { ...x, detail: e.target.value } : x)) } as Partial<Blk>)} />
            <button type="button" onClick={() => onPatch({ steps: steps.filter((_, k) => k !== si) } as Partial<Blk>)} className="studio-press rounded-md p-1 text-[var(--ink3)] hover:text-[var(--red)]"><Trash size={12} /></button>
          </div>
        ))}
        <button type="button" onClick={() => onPatch({ steps: [...steps, { title: "新步骤" }] } as Partial<Blk>)} className="studio-press rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink2)] hover:border-[var(--red-soft-border)]">+ 加一步</button>
      </div>
    );
  }

  // 不支持在线编辑的块：只读预览（仍可删/排序）。
  return (
    <p className="rounded-[8px] bg-[var(--surface-inset)] px-2.5 py-2 text-[12px] text-[var(--ink3)]">
      该块类型（{TYPE_LABEL[t] ?? t}）暂不支持在线改字段,可删除或调整顺序;需改内容请用「改写」让 AI 重生成本节。
    </p>
  );
}
