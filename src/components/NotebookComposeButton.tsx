"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "@phosphor-icons/react";
import { useCaptureAuditTrace } from "@/hooks/useCaptureAuditTrace";
import { ComposeDialog } from "@/app/notes/NotesClient";

/** A single editor survives replacement of the notebook's empty-state children. */
const NotebookComposeContext = createContext<{
  show: () => void;
  primaryTrigger: RefObject<HTMLButtonElement | null>;
} | null>(null);

export function NotebookComposeProvider({ notebookId, children }: { notebookId: string; children: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const primaryTrigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useCaptureAuditTrace("NotebookComposeProvider", { open, notebookId });
  useEffect(() => {
    const closed = wasOpen.current && !open;
    wasOpen.current = open;
    if (!closed) return;
    // The empty-state trigger can disappear after the first note is persisted.
    // Dialog restores connected triggers itself; use the stable header as fallback.
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === document.body) primaryTrigger.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);
  return (
    <NotebookComposeContext.Provider value={{ show: () => setOpen(true), primaryTrigger }}>
      {children}
      <ComposeDialog open={open} onClose={() => setOpen(false)} prefillNotebookId={notebookId}
        onCreated={() => setOpen(false)} onPersisted={() => router.refresh()} />
    </NotebookComposeContext.Provider>
  );
}

/** Both notebook entry points share the page-level editor owner. */
export default function NotebookComposeButton({ notebookId, variant = "solid" }: {
  notebookId: string; variant?: "solid" | "ghost";
}) {
  const context = useContext(NotebookComposeContext);
  if (!context) return <NotebookComposeProvider notebookId={notebookId}><NotebookComposeButton notebookId={notebookId} variant={variant} /></NotebookComposeProvider>;
  const cls = variant === "solid"
    ? "cta-glow studio-press inline-flex min-h-[44px] items-center gap-1.5 rounded-[12px] bg-[var(--red)] px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--red-hover)]"
    : "studio-press inline-flex min-h-[44px] items-center gap-1.5 rounded-[12px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-4 py-2.5 text-[13px] font-semibold text-[var(--red)] transition-colors";
  return <button ref={variant === "solid" ? context.primaryTrigger : undefined} type="button" onClick={context.show} className={cls}>
    <Plus size={15} weight="bold" /> 在此笔记本记一条
  </button>;
}
