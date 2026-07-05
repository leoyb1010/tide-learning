"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "@phosphor-icons/react";
import { ComposeDialog } from "@/app/notes/NotesClient";

/**
 * NotebookComposeButton —— 笔记本详情页「＋ 在此笔记本记一条」入口（client 包装）。
 *
 * 详情页是 Server Component，弹窗（ComposeDialog）是 client，故用本组件承载「按钮 + 弹窗」，
 * 把 notebookId 作 prop 预填进弹窗的随手写面板，新建即归入该笔记本。
 * 创建成功后 router.refresh() 让服务端页面重新查询本笔记本的笔记，列表即时刷新。
 *
 * variant：
 *  - "solid"：非空态用（页头右上主按钮）。
 *  - "ghost"：空态用（空状态卡片内的召唤按钮，弱化描边）。
 */
export default function NotebookComposeButton({
  notebookId,
  variant = "solid",
}: {
  notebookId: string;
  variant?: "solid" | "ghost";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const cls =
    variant === "solid"
      ? "cta-glow studio-press inline-flex min-h-[44px] items-center gap-1.5 rounded-[12px] bg-[var(--red)] px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--red-hover)]"
      : "studio-press inline-flex min-h-[44px] items-center gap-1.5 rounded-[12px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-4 py-2.5 text-[13px] font-semibold text-[var(--red)] transition-colors";

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cls}>
        <Plus size={15} weight="bold" /> 在此笔记本记一条
      </button>
      <ComposeDialog
        open={open}
        onClose={() => setOpen(false)}
        prefillNotebookId={notebookId}
        onCreated={() => {
          setOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}
