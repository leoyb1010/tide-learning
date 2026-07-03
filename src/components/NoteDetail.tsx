"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, PencilSimple, MapPin, ArrowUpRight, Quotes, CalendarBlank, Clock,
  DownloadSimple, CaretDown, FileMd, FileHtml, FileText,
} from "@phosphor-icons/react";
import { renderMarkdown } from "@/lib/markdown";
import { mmss } from "@/lib/format";
import { useToast } from "@/components/Toast";
import { NoteEditorInline } from "@/components/NoteEditorInline";

interface NoteTagLite {
  id: string;
  name: string;
  color: string;
}

export interface NoteDetailData {
  id: string;
  title: string | null;
  contentMd: string;
  kind: string;
  source: string;
  sourceText: string | null;
  captureUrl: string | null;
  timestampSec: number | null;
  starred: boolean;
  createdAt: string;
  updatedAt: string;
  course: { slug: string; title: string } | null;
  lesson: { id: string; title: string } | null;
  tags: NoteTagLite[];
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

/**
 * 单条笔记「导出」下拉：md / html 调后端 route（?noteId=&format=）下载；
 * 纯文本在前端由当前标题+正文即时生成，避免多一趟请求。
 */
function ExportMenu({ noteId, title, contentMd }: { noteId: string; title: string | null; contentMd: string }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function download(format: "md" | "html") {
    window.location.href = `/api/notes/export?noteId=${encodeURIComponent(noteId)}&format=${format}`;
    setOpen(false);
  }

  function downloadTxt() {
    const heading = title?.trim() || "未命名笔记";
    const text = `${heading}\n\n${contentMd}`.trim() + "\n";
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tide-note-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setOpen(false);
  }

  const items: { key: string; label: string; Icon: typeof FileMd; run: () => void }[] = [
    { key: "md", label: "Markdown (.md)", Icon: FileMd, run: () => download("md") },
    { key: "html", label: "网页 (.html)", Icon: FileHtml, run: () => download("html") },
    { key: "txt", label: "纯文本 (.txt)", Icon: FileText, run: downloadTxt },
  ];

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="studio-press inline-flex shrink-0 items-center gap-1.5 rounded-[11px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-[13px] font-semibold text-[var(--ink2)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)]"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <DownloadSimple size={14} weight="bold" /> 导出
        <CaretDown size={12} weight="bold" className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          role="menu"
          className="studio-rise absolute right-0 z-20 mt-1.5 w-[172px] overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--lift)]"
        >
          {items.map(({ key, label, Icon, run }) => (
            <button
              key={key}
              type="button"
              role="menuitem"
              onClick={run}
              className="flex w-full items-center gap-2 rounded-[9px] px-2.5 py-2 text-left text-[13px] font-medium text-[var(--ink2)] transition-colors hover:bg-[var(--surface-inset)] hover:text-[var(--ink)]"
            >
              <Icon size={15} weight="regular" className="text-[var(--ink3)]" /> {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * NoteDetail —— 笔记详情页主体（就地编辑）。
 * 展示：标题、正文（tide-md 渲染）、标签流、时间（mono）、截帧图、划线原文引用。
 * 来源锚点弱化：仅当笔记绑定了课程+章节时，底部展示一个小卡，点击才跳转回学习页。
 */
export function NoteDetail({ note }: { note: NoteDetailData }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  // 保存后用本地 state 覆盖展示，避免整页刷新
  const [title, setTitle] = useState(note.title);
  const [contentMd, setContentMd] = useState(note.contentMd);
  const [updatedAt, setUpdatedAt] = useState(note.updatedAt);

  // 来源锚点跳转地址（仅课程内笔记有）：点击才跳，弱化课程绑定
  const anchorHref =
    note.course && note.lesson
      ? `/courses/${note.course.slug}/learn/${note.lesson.id}${
          note.timestampSec != null ? `?t=${note.timestampSec}` : ""
        }`
      : null;

  return (
    <div className="mx-auto max-w-[720px] space-y-6">
      {/* 顶部返回 */}
      <Link
        href="/notes"
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--ink3)] transition-colors hover:text-[var(--ink)]"
      >
        <ArrowLeft size={15} weight="bold" /> 笔记馆
      </Link>

      {editing ? (
        <NoteEditorInline
          noteId={note.id}
          initialTitle={title}
          initialContentMd={contentMd}
          onCancel={() => setEditing(false)}
          onError={(msg) => toast(msg, { tone: "warn" })}
          onSaved={(r) => {
            setTitle(r.title);
            setContentMd(r.contentMd);
            setUpdatedAt(r.updatedAt);
            setEditing(false);
            toast("笔记已保存", { tone: "success" });
          }}
        />
      ) : (
        <article className="studio-rise space-y-5">
          {/* 标题行 + 编辑按钮 */}
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-[26px] font-bold leading-tight text-[var(--ink)]">
              {title?.trim() || "未命名笔记"}
            </h1>
            <div className="mt-1 flex shrink-0 items-center gap-2">
              <ExportMenu noteId={note.id} title={title} contentMd={contentMd} />
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="studio-press inline-flex shrink-0 items-center gap-1.5 rounded-[11px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-[13px] font-semibold text-[var(--ink2)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)]"
              >
                <PencilSimple size={14} weight="bold" /> 编辑
              </button>
            </div>
          </div>

          {/* 元信息：创建 / 更新时间（mono） */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-[var(--ink4)]">
            <span className="inline-flex items-center gap-1.5">
              <CalendarBlank size={13} weight="regular" />
              创建 <span className="mono">{fmtDate(note.createdAt)}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock size={13} weight="regular" />
              更新 <span className="mono">{fmtDate(updatedAt)}</span>
            </span>
          </div>

          {/* 标签流 */}
          {note.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {note.tags.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-0.5 text-[12px] font-medium text-[var(--ink2)]"
                >
                  {t.name}
                </span>
              ))}
            </div>
          )}

          {/* 截帧图（kind=capture） */}
          {note.kind === "capture" && note.captureUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={note.captureUrl}
              alt={title?.trim() || "笔记截帧"}
              className="w-full rounded-[14px] border border-[var(--border)] bg-[var(--video-bg)] shadow-[var(--card)]"
            />
          )}

          {/* 划线原文引用（kind=clip） */}
          {note.kind === "clip" && note.sourceText && (
            <blockquote className="relative rounded-[14px] border border-[var(--border)] bg-[var(--surface-inset)] px-5 py-4 text-[14px] leading-[1.75] text-[var(--ink2)]">
              <Quotes size={18} weight="fill" className="absolute left-3.5 top-3.5 text-[var(--ink4)] opacity-60" />
              <p className="pl-6 italic">{note.sourceText}</p>
            </blockquote>
          )}

          {/* 正文（Markdown 渲染） */}
          {contentMd.trim() ? (
            <div
              className="tide-md text-[15px] leading-[1.8] text-[var(--ink)]"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(contentMd) }}
            />
          ) : (
            <p className="text-[14px] italic text-[var(--ink4)]">还没有正文，点「编辑」补充内容。</p>
          )}

          {/* 来源锚点（弱化课程绑定）：仅课程内笔记显示，点击才跳 */}
          {anchorHref && note.course && note.lesson && (
            <Link
              href={anchorHref}
              className="studio-lift group mt-2 flex items-center justify-between gap-3 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-[var(--card)]"
            >
              <span className="flex min-w-0 items-center gap-2 text-[13px] text-[var(--ink2)]">
                <MapPin size={15} weight="fill" className="shrink-0 text-[var(--ink3)]" />
                <span className="truncate">
                  来自《{note.course.title}》· {note.lesson.title}
                  {note.timestampSec != null && (
                    <span className="mono ml-1.5 text-[var(--ink4)]">{mmss(note.timestampSec)}</span>
                  )}
                </span>
              </span>
              <ArrowUpRight
                size={15}
                weight="bold"
                className="shrink-0 text-[var(--ink4)] transition-colors group-hover:text-[var(--ink)]"
              />
            </Link>
          )}
        </article>
      )}
    </div>
  );
}
