"use client";

import { useState } from "react";
import {
  Sparkle, ListBullets, ListChecks, Translate, FileText, Copy, Check, FloppyDisk, ArrowClockwise,
} from "@phosphor-icons/react";
import { renderMarkdown } from "@/lib/markdown";
import { useToast } from "@/components/Toast";
import { track } from "@/lib/analytics-client";

// §5.2 消化层：/api/ai/note-transform 的四个动作。单篇笔记详情页「一键多转」。
type Action = "outline" | "actions" | "translate" | "weekly";

const ACTIONS: { key: Action; label: string; hint: string; Icon: typeof Sparkle }[] = [
  { key: "outline", label: "改写大纲", hint: "整理成层次清晰的知识大纲", Icon: ListBullets },
  { key: "actions", label: "提炼行动项", hint: "提炼可执行的学习下一步", Icon: ListChecks },
  { key: "weekly", label: "生成周报", hint: "汇总成结构化学习周报", Icon: FileText },
  { key: "translate", label: "翻译（英）", hint: "译为英文并保留结构", Icon: Translate },
];

const ACTION_LABEL: Record<Action, string> = {
  outline: "知识大纲",
  actions: "行动项",
  weekly: "学习周报",
  translate: "英文翻译",
};

interface TransformState {
  action: Action;
  kind: "list" | "markdown";
  items?: string[];
  markdown?: string;
}

/**
 * NoteTransformPanel —— 笔记详情页「一键多转」面板。
 * 四动作调 /api/ai/note-transform（noteIds:[noteId]，服务端 where 强制 userId 二次校验，越权铁律不破）。
 * 三态：idle（动作卡片）/ loading（当前动作 busy）/ error（内联提示，可重试）/ result（结果 + 复制 + 存为新笔记）。
 * 存为新笔记：POST /api/notes，source=ai_transform、kind=text；成功后跳转到新笔记。
 */
