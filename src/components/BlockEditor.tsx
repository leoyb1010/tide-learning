"use client";

/**
 * BlockEditor —— L4 空白画布块编辑器。
 *
 * 打开时 GET /lessons/:id/blocks 拉当前块;编辑后 PUT 整块数组(服务端 validateBlocks 校验 + writeLessonBlocks
 * 存档 + 重渲)。text=concept/scene/example/callout/summary(标题+正文);quiz=题干/选项/答案/解析;
 * list=keypoint/objectives/steps。全部白名单块都可插入；高频块使用表单，专业块可编辑结构化 JSON。
 */

import { useEffect, useState } from "react";
import { ArrowUp, ArrowDown, Trash, FloppyDisk, Plus } from "@phosphor-icons/react";
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
  choice: "学习选择", branch: "路径分支", hotspot: "图片热点",
};

const INSERTABLE_TYPES = Object.keys(TYPE_LABEL);

/** 新插入的块必须先是合法协议块，避免用户直接保存时被 validateBlocks 静默丢弃。 */
function createBlock(type: string): Blk {
  const id = `manual_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const common = { id, type };
  switch (type) {
    case "concept": return { ...common, title: "新概念", markdown: "在这里写下概念说明。" };
    case "scene": return { ...common, title: "新场景", markdown: "在这里描述学习场景。" };
    case "example": return { ...common, markdown: "在这里补充例子或案例。" };
    case "callout": return { ...common, tone: "info", markdown: "在这里写下提示。" };
    case "summary": return { ...common, markdown: "在这里总结本节要点。", next: "" };
    case "quiz": return { ...common, question: "在这里输入题目", options: ["选项一", "选项二"], answerIndex: 0, explain: "在这里写解析。" };
    case "keypoint": return { ...common, points: ["第一条要点"] };
    case "objectives": return { ...common, items: ["第一项学习目标"] };
    case "steps": return { ...common, steps: [{ title: "第一步", detail: "在这里写步骤说明。" }] };
    case "dialog": return { ...common, turns: [{ speaker: "A", text: "在这里写对话。" }] };
    case "compare": return { ...common, title: "对照", left: { heading: "左侧", items: ["要点一"] }, right: { heading: "右侧", items: ["要点一"] } };
    case "code": return { ...common, lang: "text", code: "// 在这里输入代码", explanation: "" };
    case "flashcard": return { ...common, front: "卡片正面", back: "卡片背面" };
    case "diagram": return { ...common, kind: "flow", title: "流程图", items: [{ label: "起点" }, { label: "结果" }], note: "" };
    case "formula": return { ...common, latex: "x = y", display: true, caption: "" };
    case "fillblank": return { ...common, prompt: "填写正确答案", segments: ["", ""], blanks: [["答案"]] };
    case "dragwords": return { ...common, prompt: "选择正确词语", segments: ["", ""], blanks: ["答案"], distractors: [] };
    case "image": return { ...common, src: "/lesson-stills/lesson-still-ai.jpg", caption: "", alt: "课程配图" };
    case "choice": return { ...common, prompt: "你想从哪个方向继续？", choices: [{ label: "路径一", targetLessonId: "" }, { label: "路径二", targetLessonId: "" }] };
    case "branch": return { ...common, prompt: "选择下一条学习路径", options: [{ label: "路径一", condition: "", targetLessonId: "" }, { label: "路径二", condition: "", targetLessonId: "" }] };
    case "hotspot": return { ...common, imageSrc: "/lesson-stills/lesson-still-ai.jpg", prompt: "点击图片中的关键位置", spots: [{ x: 50, y: 50, label: "热点", feedback: "", targetLessonId: "" }] };
    default: return { ...common, title: "新内容", markdown: "在这里填写内容。" };
  }
}

export function BlockEditor({ lessonId, lessonTitle, onClose }: { lessonId: string; lessonTitle: string; onClose: () => void }) {
  const { toast } = useToast();
  const [blocks, setBlocks] = useState<Blk[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [insertType, setInsertType] = useState("concept");
  const [lessonOptions, setLessonOptions] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/lessons/${lessonId}/blocks`, { credentials: "same-origin" });
        const j = await r.json().catch(() => null);
        if (!cancelled) {
          setBlocks(r.ok && j?.ok ? ((j.data?.blocks ?? []) as Blk[]) : []);
          setLessonOptions(r.ok && j?.ok ? (j.data?.lessons ?? []) : []);
        }
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

  function insertBlock() {
    setBlocks((bs) => [...(bs ?? []), createBlock(insertType)]);
    track("block_editor_insert", { lesson_id: lessonId, block_type: insertType });
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
      ) : (
        <div>
          <div className="mb-3 flex flex-col gap-2 rounded-[12px] border border-dashed border-[var(--border2)] bg-[var(--surface2)] p-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-[var(--ink)]">插入内容块</p>
              <p className="mt-0.5 text-[11px] text-[var(--ink3)]">自由组合内容，不要求固定开场、讲解或总结顺序。</p>
            </div>
            <select
              value={insertType}
              onChange={(e) => setInsertType(e.target.value)}
              aria-label="选择内容块类型"
              className="min-h-[38px] rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 text-[13px] font-semibold text-[var(--ink2)] outline-none focus:border-[var(--ink3)]"
            >
              {INSERTABLE_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABEL[type]}</option>)}
            </select>
            <button
              type="button"
              onClick={insertBlock}
              className="studio-press inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-[10px] bg-[var(--ink)] px-3 text-[13px] font-semibold text-[var(--surface)]"
            >
              <Plus size={14} weight="bold" /> 插入块
            </button>
          </div>
          <div className="max-h-[54vh] space-y-2.5 overflow-y-auto pr-1">
            {!blocks || blocks.length === 0 ? (
              <div className="rounded-[12px] border border-dashed border-[var(--border)] px-4 py-10 text-center">
                <p className="text-[14px] font-semibold text-[var(--ink2)]">这是一张空白画布</p>
                <p className="mt-1 text-[12px] text-[var(--ink3)]">从上方选择任意内容块开始。</p>
              </div>
            ) : blocks.map((b, i) => (
              <div key={(b.id as string) ?? i} className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="mono rounded-full bg-[var(--surface-inset)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ink3)]">{TYPE_LABEL[b.type] ?? b.type}</span>
                  <div className="ml-auto flex items-center gap-1">
                    <button type="button" disabled={i === 0} onClick={() => move(i, -1)} title="上移" className="studio-press rounded-md p-1 text-[var(--ink3)] hover:text-[var(--ink)] disabled:opacity-30"><ArrowUp size={13} weight="bold" /></button>
                    <button type="button" disabled={i === blocks.length - 1} onClick={() => move(i, 1)} title="下移" className="studio-press rounded-md p-1 text-[var(--ink3)] hover:text-[var(--ink)] disabled:opacity-30"><ArrowDown size={13} weight="bold" /></button>
                    <button type="button" onClick={() => remove(i)} title="删除" className="studio-press rounded-md p-1 text-[var(--ink3)] hover:text-[var(--red)]"><Trash size={13} weight="bold" /></button>
                  </div>
                </div>
                <BlockFields block={b} lessonOptions={lessonOptions} onPatch={(p) => patch(i, p)} />
              </div>
            ))}
          </div>
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

