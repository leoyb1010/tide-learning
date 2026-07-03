"use client";

import { useState } from "react";
import { Check, X } from "@phosphor-icons/react";

export interface InlineSaveResult {
  title: string | null;
  contentMd: string;
  updatedAt: string;
}

/**
 * NoteEditorInline —— 笔记就地编辑表单（可复用）。
 * 负责标题 + 正文（Markdown）的编辑与保存，调 PATCH /api/notes/:id。
 * 成功后把最新字段回调给父组件（父组件退出编辑态并刷新展示）。
 * focus 用 focus:border-[var(--ink3)]（中性，禁止红色 focus 框）。
 */
export function NoteEditorInline({
  noteId,
  initialTitle,
  initialContentMd,
  onSaved,
  onCancel,
  onError,
}: {
  noteId: string;
  initialTitle: string | null;
  initialContentMd: string;
  onSaved: (result: InlineSaveResult) => void;
  onCancel: () => void;
  onError?: (message: string) => void;
}) {
  const [title, setTitle] = useState(initialTitle ?? "");
  const [contentMd, setContentMd] = useState(initialContentMd);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, contentMd }),
      }).then((r) => r.json());
      if (!res.ok) {
        onError?.(res.error ?? "保存失败，请重试");
        return;
      }
      onSaved({
        title: (res.data?.title ?? null) as string | null,
        contentMd: (res.data?.contentMd ?? contentMd) as string,
        updatedAt: (res.data?.updatedAt ?? new Date().toISOString()) as string,
      });
    } catch {
      onError?.("保存失败，请检查网络后重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="studio-rise space-y-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="标题（可留空）"
        className="w-full rounded-[13px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[18px] font-bold text-[var(--ink)] shadow-[var(--card)] outline-none transition-colors placeholder:text-[var(--ink4)] placeholder:font-normal focus:border-[var(--ink3)]"
      />
      <textarea
        value={contentMd}
        onChange={(e) => setContentMd(e.target.value)}
        rows={16}
        placeholder="用 Markdown 记录你的想法…"
        className="w-full resize-y rounded-[14px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5 font-mono text-[14px] leading-[1.7] text-[var(--ink)] shadow-[var(--card)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--ink3)]"
      />
      <div className="flex items-center justify-end gap-2.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="studio-press inline-flex items-center gap-1.5 rounded-[11px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[13px] font-semibold text-[var(--ink2)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)] disabled:opacity-45"
        >
          <X size={14} weight="bold" /> 取消
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="studio-press inline-flex items-center gap-1.5 rounded-[11px] border border-[var(--red)] bg-[var(--red)] px-4 py-2 text-[13px] font-semibold text-white shadow-[var(--card)] transition-opacity hover:opacity-90 disabled:opacity-45"
        >
          {saving ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <Check size={14} weight="bold" />
          )}
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
    </div>
  );
}
