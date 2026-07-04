"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  DownloadSimple, CaretDown, FileMd, FileHtml, FileText, BracketsCurly, Printer,
} from "@phosphor-icons/react";
import { track } from "@/lib/analytics-client";

/**
 * ExportMenu —— 笔记导出中心（"use client"，纯前端，无 server 链）。
 * 触发 GET /api/notes/export?format=…&(noteId|notebookId)= 走浏览器附件下载。
 * 五格式统一在此显性列出（不再藏在设置里）：
 *   md   Markdown          html 网页        txt 纯文本
 *   json 结构化（可迁移）   print 打印版(→ 浏览器另存 PDF)
 * 无障碍/触达：菜单项命中区 ≥44px；面板 z 用 --z-dropdown（就近弹出，低于弹窗/吐司）；
 * 动效走 studio-rise / studio-press，已在 globals 的 reduce-motion 段降级为无动画。
 *
 * scope：
 *   { kind: "single", noteId }         单条笔记
 *   { kind: "notebook", notebookId }   某笔记本内全部笔记
 *   { kind: "all" }                    我的全部笔记
 */
export type ExportScope =
  | { kind: "single"; noteId: string }
  | { kind: "notebook"; notebookId: string }
  | { kind: "all" };

type Fmt = "md" | "html" | "txt" | "json" | "print";

const FORMAT_ITEMS: { key: Fmt; label: string; hint: string; Icon: typeof FileMd }[] = [
  { key: "md", label: "Markdown", hint: ".md · 保留标题与格式", Icon: FileMd },
  { key: "html", label: "网页", hint: ".html · 带样式单文件", Icon: FileHtml },
  { key: "txt", label: "纯文本", hint: ".txt · 去语法可读文本", Icon: FileText },
  { key: "json", label: "结构化数据", hint: ".json · 全字段可迁移", Icon: BracketsCurly },
  { key: "print", label: "打印版", hint: "浏览器 Cmd/Ctrl+P 存 PDF", Icon: Printer },
];

function buildUrl(scope: ExportScope, format: Fmt): string {
  const p = new URLSearchParams({ format });
  if (scope.kind === "single") p.set("noteId", scope.noteId);
  else if (scope.kind === "notebook") p.set("notebookId", scope.notebookId);
  return `/api/notes/export?${p.toString()}`;
}

export function ExportMenu({
  scope,
  label = "导出",
  compact = false,
}: {
  scope: ExportScope;
  /** 触发按钮文案（默认「导出」）。 */
  label?: string;
  /** 紧凑触发按钮（图标偏描边、字号略小），用于详情页操作行。 */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // 点击外部 / Esc 关闭
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

  function run(format: Fmt) {
    track("note_export", { format, scope: scope.kind });
    // 附件响应，浏览器直接下载 / 打印版新标签打开供 Cmd+P
    if (format === "print") window.open(buildUrl(scope, format), "_blank", "noopener");
    else window.location.href = buildUrl(scope, format);
    setOpen(false);
  }

  const triggerCls = compact
    ? "studio-press inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-[11px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-[13px] font-semibold text-[var(--ink2)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)] sm:min-h-0"
    : "studio-press inline-flex min-h-[44px] items-center gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-[13px] font-semibold text-[var(--ink)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)]";

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={triggerCls}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
      >
        <DownloadSimple size={compact ? 14 : 15} weight="bold" /> {label}
        <CaretDown size={12} weight="bold" className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="选择导出格式"
          style={{ zIndex: "var(--z-dropdown)" }}
          className="studio-rise absolute right-0 mt-1.5 w-[236px] overflow-hidden rounded-[13px] border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-[var(--lift)]"
        >
          <div className="mono px-2 pb-1 pt-1 text-[10px] uppercase tracking-[0.12em] text-[var(--ink4)]">
            导出为
          </div>
          {FORMAT_ITEMS.map(({ key, label: l, hint, Icon }) => (
            <button
              key={key}
              type="button"
              role="menuitem"
              onClick={() => run(key)}
              className="flex min-h-[44px] w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-[var(--surface-inset)]"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-[var(--border)] bg-[var(--surface2)] text-[var(--ink3)]">
                <Icon size={16} weight="regular" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold text-[var(--ink)]">{l}</span>
                <span className="block truncate text-[11px] text-[var(--ink4)]">{hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default ExportMenu;