/** 依块类型渲染可编辑字段；专业块提供结构化 JSON 编辑，不再只读锁死。 */
function BlockFields({ block, lessonOptions, onPatch }: { block: Blk; lessonOptions: { id: string; title: string }[]; onPatch: (p: Partial<Blk>) => void }) {
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
    const targets = Array.isArray(block.branchTargets) ? (block.branchTargets as (string | null)[]) : [];
    const answerIndex = typeof block.answerIndex === "number" ? block.answerIndex : 0;
    return (
      <div className="space-y-2">
        <input className={input} placeholder="题干" value={(block.question as string) ?? ""} onChange={(e) => onPatch({ question: e.target.value })} />
        {options.map((opt, oi) => (
          <div key={oi} className="flex items-center gap-2">
            <input type="radio" name={`ans-${block.id}`} checked={answerIndex === oi} onChange={() => onPatch({ answerIndex: oi })} title="标为正确答案" />
            <input className={input} placeholder={`选项 ${oi + 1}`} value={opt} onChange={(e) => onPatch({ options: options.map((o, k) => (k === oi ? e.target.value : o)) })} />
            <select className={`${input} max-w-[180px]`} aria-label={`选项 ${oi + 1} 答题后跳转`} value={targets[oi] ?? ""} onChange={(e) => onPatch({ branchTargets: options.map((_, k) => k === oi ? (e.target.value || null) : (targets[k] ?? null)) })}>
              <option value="">答题后不跳转</option>
              {lessonOptions.map((lesson) => <option key={lesson.id} value={lesson.id}>{lesson.title}</option>)}
            </select>
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

  if (t === "image") return <ImageBlockFields block={block} onPatch={onPatch} />;

  if (t === "choice" || t === "branch") {
    const key = t === "choice" ? "choices" : "options";
    const rows = Array.isArray(block[key]) ? block[key] as { label?: string; feedback?: string; condition?: string; targetLessonId?: string }[] : [];
    return (
      <div className="space-y-2">
        <input className={input} placeholder="选择提示" value={(block.prompt as string) ?? ""} onChange={(e) => onPatch({ prompt: e.target.value })} />
        {rows.map((row, index) => (
          <div key={index} className="grid gap-1.5 rounded-lg border border-[var(--border)] p-2 sm:grid-cols-2">
            <input className={input} placeholder={`选项 ${index + 1}`} value={row.label ?? ""} onChange={(e) => onPatch({ [key]: rows.map((item, i) => i === index ? { ...item, label: e.target.value } : item) } as Partial<Blk>)} />
            <select className={input} value={row.targetLessonId ?? ""} onChange={(e) => onPatch({ [key]: rows.map((item, i) => i === index ? { ...item, targetLessonId: e.target.value } : item) } as Partial<Blk>)}>
              <option value="">选择目标课节</option>
              {lessonOptions.map((lesson) => <option key={lesson.id} value={lesson.id}>{lesson.title}</option>)}
            </select>
            <input className={`${input} sm:col-span-2`} placeholder={t === "choice" ? "选择后的反馈（可空）" : "出现该路径的条件说明（可空）"} value={(t === "choice" ? row.feedback : row.condition) ?? ""} onChange={(e) => onPatch({ [key]: rows.map((item, i) => i === index ? { ...item, [t === "choice" ? "feedback" : "condition"]: e.target.value } : item) } as Partial<Blk>)} />
            <button type="button" onClick={() => onPatch({ [key]: rows.filter((_, i) => i !== index) } as Partial<Blk>)} className="justify-self-start text-[11px] font-semibold text-[var(--red)]">删除此选项</button>
          </div>
        ))}
        <button type="button" onClick={() => onPatch({ [key]: [...rows, { label: "新路径", targetLessonId: "" }] } as Partial<Blk>)} className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] font-semibold text-[var(--ink2)]">+ 添加路径</button>
      </div>
    );
  }

  if (t === "hotspot") {
    const spots = Array.isArray(block.spots) ? block.spots as { x?: number; y?: number; label?: string; feedback?: string; correct?: boolean; targetLessonId?: string }[] : [];
    return (
      <div className="space-y-2">
        <input className={input} placeholder="站内图片路径" value={(block.imageSrc as string) ?? ""} onChange={(e) => onPatch({ imageSrc: e.target.value })} />
        <input className={input} placeholder="热点任务提示" value={(block.prompt as string) ?? ""} onChange={(e) => onPatch({ prompt: e.target.value })} />
        {spots.map((spot, index) => (
          <div key={index} className="grid gap-1.5 rounded-lg border border-[var(--border)] p-2 sm:grid-cols-4">
            <input className={input} placeholder="标签" value={spot.label ?? ""} onChange={(e) => onPatch({ spots: spots.map((item, i) => i === index ? { ...item, label: e.target.value } : item) })} />
            <input className={input} type="number" min={0} max={100} step={0.1} aria-label="水平位置百分比" value={spot.x ?? 50} onChange={(e) => onPatch({ spots: spots.map((item, i) => i === index ? { ...item, x: Number(e.target.value) } : item) })} />
            <input className={input} type="number" min={0} max={100} step={0.1} aria-label="垂直位置百分比" value={spot.y ?? 50} onChange={(e) => onPatch({ spots: spots.map((item, i) => i === index ? { ...item, y: Number(e.target.value) } : item) })} />
            <select className={input} value={spot.targetLessonId ?? ""} onChange={(e) => onPatch({ spots: spots.map((item, i) => i === index ? { ...item, targetLessonId: e.target.value } : item) })}>
              <option value="">不跳转</option>
              {lessonOptions.map((lesson) => <option key={lesson.id} value={lesson.id}>{lesson.title}</option>)}
            </select>
            <input className={`${input} sm:col-span-3`} placeholder="点击反馈（可空）" value={spot.feedback ?? ""} onChange={(e) => onPatch({ spots: spots.map((item, i) => i === index ? { ...item, feedback: e.target.value } : item) })} />
            <button type="button" onClick={() => onPatch({ spots: spots.filter((_, i) => i !== index) })} className="justify-self-start text-[11px] font-semibold text-[var(--red)]">删除热点</button>
          </div>
        ))}
        <button type="button" onClick={() => onPatch({ spots: [...spots, { x: 50, y: 50, label: "新热点" }] })} className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] font-semibold text-[var(--ink2)]">+ 添加热点</button>
      </div>
    );
  }

  return <StructuredBlockFields block={block} onPatch={onPatch} />;
}

interface CreatorImageAsset {
  id: string;
  fileName: string;
  url: string;
  size: number;
}

/** 图片块直接连接创作者素材库：上传后可跨课复用，不需要手填私有路径。 */
function ImageBlockFields({ block, onPatch }: { block: Blk; onPatch: (p: Partial<Blk>) => void }) {
  const [assets, setAssets] = useState<CreatorImageAsset[]>([]);
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = "w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--ink3)]";

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/assets?kind=image", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((j) => { if (!cancelled && j?.ok) setAssets(j.data?.assets ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await fetch("/api/assets", { method: "POST", credentials: "same-origin", body: fd });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok || !j.data?.asset) throw new Error(j?.error || "上传失败");
      const created = j.data.asset as CreatorImageAsset;
      setAssets((prev) => [created, ...prev]);
      onPatch({ src: created.url, alt: (block.alt as string) || created.fileName });
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }

  const visible = assets.filter((asset) => asset.fileName.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索我的图片素材" className={input} />
        <label className="studio-press inline-flex min-h-[36px] shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[8px] border border-[var(--border2)] bg-[var(--surface)] px-3 text-[12px] font-semibold text-[var(--ink2)]">
          {uploading ? <Spinner size={12} /> : <Plus size={13} weight="bold" />}
          {uploading ? "上传中" : "上传图片"}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={uploading} className="hidden" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void upload(file); }} />
        </label>
      </div>
      <select className={input} value={(block.src as string) ?? ""} onChange={(e) => onPatch({ src: e.target.value })}>
        <option value="/lesson-stills/lesson-still-ai.jpg">站内默认图</option>
        {visible.map((asset) => <option key={asset.id} value={asset.url}>{asset.fileName} · {Math.max(1, Math.round(asset.size / 1024))} KB</option>)}
      </select>
      <input className={input} placeholder="图片说明（caption）" value={(block.caption as string) ?? ""} onChange={(e) => onPatch({ caption: e.target.value })} />
      <input className={input} placeholder="无障碍替代文字（alt）" value={(block.alt as string) ?? ""} onChange={(e) => onPatch({ alt: e.target.value })} />
      {error && <p role="alert" className="text-[11px] text-[var(--red)]">{error}</p>}
      <p className="text-[11px] text-[var(--ink4)]">素材私有保存，只能选择你自己的图片；同一图片可在多门课复用。</p>
    </div>
  );
}

