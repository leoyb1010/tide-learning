"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useActionMenu } from "@/hooks/useActionMenu";
import { Sparkle, CaretDown, ListBullets, ListChecks, Translate, FileText, Copy, Check } from "@phosphor-icons/react";
import { Dialog } from "@/components/Dialog";
import { useToast } from "@/components/Toast";
import { track } from "@/lib/analytics-client";
import { renderMarkdown } from "@/lib/markdown";

// 复用 §5.2 消化层 /api/ai/note-transform 的四个动作。
// 该端点接受 noteIds（不接受 notebookId），故本组件按笔记本内笔记的 id 列表调用——
// 服务端仍会 where 强制 userId + deletedAt:null 二次校验，越权铁律不破。
type Action = "outline" | "actions" | "translate" | "weekly";
const ITEMS: { key: Action; label: string; Icon: typeof Sparkle }[] = [
  { key: "outline", label: "改写大纲", Icon: ListBullets },
  { key: "actions", label: "提炼行动项", Icon: ListChecks },
  { key: "weekly", label: "生成周报", Icon: FileText },
  { key: "translate", label: "翻译（英）", Icon: Translate },
];

interface TidyResult {
  title: string;
  kind: "list" | "markdown";
  points?: string[];
  markdown?: string;
}

/**
 * NotebookAiTidy —— 笔记本页「AI 整理本笔记本」入口。
 * noteIds 由服务端页面透传（本笔记本下未删除笔记的 id）。为空时按钮禁用。
 * outline/weekly/translate → Markdown 结果；actions → 行动项列表。统一 Dialog 展示 + 复制。
 */
export default function NotebookAiTidy({ noteIds, title }: { noteIds: string[]; title: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [result, setResult] = useState<TidyResult | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menu = useActionMenu(open, setOpen);
  const submitRef = useRef(false);
  const operationRef = useRef(0);
  const scopeKey = JSON.stringify({ noteIds: noteIds.slice(0, 80), title });
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const invalidate = useCallback(() => { operationRef.current++; }, []);
  useEffect(() => {
    submitRef.current = false;
    setBusy(null); setResult(null); setDialogOpen(false);
    return invalidate;
  }, [scopeKey, invalidate]);
  const empty = noteIds.length === 0;

  async function run(action: Action) {
    if (submitRef.current) return;
    submitRef.current = true;
    const operation = ++operationRef.current;
    const isCurrent = () => operation === operationRef.current && scopeKey === currentScope.current;
    menu.closeAfterAction();
    setBusy(action);
    try {
      const json = await fetch("/api/ai/note-transform", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ noteIds: noteIds.slice(0, 80), action }),
      }).then((r) => r.json());
      if (!isCurrent()) return;
      if (!json.ok) return toast(json.error ?? "AI 整理失败", { tone: "warn" });

      if (action === "actions") {
        const items = (json.data?.items ?? []) as string[];
        if (items.length === 0) return toast("没有可提炼的行动项", { tone: "info" });
        setResult({ title: `${title} · 行动项`, kind: "list", points: items });
      } else {
        const md = (json.data?.markdown ?? "") as string;
        if (!md) return toast("AI 未返回内容", { tone: "info" });
        const label = action === "outline" ? "知识大纲" : action === "weekly" ? "学习周报" : "英文翻译";
        setResult({ title: `${title} · ${label}`, kind: "markdown", markdown: md });
      }
      setDialogOpen(true);
      track("ai_note_tidy", { action, scope: "notebook" });
    } catch {
      if (!isCurrent()) return;
      toast("AI 整理失败，请稍后重试", { tone: "warn" });
    } finally {
      if (isCurrent()) { submitRef.current = false; setBusy(null); }
    }
  }

  async function copyResult() {
    const text = result?.kind === "markdown" ? result.markdown ?? "" : (result?.points ?? []).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast("复制失败", { tone: "warn" });
    }
  }

  return (
    <div className="relative" ref={menu.containerRef} style={open ? { zIndex: "var(--z-dropdown)" } : undefined}>
      <button
        type="button"
        ref={menu.triggerRef}
        onKeyDown={menu.onTriggerKeyDown}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menu.id : undefined}
        onClick={() => setOpen((v) => !v)}
        disabled={busy !== null || empty}
        title={empty ? "本笔记本还没有笔记" : undefined}
        className="studio-press inline-flex whitespace-nowrap min-h-[44px] items-center gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-[13px] font-semibold text-[var(--ink)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)] disabled:opacity-45"
      >
        <Sparkle size={14} weight="fill" className="text-[var(--red)]" />
        {busy ? "整理中…" : "AI 整理本笔记本"}
        <CaretDown size={12} weight="bold" className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && !empty && (
        <div id={menu.id} ref={menu.menuRef} role="menu" aria-label="整理本笔记本" onKeyDown={menu.onMenuKeyDown} className="studio-rise absolute right-0 z-30 mt-1.5 w-44 overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)] py-1 shadow-[var(--lift)]">
          {ITEMS.map((it) => {
            const Icon = it.Icon;
            return (
              <button
                key={it.key}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => run(it.key)}
                className="flex min-h-[44px] w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] font-medium text-[var(--ink2)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--ink)]"
              >
                <Icon size={15} className="text-[var(--ink3)]" /> {it.label}
              </button>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={result?.title} returnFocusRef={menu.triggerRef}>
        {result?.kind === "list" ? (
          <>
            <ul className="space-y-2.5">
              {(result.points ?? []).map((point, i) => (
                <li key={i} className="flex gap-2.5 text-[14px] leading-[1.7] text-[var(--ink2)]">
                  <span className="mono mt-0.5 shrink-0 font-semibold text-[var(--red)]">{i + 1}.</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
            <CopyRow copied={copied} onCopy={copyResult} />
          </>
        ) : result?.kind === "markdown" ? (
          <>
            <div
              className="tide-md max-h-[52vh] overflow-y-auto text-[14px] leading-[1.7] text-[var(--ink)]"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(result.markdown ?? "") }}
            />
            <CopyRow copied={copied} onCopy={copyResult} />
          </>
        ) : null}
      </Dialog>
    </div>
  );
}

function CopyRow({ copied, onCopy }: { copied: boolean; onCopy: () => void }) {
  return (
    <div className="mt-4 flex justify-end border-t border-[var(--border)] pt-3">
      <button
        type="button"
        onClick={onCopy}
        className="studio-press inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[13px] font-semibold text-[var(--ink2)] transition-colors hover:text-[var(--ink)]"
      >
        {copied ? <Check size={13} weight="bold" className="text-[var(--red)]" /> : <Copy size={13} />}
        {copied ? "已复制" : "复制"}
      </button>
    </div>
  );
}
