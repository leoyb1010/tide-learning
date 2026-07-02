"use client";

import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Clock, Camera, TextT, Trash, Star, PencilSimple, Check } from "@phosphor-icons/react";
import { mmss } from "@/lib/format";
import { renderMarkdown } from "@/lib/markdown";
import { useToast } from "./Toast";
import { SPRING_TIDE } from "./motion";

export interface NoteItem {
  id: string;
  title: string | null;
  contentMd: string;
  timestampSec: number | null;
  updatedAt: string;
  kind?: string;
  captureUrl?: string | null;
  sourceText?: string | null;
  starred?: boolean;
}

export interface NoteEditorHandle {
  /** 由 Player 捕捉条调用：插入一条截帧笔记。 */
  addCapture: (dataUrl: string, ts: number) => void;
  /** 由 Player 字幕划线调用：插入一条剪藏笔记。 */
  addClip: (sourceText: string, ts: number) => void;
  /** 快速批注：聚焦输入框并锚定当前时间。 */
  focusQuick: () => void;
}

/**
 * NoteEditor 2.0 —「捕捉」：文本 / 截帧 / 字幕剪藏三态笔记。
 * - 不打断视频、自动锚定时间戳、自动保存（保存波浪反馈）
 * - Markdown 预览、标签、收藏、时间戳可编辑、删除动画 + Toast 撤销
 */
