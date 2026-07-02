"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Clock } from "@phosphor-icons/react/dist/ssr";
import { mmss } from "@/lib/format";

export interface NoteItem {
  id: string;
  title: string | null;
  contentMd: string;
  timestampSec: number | null;
  updatedAt: string;
}

/**
 * NoteEditor — §6.5 / §4.2：
 *  - 创建笔记不中断视频（不触发暂停）
 *  - 自动绑定课程/章节/时间戳，自动保存（debounce PATCH）
 *  - 时间戳可点击回跳（onSeek）
 */
export function NoteEditor({
  courseId,
  lessonId,
  getCurrentTime,
  onSeek,
  initialNotes,
  canCreate,
}: {
  courseId: string;
  lessonId: string;
  getCurrentTime: () => number;
  onSeek: (sec: number) => void;
  initialNotes: NoteItem[];
  canCreate: boolean;
}) {
  const [notes, setNotes] = useState<NoteItem[]>(initialNotes);
  const [draft, setDraft] = useState("");
  const [attachTs, setAttachTs] = useState<number | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  async function createNote() {
    if (!draft.trim()) return;
    setErr(null);
    const ts = attachTs ?? Math.floor(getCurrentTime());
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseId, lessonId, timestampSec: ts, contentMd: draft.trim() }),
      });
      const json = await res.json();
      if (!json.ok) {
        setErr(json.error);
        return;
      }
      setNotes((n) => [{ ...json.data, updatedAt: json.data.updatedAt }, ...n]);
      setDraft("");
      setAttachTs(null);
      // 埋点：note_create 已在服务端记录
    } catch {
      setErr("保存失败，草稿已保留");
    }
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
        setSaving("saved");
        setTimeout(() => setSaving("idle"), 1200);
      } catch {
        setSaving("error");
      }
    }, 700);
  }, []);

  async function del(id: string) {
    setNotes((n) => n.filter((x) => x.id !== id));
    await fetch(`/api/notes/${id}`, { method: "DELETE" });
  }

  useEffect(() => {
    const timers = saveTimers.current;
    return () => Object.values(timers).forEach(clearTimeout);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
        <h3 className="font-medium text-ink-950">笔记</h3>
        <span className="text-xs text-ink-400">
          {saving === "saving" ? "保存中…" : saving === "saved" ? "已保存" : saving === "error" ? "保存失败" : `${notes.length} 条`}
        </span>
      </div>

      {/* 新建 */}
      <div className="border-b border-ink-100 p-4">
        {!canCreate ? (
          <p className="rounded-lg bg-ink-100 px-3 py-2 text-xs text-ink-500">
            免费用户最多 3 篇笔记。订阅后可无限记录，笔记永久保留。
          </p>
        ) : (
          <>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="记下此刻的想法…（不会打断视频）"
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
        {notes.length === 0 && <p className="pt-8 text-center text-sm text-ink-400">还没有笔记</p>}
        {notes.map((n) => (
          <div key={n.id} className="group rounded-lg border border-ink-100 bg-paper-raised p-3">
            <div className="mb-1.5 flex items-center justify-between">
              {n.timestampSec != null ? (
                <button onClick={() => onSeek(n.timestampSec!)} className="inline-flex items-center gap-1 rounded bg-accent-50 px-2 py-0.5 text-xs font-medium text-accent-700 transition-colors hover:bg-accent-100">
                  <Clock size={12} weight="fill" /> {mmss(n.timestampSec)}
                </button>
              ) : (
                <span className="text-xs text-ink-400">无时间戳</span>
              )}
              <button onClick={() => del(n.id)} className="text-xs text-ink-300 opacity-0 transition-opacity hover:text-error group-hover:opacity-100">
                删除
              </button>
            </div>
            <textarea
              defaultValue={n.contentMd}
              onChange={(e) => autosave(n.id, e.target.value)}
              rows={2}
              className="w-full resize-none border-none bg-transparent text-sm text-ink-800 outline-none"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
