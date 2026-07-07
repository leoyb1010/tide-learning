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

  // onClose 存入 ref：下方键盘/焦点 effect 只依赖 [open]，不因父组件每次重渲染传入
  // 的「新 onClose 身份」而重跑。否则受控表单（如新建笔记本标题框）每敲一个字都会重挂
  // 监听并重新 requestAnimationFrame 抢焦点 → 输入框瞬间失焦、中文 IME 被打断、回车落到
  // 关闭按钮上误关弹窗，表现为「输入框乱跳、没法输入」。这是全站 11 处弹窗的共性雷区。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    setHost(document.body);
  }, []);

  useEffect(() => {
    if (!open) return;
    // open 翻转为真：记录来源焦点、锁滚动、装监听、初始聚焦——整段仅在开合翻转时跑一次。
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
      if (e.key === "Tab") trapFocus(e, panelRef.current);
    };
    document.addEventListener("keydown", onKey);
    // 初始焦点优先落在业务输入上（data-autofocus > 表单控件 > 其它可聚焦），绝不默认落到
    // 右上角关闭按钮。querySelector 对逗号并列选择器按 DOM 序返回首个命中，而关闭按钮在 DOM
    // 中先于表单控件，故必须分层查询而非把 [data-autofocus] 与 button 逗号并列。
    requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const target =
        panel.querySelector<HTMLElement>("[data-autofocus]") ??
        panel.querySelector<HTMLElement>("input:not([type='hidden']),textarea,select") ??
        panel.querySelector<HTMLElement>("button,a[href],[tabindex]:not([tabindex='-1'])");
      target?.focus();
    });
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
      // 关闭 / 卸载时还原来源焦点并清空锚点，为下次打开重新记录做准备。
      restoreFocusRef.current?.focus?.();
      restoreFocusRef.current = null;
    };
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
        <button onClick={onClose} className="absolute right-4 top-4 text-ink-400 transition-colors hover:text-ink-700" title="关闭" aria-label="关闭">
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