/** 低频专业块保留完整协议能力；显式“应用”后才写回，JSON 解析失败不会破坏当前块。 */
function StructuredBlockFields({ block, onPatch }: { block: Blk; onPatch: (p: Partial<Blk>) => void }) {
  const [raw, setRaw] = useState(() => JSON.stringify(block, null, 2));
  const [error, setError] = useState<string | null>(null);

  function apply() {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("需要一个 JSON 对象");
      if (parsed.type !== block.type) throw new Error("不能在这里修改块类型");
      onPatch(parsed as Partial<Blk>);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "JSON 格式不正确");
    }
  }

  return (
    <div className="space-y-2">
      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={8}
        spellCheck={false}
        aria-label={`${TYPE_LABEL[block.type] ?? block.type}结构化字段`}
        className="mono w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface-inset)] px-2.5 py-2 text-[12px] leading-relaxed text-[var(--ink2)] outline-none focus:border-[var(--ink3)]"
      />
      <div className="flex items-center gap-2">
        <button type="button" onClick={apply} className="studio-press rounded-full border border-[var(--border)] px-3 py-1.5 text-[11px] font-semibold text-[var(--ink2)] hover:border-[var(--border2)]">
          应用结构化字段
        </button>
        {error ? <span role="alert" className="text-[11px] text-[var(--red)]">{error}</span> : <span className="text-[11px] text-[var(--ink4)]">保存前请先应用修改</span>}
      </div>
    </div>
  );
}
