"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, BookBookmark, NotePencil } from "@phosphor-icons/react";
import { CardSkeleton, ErrorState, Button } from "@/components/ui";
import { Dialog } from "@/components/Dialog";
import { useToast } from "@/components/Toast";
import { useSubmitGuard } from "@/hooks/useSubmitGuard";

interface NotebookCard {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  noteCount: number;
  updatedAt: string;
}

const TITLE_MAX = 40;

/** 默认图标：新建时预选，用户可改。 */
const DEFAULT_ICON = "📘";

/** 24 个预设图标（按学习场景），存入 Notebook.icon 字段（emoji）。 */
const NOTEBOOK_ICONS = [
  "📘", "📗", "📙", "📕", "📒", "🗂️", "🔖", "✏️",
  "🖊️", "💡", "🧠", "⭐", "🎯", "🔬", "🧪", "📐",
  "🎨", "🎧", "🗣️", "💼", "🏥", "🛡️", "🌊", "🔥",
];

/**
 * NotebookGrid —— 笔记本网格。
 * 卡片：icon + 标题 + "N 条笔记" + 描述；点击跳 /notes/notebook/[id]。
 * 含「+ 新建笔记本」卡：点击弹 Dialog 输入表单（标题必填 ≤40 字、描述 + emoji 图标可选）。
 * 数据源：GET /api/notebooks；新建走 POST /api/notebooks。
 */
export default function NotebookGrid() {
  const router = useRouter();
  const { toast } = useToast();
  const [notebooks, setNotebooks] = useState<NotebookCard[] | null>(null);
  const [error, setError] = useState(false);

  // 新建表单状态
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState(DEFAULT_ICON);

  const load = useCallback(async () => {
    setError(false);
    try {
      const json = await fetch("/api/notebooks").then((r) => r.json());
      if (!json.ok) throw new Error();
      setNotebooks(json.data.notebooks as NotebookCard[]);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setTitle("");
    setDescription("");
    setIcon(DEFAULT_ICON);
  }

  // 提交防抖：guard 内部拦截进行中的重复触发（Enter 连按 / 双击），submitting 驱动按钮 loading。
  const { submitting: saving, guard: create } = useSubmitGuard(async () => {
    const t = title.trim();
    if (!t) return toast("请填写笔记本标题", { tone: "warn" });
    if (t.length > TITLE_MAX) return toast(`标题最多 ${TITLE_MAX} 个字`, { tone: "warn" });
    try {
      const json = await fetch("/api/notebooks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: t,
          description: description.trim() || undefined,
          icon: icon.trim() || undefined,
        }),
      }).then((r) => r.json());
      if (!json.ok) return toast(json.error ?? "创建失败", { tone: "warn" });
      toast("笔记本已创建", { tone: "success" });
      setOpen(false);
      resetForm();
      router.push(`/notes/notebook/${json.data.id}`);
    } catch {
      toast("创建失败，请稍后重试", { tone: "warn" });
    }
  });

  if (error) return <ErrorState hint="笔记本加载失败" onRetry={() => void load()} />;

  if (notebooks === null) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <>
      {/* 对齐规范（问题③）：网格 items-stretch + 卡片 h-full flex-col，同行等高；
          描述恒占两行（无则占位），「N 条笔记」计数栏 mt-auto 贴底对齐成一条基线。 */}
      <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {notebooks.map((nb) => (
          <Link
            key={nb.id}
            href={`/notes/notebook/${nb.id}`}
            className="studio-lift studio-rise flex h-full flex-col rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)]"
          >
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-[12px] border border-[var(--border)] bg-[var(--surface2)] text-[20px]">
              {nb.icon ? (
                <span aria-hidden>{nb.icon}</span>
              ) : (
                <BookBookmark size={20} weight="duotone" className="text-[var(--ink3)]" />
              )}
            </div>
            <h3 className="truncate text-[16px] font-bold text-[var(--ink)]">{nb.title}</h3>
            <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-[13px] leading-[1.6] text-[var(--ink2)]">
              {nb.description || " "}
            </p>
            <p className="mono mt-auto pt-3 text-[11px] text-[var(--ink4)]">{nb.noteCount} 条笔记</p>
          </Link>
        ))}

        {/* 新建笔记本卡 */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="studio-press flex min-h-[148px] flex-col items-center justify-center gap-2 rounded-[16px] border border-dashed border-[var(--border2)] bg-[var(--surface)] p-5 text-[var(--ink3)] transition-colors hover:border-[var(--ink3)] hover:text-[var(--ink)]"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-[12px] border border-[var(--border)] bg-[var(--surface2)]">
            <Plus size={20} weight="bold" />
          </span>
          <span className="text-[14px] font-semibold">新建笔记本</span>
        </button>
      </div>

      {/* 新建笔记本对话框 */}
      <Dialog open={open} onClose={() => (saving ? null : setOpen(false))} title="新建笔记本">
        <div className="space-y-4">
          {/* 图标选择：预设网格 + 自定义输入 */}
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-[var(--ink2)]">图标</label>
            <div className="grid grid-cols-8 gap-1.5">
              {NOTEBOOK_ICONS.map((em) => {
                const active = icon === em;
                return (
                  <button
                    key={em}
                    type="button"
                    onClick={() => setIcon(em)}
                    aria-pressed={active}
                    title={`选择图标 ${em}`} aria-label={`选择图标 ${em}`}
                    className={`studio-press flex aspect-square items-center justify-center rounded-[10px] border text-[18px] transition-colors ${
                      active
                        ? "border-[var(--red)] bg-[var(--red-soft)]"
                        : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--ink3)]"
                    }`}
                  >
                    <span aria-hidden>{em}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                value={icon}
                onChange={(e) => setIcon(e.target.value.slice(0, 4))}
                placeholder="📓"
                maxLength={4}
                aria-label="自定义图标（emoji）"
                className="w-14 shrink-0 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] py-2.5 text-center text-[18px] text-[var(--ink)] outline-none transition-colors focus:border-[var(--ink3)]"
              />
              <span className="text-[12px] text-[var(--ink4)]">选一个，或输入你自己的 emoji</span>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-[var(--ink2)]">
              标题<span className="text-[var(--red)]"> *</span>
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：产品经理养成"
              maxLength={TITLE_MAX}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !saving) create();
              }}
              className="w-full min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-[14px] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--ink3)]"
            />
            <p className="mono mt-1 text-right text-[11px] text-[var(--ink4)]">
              {title.length}/{TITLE_MAX}
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-[var(--ink2)]">描述（可选）</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="这个笔记本用来收纳什么？"
              rows={3}
              className="w-full resize-none rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-[14px] leading-[1.6] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--ink3)]"
            />
          </div>

          <div className="flex justify-end gap-2.5 border-t border-[var(--border)] pt-4">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={saving}
              className="studio-press rounded-[11px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[13px] font-semibold text-[var(--ink2)] transition-colors hover:text-[var(--ink)] disabled:opacity-45"
            >
              取消
            </button>
            <Button onClick={create} loading={saving} disabled={saving || !title.trim()} icon>
              <NotePencil size={15} weight="bold" /> 创建
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
