"use client";

import { useState } from "react";
import Link from "next/link";
import {
  PencilSimple, MapPin, ArrowUpRight, Quotes, CalendarBlank, Clock,
  ShareNetwork, NotePencil, Sparkle, PencilSimpleLine, LinkSimple, CaretDown,
} from "@phosphor-icons/react";
import { renderMarkdown } from "@/lib/markdown";
import { mmss } from "@/lib/format";
import { useToast } from "@/components/Toast";
import { SmartBackLink } from "@/components/SmartBackLink";
import { NoteEditorInline } from "@/components/NoteEditorInline";
import { SharePanel } from "@/components/SharePanel";
import { ExportMenu } from "@/components/ExportMenu";

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

// 来源徽章元信息（知识脉络第一层：这条笔记从哪来）。与 Note.source 一致。
const SOURCE_META: Record<string, { label: string; Icon: typeof NotePencil; tint: string }> = {
  lesson: { label: "课程内记", Icon: PencilSimpleLine, tint: "var(--info)" },
  manual: { label: "手记", Icon: NotePencil, tint: "var(--ink3)" },
  ai_transform: { label: "AI 整理", Icon: Sparkle, tint: "var(--info)" },
  link_import: { label: "链接采集", Icon: LinkSimple, tint: "var(--ok)" },
};

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

  // 长文折叠：链接导入的长正文默认收起，给一个「展开原文」的克制入口，避免详情页被一整篇网页撑爆。
  // 阈值按字符数估算；短文与非导入笔记不折叠（一次展开后本次会话保持展开）。
  const LONG_BODY_THRESHOLD = 1600;
  const isLongImport = note.source === "link_import" && contentMd.trim().length > LONG_BODY_THRESHOLD;
  const [expanded, setExpanded] = useState(false);
  const collapsed = isLongImport && !expanded;

  // 来源锚点跳转地址（仅课程内笔记有）：点击才跳，弱化课程绑定
  const anchorHref =
    note.course && note.lesson
      ? `/courses/${note.course.slug}/learn/${note.lesson.id}${
          note.timestampSec != null ? `?t=${note.timestampSec}` : ""
        }`
      : null;

  return (
    <div className="mx-auto max-w-[760px] space-y-6">
      {/* 顶部返回：智能回到真实来源（笔记本/课程/笔记馆），直链兜底笔记馆 */}
      <SmartBackLink fallback="/notes" label="笔记馆" />

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
              {/* 分享笔记：生成笔记摘录卡（note-quote 服务端 where id+userId，仅取本人笔记） */}
              <SharePanel
                kind="note-quote"
                title="分享笔记"
                params={{ noteId: note.id }}
                triggerLabel="分享笔记"
                trigger={
                  <span className="studio-press inline-flex shrink-0 items-center gap-1.5 rounded-[11px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-[13px] font-semibold text-[var(--ink2)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)]">
                    <ShareNetwork size={14} weight="bold" /> 分享
                  </span>
                }
              />
              <ExportMenu scope={{ kind: "single", noteId: note.id }} compact />
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="studio-press inline-flex shrink-0 items-center gap-1.5 rounded-[11px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-[13px] font-semibold text-[var(--ink2)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)]"
              >
                <PencilSimple size={14} weight="bold" /> 编辑
              </button>
            </div>
          </div>

          {/* 知识脉络 · 来源层：这条笔记从哪来（来源徽章 + 若来自课程的血缘） */}
          {(() => {
            const meta = SOURCE_META[note.source] ?? SOURCE_META.manual;
            const SrcIcon = meta.Icon;
            return (
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-1 font-semibold text-[var(--ink2)]"
                  style={{ color: meta.tint }}
                >
                  <SrcIcon size={13} weight="fill" /> {meta.label}
                </span>
                {note.course && (
                  <span className="inline-flex items-center gap-1 text-[var(--ink3)]">
                    <span aria-hidden className="text-[var(--ink4)]">来自</span>
                    <span className="font-medium text-[var(--ink2)]">《{note.course.title}》</span>
                    {note.lesson && <span className="text-[var(--ink3)]">· {note.lesson.title}</span>}
                    {note.timestampSec != null && (
                      <span className="mono text-[var(--ink4)]">· {mmss(note.timestampSec)}</span>
                    )}
                  </span>
                )}
              </div>
            );
          })()}

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
            <div className="relative">
              <div
                className="tide-md tide-md-article text-[15px] leading-[1.8] text-[var(--ink)]"
                style={collapsed ? { maxHeight: "42vh", overflow: "hidden" } : undefined}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(contentMd) }}
              />
              {collapsed && (
                // 底部渐隐罩：暗示「下面还有」，用 surface 底色做到 transparent 的软过渡
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-24"
                  style={{
                    background:
                      "linear-gradient(to bottom, transparent, var(--surface, #fff))",
                  }}
                />
              )}
              {isLongImport && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="studio-press mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-[11px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-[13px] font-semibold text-[var(--ink2)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)]"
                  aria-expanded={expanded}
                >
                  <CaretDown
                    size={14}
                    weight="bold"
                    className="transition-transform"
                    style={{ transform: expanded ? "rotate(180deg)" : undefined }}
                  />
                  {expanded ? "收起原文" : "展开原文全文"}
                </button>
              )}
            </div>
          ) : (
            <p className="text-[14px] italic text-[var(--ink4)]">还没有正文，点「编辑」补充内容。</p>
          )}

          {/* 知识脉络 · 采集锚点：课程内笔记可点回原课原节（带时间戳锚点），一路溯源到出处 */}
          {anchorHref && note.course && note.lesson && (
            <Link
              href={anchorHref}
              className="studio-lift group mt-2 flex min-h-[44px] items-center justify-between gap-3 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-[var(--card)]"
            >
              <span className="flex min-w-0 items-center gap-2 text-[13px] text-[var(--ink2)]">
                <MapPin size={15} weight="fill" className="shrink-0 text-[var(--ink3)]" />
                <span className="truncate">
                  <span className="text-[var(--ink4)]">回到原文 · </span>
                  《{note.course.title}》· {note.lesson.title}
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