export function NoteTransformPanel({ noteId, noteTitle }: { noteId: string; noteTitle: string | null }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<Action | null>(null);
  const [result, setResult] = useState<TransformState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  async function run(action: Action) {
    setBusy(action);
    setError(null);
    setResult(null);
    setCopied(false);
    try {
      const res = await fetch("/api/ai/note-transform", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ noteIds: [noteId], action }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        setError(json?.error ?? "AI 整理失败，请稍后重试");
        return;
      }
      if (action === "actions") {
        const items = (json.data?.items ?? []) as string[];
        if (!items.length) {
          setError("没有可提炼的行动项");
          return;
        }
        setResult({ action, kind: "list", items });
      } else {
        const md = (json.data?.markdown ?? "") as string;
        if (!md.trim()) {
          setError("AI 未返回内容，请稍后重试");
          return;
        }
        setResult({ action, kind: "markdown", markdown: md });
      }
      track("ai_note_transform_panel", { action, scope: "note" });
    } catch {
      setError("网络异常，请稍后重试");
    } finally {
      setBusy(null);
    }
  }

  // 结果 → 可存/可复制的纯文本
  function resultText(r: TransformState): string {
    return r.kind === "markdown" ? r.markdown ?? "" : (r.items ?? []).map((s, i) => `${i + 1}. ${s}`).join("\n");
  }

  async function copyResult() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(resultText(result));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast("复制失败", { tone: "warn" });
    }
  }

  // 存为新笔记：把 AI 整理结果落库为独立笔记（source=ai_transform），成功后跳转
  async function saveAsNote() {
    if (!result) return;
    setSaving(true);
    try {
      const label = ACTION_LABEL[result.action];
      const base = noteTitle?.trim() ? noteTitle.trim() : "笔记";
      const title = `${base} · ${label}`.slice(0, 200);
      const contentMd =
        result.kind === "markdown"
          ? result.markdown ?? ""
          : (result.items ?? []).map((s) => `- ${s}`).join("\n");
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, contentMd, kind: "text", source: "ai_transform" }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        toast(json?.error ?? "存为新笔记失败", { tone: "warn" });
        return;
      }
      toast("已存为新笔记", { tone: "success" });
      track("ai_note_transform_saved", { action: result.action });
      const newId = json.data?.id as string | undefined;
      if (newId) window.location.href = `/notes/${newId}`;
    } catch {
      toast("存为新笔记失败", { tone: "warn" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="studio-rise rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)]">
      <header className="mb-3.5 flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-[10px] bg-[var(--surface2)]">
          <Sparkle size={15} weight="fill" className="text-[var(--red)]" />
        </span>
        <div>
          <h2 className="text-[15px] font-bold text-[var(--ink)]">AI 一键多转</h2>
          <p className="text-[12px] text-[var(--ink4)]">把这篇笔记转成大纲 / 行动项 / 周报 / 英文</p>
        </div>
      </header>

      {/* 动作卡片 */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {ACTIONS.map((a) => {
          const Icon = a.Icon;
          const active = busy === a.key;
          return (
            <button
              key={a.key}
              type="button"
              onClick={() => run(a.key)}
              disabled={busy !== null}
              title={a.hint}
              className="studio-press flex min-h-[72px] flex-col items-start gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface2)] px-3 py-2.5 text-left transition-colors hover:border-[var(--border2)] disabled:opacity-45"
            >
              {active ? (
                <ArrowClockwise size={16} weight="bold" className="animate-spin text-[var(--red)]" />
              ) : (
                <Icon size={16} weight="bold" className="text-[var(--ink3)]" />
              )}
              <span className="text-[13px] font-semibold text-[var(--ink)]">{a.label}</span>
            </button>
          );
        })}
      </div>

      {/* loading 文案 */}
      {busy && (
        <p className="mt-3.5 flex items-center gap-2 text-[13px] text-[var(--ink3)]">
          <ArrowClockwise size={14} weight="bold" className="animate-spin text-[var(--red)]" />
          正在生成「{ACTION_LABEL[busy]}」…
        </p>
      )}

      {/* error 内联 */}
      {error && !busy && (
        <div className="mt-3.5 flex items-center justify-between gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface-inset)] px-4 py-3 text-[13px]">
          <span className="text-[var(--ink2)]">{error}</span>
          {result === null && (
            <span className="shrink-0 text-[12px] text-[var(--ink4)]">选一个动作重试</span>
          )}
        </div>
      )}

      {/* result */}
      {result && !busy && (
        <div className="mt-4 rounded-[14px] border border-[var(--border)] bg-[var(--surface-inset)] p-4">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--ink)]">
              <Sparkle size={13} weight="fill" className="text-[var(--red)]" /> {ACTION_LABEL[result.action]}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copyResult}
                className="studio-press inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[12px] font-semibold text-[var(--ink2)] transition-colors hover:text-[var(--ink)]"
              >
                {copied ? <Check size={12} weight="bold" className="text-[var(--red)]" /> : <Copy size={12} />}
                {copied ? "已复制" : "复制"}
              </button>
              <button
                type="button"
                onClick={saveAsNote}
                disabled={saving}
                className="studio-press inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[12px] font-semibold text-[var(--ink2)] transition-colors hover:text-[var(--ink)] disabled:opacity-45"
              >
                <FloppyDisk size={12} weight="bold" /> {saving ? "保存中…" : "存为新笔记"}
              </button>
            </div>
          </div>

          {result.kind === "list" ? (
            <ul className="space-y-2">
              {(result.items ?? []).map((point, i) => (
                <li key={i} className="flex gap-2.5 text-[14px] leading-[1.7] text-[var(--ink2)]">
                  <span className="mono mt-0.5 shrink-0 font-semibold text-[var(--red)]">{i + 1}.</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div
              className="tide-md max-h-[52vh] overflow-y-auto text-[14px] leading-[1.7] text-[var(--ink)]"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(result.markdown ?? "") }}
            />
          )}
        </div>
      )}
    </section>
  );
}