export const NoteEditor = forwardRef<NoteEditorHandle, {
  courseId: string;
  lessonId: string;
  getCurrentTime: () => number;
  onSeek: (sec: number) => void;
  initialNotes: NoteItem[];
  canCreate: boolean;
}>(function NoteEditor({ courseId, lessonId, getCurrentTime, onSeek, initialNotes, canCreate }, ref) {
  const { toast } = useToast();
  const [notes, setNotes] = useState<NoteItem[]>(initialNotes);
  const [draft, setDraft] = useState("");
  const [attachTs, setAttachTs] = useState<number | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, boolean>>({});
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const delTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const draftRef = useRef<HTMLTextAreaElement>(null);

  // 切讲时组件被 Player 复用而非重挂，需在 lessonId 变化时同步 initialNotes，
  // 避免跨讲串显上一讲的笔记（initialNotes 仅用于挂载初值，此处显式重置）。
  useEffect(() => {
    setNotes(initialNotes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  const post = useCallback(async (payload: Record<string, unknown>) => {
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ courseId, lessonId, ...payload }),
    });
    const json = await res.json();
    if (!json.ok) { setErr(json.error); toast(json.error, { tone: "warn" }); return null; }
    setNotes((n) => [{ ...json.data }, ...n]);
    return json.data as NoteItem;
  }, [courseId, lessonId, toast]);

  // —— 供 Player 调用的捕捉接口 ——
  useImperativeHandle(ref, () => ({
    async addCapture(dataUrl, ts) {
      const created = await post({ timestampSec: Math.floor(ts), contentMd: "", kind: "capture", captureUrl: dataUrl });
      if (created) toast("已截取当前画面到笔记", { tone: "success" });
    },
    async addClip(sourceText, ts) {
      const created = await post({ timestampSec: Math.floor(ts), contentMd: "", kind: "clip", sourceText });
      if (created) toast("已剪藏字幕到笔记", { tone: "success" });
    },
    focusQuick() {
      setAttachTs(Math.floor(getCurrentTime()));
      draftRef.current?.focus();
    },
  }), [post, toast, getCurrentTime]);

  async function createNote() {
    if (!draft.trim()) return;
    setErr(null);
    const ts = attachTs ?? Math.floor(getCurrentTime());
    const created = await post({ timestampSec: ts, contentMd: draft.trim(), kind: "text" });
    if (created) { setDraft(""); setAttachTs(null); }
  }

  const autosave = useCallback((id: string, content: string) => {
    setSaving("saving");
    clearTimeout(saveTimers.current[id]);
    saveTimers.current[id] = setTimeout(async () => {
      try {
        await fetch(`/api/notes/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contentMd: content }),
        });
        setNotes((n) => n.map((x) => (x.id === id ? { ...x, contentMd: content } : x)));
        setSaving("saved");
        setTimeout(() => setSaving("idle"), 1200);
      } catch { setSaving("error"); }
    }, 700);
  }, []);

  async function toggleStar(id: string, next: boolean) {
    setNotes((n) => n.map((x) => (x.id === id ? { ...x, starred: next } : x)));
    await fetch(`/api/notes/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ starred: next }),
    }).catch(() => {});
  }

  async function updateTimestamp(id: string) {
    const ts = Math.floor(getCurrentTime());
    setNotes((n) => n.map((x) => (x.id === id ? { ...x, timestampSec: ts } : x)));
    await fetch(`/api/notes/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ timestampSec: ts }),
    }).catch(() => {});
    toast(`时间戳已更新为 ${mmss(ts)}`, { tone: "success" });
  }

  async function del(id: string) {
    const removed = notes.find((x) => x.id === id);
    setNotes((n) => n.filter((x) => x.id !== id));
    let undone = false;
    toast("已删除笔记", {
      tone: "info",
      action: {
        label: "撤销",
        onClick: () => { undone = true; if (removed) setNotes((n) => [removed, ...n]); },
      },
    });
    // 计时器存入 ref，卸载时统一清理，避免卸载后仍发 DELETE 并静默硬删撤销数据。
    delTimers.current[id] = setTimeout(async () => {
      delete delTimers.current[id];
      if (!undone) await fetch(`/api/notes/${id}`, { method: "DELETE" }).catch(() => {});
    }, 4200);
  }

  useEffect(() => {
    const timers = saveTimers.current;
    const delayedDeletes = delTimers.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
      Object.values(delayedDeletes).forEach(clearTimeout);
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
        <h3 className="font-medium text-ink-950">笔记</h3>
        <span className="flex items-center gap-1 text-xs text-ink-400">
          {saving === "saving" ? (
            <span className="saving-dots inline-flex items-center text-ink-500"><span /><span /><span /></span>
          ) : saving === "saved" ? (
            <span className="inline-flex items-center gap-0.5 text-success"><Check size={12} weight="bold" /> 已保存</span>
          ) : saving === "error" ? "保存失败" : `${notes.length} 条`}
        </span>
      </div>

      {/* 新建 */}
      <div className="border-b border-ink-100 p-4">
        {!canCreate ? (
          <p className="rounded-lg bg-ink-100 px-3 py-2 text-xs text-ink-500">
            免费用户最多 3 篇笔记。订阅后可无限记录、截取画面、剪藏字幕，笔记永久保留。
          </p>
        ) : (
          <>
            <textarea
              ref={draftRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="记下此刻的想法…（支持 Markdown，不会打断视频）"
              rows={3}
              className="w-full resize-none rounded-lg border border-ink-200 bg-paper-raised px-3 py-2 text-sm outline-none transition-colors focus:border-accent-400"
            />
            <div className="mt-2 flex items-center justify-between">
              <button
                onClick={() => setAttachTs(Math.floor(getCurrentTime()))}
                className="inline-flex items-center gap-1 text-xs text-accent-700 hover:underline"
              >
                <Clock size={13} />
                {attachTs != null ? `已锚定 ${mmss(attachTs)}` : "锚定当前时间"}
              </button>
              <button
                onClick={createNote}
                disabled={!draft.trim()}
                className="rounded-lg bg-accent-600 px-4 py-1.5 text-sm font-medium text-white transition-all duration-200 active:scale-[0.97] disabled:opacity-40"
              >
                记笔记
              </button>
            </div>
            {err && <p className="mt-2 text-xs text-error">{err}</p>}
          </>
        )}
      </div>

      {/* 列表 */}
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {notes.length === 0 && <p className="pt-8 text-center text-sm text-ink-400">还没有笔记 · 试试截取画面或划线剪藏</p>}
        <AnimatePresence initial={false}>
          {notes.map((n) => (
            <motion.div
              key={n.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, height: 0, marginBottom: 0 }}
              transition={{ ...SPRING_TIDE, type: "spring" }}
              className="group rounded-lg border border-ink-100 bg-paper-raised p-3"
            >
              <div className="mb-1.5 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {n.timestampSec != null ? (
                    <button onClick={() => onSeek(n.timestampSec!)} className="inline-flex items-center gap-1 rounded bg-accent-50 px-2 py-0.5 text-xs font-medium text-accent-700 transition-colors hover:bg-accent-100">
                      <Clock size={12} weight="fill" /> {mmss(n.timestampSec)}
                    </button>
                  ) : (
                    <span className="text-xs text-ink-400">无时间戳</span>
                  )}
                  <KindBadge kind={n.kind} />
                </div>
                <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <button onClick={() => toggleStar(n.id, !n.starred)} className={n.starred ? "text-accent-600" : "text-ink-300 hover:text-accent-600"} aria-label="收藏">
                    <Star size={13} weight={n.starred ? "fill" : "regular"} />
                  </button>
                  <button onClick={() => updateTimestamp(n.id)} className="text-ink-300 hover:text-accent-700" aria-label="更新时间戳"><PencilSimple size={13} /></button>
                  <button onClick={() => del(n.id)} className="text-ink-300 hover:text-error" aria-label="删除"><Trash size={13} /></button>
                </div>
                {n.starred && (
                  <button onClick={() => toggleStar(n.id, false)} className="text-accent-600 group-hover:hidden" aria-label="已收藏"><Star size={13} weight="fill" /></button>
                )}
              </div>

              {/* 截帧图 */}
              {n.kind === "capture" && n.captureUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={n.captureUrl} alt="课程截图" className="mb-2 w-full rounded-md border border-ink-100" loading="lazy" />
              )}
              {/* 剪藏原文 */}
              {n.kind === "clip" && n.sourceText && (
                <blockquote className="mb-2 border-l-2 border-accent-300 bg-accent-50/50 px-2.5 py-1.5 text-xs italic text-ink-600">
                  “{n.sourceText}”
                </blockquote>
              )}

              {/* 正文：编辑 / Markdown 预览切换 */}
              {preview[n.id] ? (
                <div
                  className="tide-md text-sm text-ink-800"
                  onClick={() => setPreview((p) => ({ ...p, [n.id]: false }))}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(n.contentMd) }}
                />
              ) : (
                <textarea
                  defaultValue={n.contentMd}
                  onChange={(e) => autosave(n.id, e.target.value)}
                  onBlur={() => n.contentMd && setPreview((p) => ({ ...p, [n.id]: true }))}
                  rows={2}
                  placeholder={n.kind === "capture" ? "为这张截图加注解…" : "补充想法…"}
                  className="w-full resize-none border-none bg-transparent text-sm text-ink-800 outline-none"
                />
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
});

function KindBadge({ kind }: { kind?: string }) {
  if (kind === "capture") return <span className="inline-flex items-center gap-0.5 rounded bg-ink-100 px-1.5 py-0.5 text-[0.65rem] text-ink-500"><Camera size={10} /> 截帧</span>;
  if (kind === "clip") return <span className="inline-flex items-center gap-0.5 rounded bg-ink-100 px-1.5 py-0.5 text-[0.65rem] text-ink-500"><TextT size={10} /> 剪藏</span>;
  return null;
}
