"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "@phosphor-icons/react";
import { SPRING_TIDE } from "./motion";

/**
 * 统一模态基座：scrim + 涨潮入场 + focus trap + Esc 关闭 + 滚动锁。
 */
export function Dialog({
  open, onClose, title, children, className,
}: { open: boolean; onClose: () => void; title?: string; children: ReactNode; className?: string }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") trapFocus(e, panelRef.current);
    };
    document.addEventListener("keydown", onKey);
    // 初始焦点
    requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>("[data-autofocus],button,a,input,textarea")?.focus());
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
          <motion.div
            className="absolute inset-0 bg-ink-950/45"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.24 }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            className={`relative w-full max-w-lg rounded-3xl border border-ink-100 bg-paper-raised p-6 shadow-[0_32px_80px_-32px_rgba(125,8,18,0.35)] ${className ?? ""}`}
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ ...SPRING_TIDE, type: "spring" }}
          >
            {title && <h2 className="mb-4 text-lg font-semibold text-ink-950">{title}</h2>}
            <button onClick={onClose} className="absolute right-4 top-4 text-ink-400 transition-colors hover:text-ink-700" aria-label="关闭">
              <X size={18} />
            </button>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function trapFocus(e: KeyboardEvent, panel: HTMLElement | null) {
  if (!panel) return;
  const focusables = panel.querySelectorAll<HTMLElement>(
    'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
  );
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault(); first.focus();
  }
}
