"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "@phosphor-icons/react";

/**
 * 统一模态基座：scrim + 涨潮入场 + focus trap + Esc 关闭 + 滚动锁。
 *
 * 进/出场用纯 CSS 关键帧（.dialog-scrim-in / .dialog-panel-in，见 globals.css），
 * 不再依赖 framer-motion —— framer 在「Portal 到 body + open 首帧即 present」的组合下
 * 会把进场动画冻在 initial（opacity:0），实测无法可靠触发。CSS 动画由浏览器直接驱动，
 * 稳定且天然受 prefers-reduced-motion 降级保护。
 *
 * Portal 逃逸：浮层挂到 body，避开祖先 transform/animation/opacity 造成的局部堆叠上下文
 * （书桌 hero 的 .studio-lightup / .stagger 会把内联浮层困住变半透明）。见 globals.css Z-INDEX 铁律 2。
 */
export function Dialog({
  open, onClose, title, ariaLabel, children, className,
}: {
  open: boolean; onClose: () => void; title?: string;
  /** 无障碍名（不渲染可见标题）；缺省时回退用 title 作可访问名。给无可见标题的浮层（如命令面板）用。 */
  ariaLabel?: string;
  children: ReactNode; className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // 打开前的焦点锚点：关闭时还原，避免焦点落回 body（WCAG 2.4.3 焦点顺序）。
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost(document.body);
  }, []);

  useEffect(() => {
    if (!open) return;
    // 仅在 open 转真时记录一次锚点（onClose 变更导致 effect 重跑时不覆盖成浮层内按钮）。
    if (!restoreFocusRef.current) {
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
    }
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

  // 关闭（open 转假）时还原焦点并清空锚点，为下次打开重新记录做准备。
  useEffect(() => {
    if (open) return;
    restoreFocusRef.current?.focus?.();
    restoreFocusRef.current = null;
  }, [open]);

  // SSR/首帧无 host 时不 Portal（避免 document 未定义）；未打开时不渲染浮层。
  if (!host || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: "var(--z-modal)" }}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? title}
    >
      <div className="dialog-scrim-in absolute inset-0 bg-ink-950/45" onClick={onClose} />
      <div
        ref={panelRef}
        className={`dialog-panel-in relative w-full max-w-lg rounded-3xl border border-ink-100 bg-paper-raised p-6 shadow-[0_32px_80px_-32px_rgba(125,8,18,0.35)] ${className ?? ""}`}
      >
        {title && <h2 className="mb-4 text-lg font-semibold text-ink-950">{title}</h2>}
        <button onClick={onClose} className="absolute right-4 top-4 text-ink-400 transition-colors hover:text-ink-700" aria-label="关闭">
          <X size={18} />
        </button>
        {children}
      </div>
    </div>,
    host,
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
