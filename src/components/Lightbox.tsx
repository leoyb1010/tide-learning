"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretLeft, CaretRight, X } from "@phosphor-icons/react";

/**
 * Lightbox —— 图片灯箱（广场缩略图点击放大）。复用性组件。
 *
 * · 全屏深色 scrim（--z-modal），点 scrim / Esc / 关闭按钮退出。
 * · 多图左右切换：← → 键 + 左右箭头按钮 + 底部圆点指示当前，到头停止（不循环）。
 * · 进出场：scrim 淡入 + 图片轻缩放涌入（纯 CSS 关键帧，见 globals.css .lightbox-*）。
 *   与 Dialog 同理走 CSS 而非 framer —— Portal-to-body + 首帧即 present 时 framer 进场易冻在 initial。
 *   reduce-motion 由 CSS @media 统一降级为直显。
 * · Portal 逃逸到 body：避开广场卡片祖先 transform/animation 造成的局部堆叠上下文。
 * · focus trap + body 锁滚动（对齐 Dialog 实现）。
 * · 图片 src 仅透传调用方给定的站内/已有 mock url，组件不额外引外链。
 * · 切换/关闭按钮命中区 ≥44px。
 *
 * @param images  图片 url 列表（站内路径）
 * @param index   当前展示的下标（受控）
 * @param onIndex 请求切换下标（父维护 index 状态）
 * @param onClose 关闭回调
 */
export function Lightbox({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: string[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // 打开前的焦点锚点：卸载时还原，避免焦点落回 body 丢失缩略图位置（WCAG 2.4.3）。
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);

  const n = images.length;
  // 越界保护：index 恒落在 [0, n-1]
  const safeIndex = Math.max(0, Math.min(index, Math.max(0, n - 1)));
  const hasPrev = safeIndex > 0;
  const hasNext = safeIndex < n - 1;

  const goPrev = useCallback(() => {
    if (safeIndex > 0) onIndex(safeIndex - 1);
  }, [safeIndex, onIndex]);
  const goNext = useCallback(() => {
    if (safeIndex < n - 1) onIndex(safeIndex + 1);
  }, [safeIndex, n, onIndex]);

  useEffect(() => {
    setHost(document.body);
  }, []);

  // 焦点还原：仅挂载时记录打开前的焦点元素，卸载时还原（与键盘 effect 分离，
  // 避免 goPrev/goNext 因切换重建导致 effect 重跑时把锚点覆盖成浮层内按钮）。
  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    return () => {
      restoreFocusRef.current?.focus?.();
    };
  }, []);

  // 键盘：Esc 关闭、← → 切换、Tab focus trap（与 Dialog 一致）
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
      else if (e.key === "Tab") trapFocus(e, panelRef.current);
    };
    document.addEventListener("keydown", onKey);
    // 初始焦点落在浮层内，便于键盘操作与 trap
    requestAnimationFrame(() =>
      panelRef.current?.querySelector<HTMLElement>("[data-autofocus],button")?.focus(),
    );
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, goPrev, goNext]);

  if (!host || n === 0) return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: "var(--z-modal)" }}
      role="dialog"
      aria-modal="true"
      aria-label="图片查看"
    >
      {/* 深色 scrim：点击退出 */}
      <div
        className="lightbox-scrim-in absolute inset-0 bg-black/85"
        onClick={onClose}
        aria-hidden
      />

      {/* 内容层（阻止冒泡到 scrim，避免点图误关） */}
      <div
        ref={panelRef}
        className="relative flex h-full w-full max-w-[92vw] items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 关闭按钮（右上，命中区 ≥44px） */}
        <button
          onClick={onClose}
          data-autofocus
          title="关闭" aria-label="关闭"
          className="lb-btn absolute right-2 top-2 sm:right-4 sm:top-4"
        >
          <X size={22} weight="bold" />
        </button>

        {/* 上一张（到头隐藏） */}
        {hasPrev && (
          <button
            onClick={goPrev}
            title="上一张" aria-label="上一张"
            className="lb-btn absolute left-2 top-1/2 -translate-y-1/2 sm:left-4"
          >
            <CaretLeft size={24} weight="bold" />
          </button>
        )}

        {/* 大图：key 绑 index，切换时重放缩放进场 */}
        { }
        <img
          key={safeIndex}
          src={images[safeIndex]}
          alt=""
          className="lightbox-img-in max-h-[86vh] max-w-full rounded-[12px] object-contain shadow-[0_24px_80px_-24px_rgba(0,0,0,.7)]"
        />

        {/* 下一张（到头隐藏） */}
        {hasNext && (
          <button
            onClick={goNext}
            title="下一张" aria-label="下一张"
            className="lb-btn absolute right-2 top-1/2 -translate-y-1/2 sm:right-4"
          >
            <CaretRight size={24} weight="bold" />
          </button>
        )}

        {/* 底部圆点指示器（多图才显示） */}
        {n > 1 && (
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2">
            {images.map((_, i) => (
              <button
                key={i}
                onClick={() => onIndex(i)}
                aria-label={`第 ${i + 1} 张`}
                aria-current={i === safeIndex}
                className="lb-dot-hit"
              >
                <span
                  className={`block rounded-full transition-all ${
                    i === safeIndex ? "h-2 w-2 bg-white" : "h-1.5 w-1.5 bg-white/45"
                  }`}
                />
              </button>
            ))}
          </div>
        )}

        {/* 计数（多图，屏幕阅读器 + 视觉） */}
        {n > 1 && (
          <div className="mono absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/50 px-2.5 py-0.5 text-[11px] text-white/85 sm:top-5">
            {safeIndex + 1} / {n}
          </div>
        )}
      </div>
    </div>,
    host,
  );
}

/** Tab focus trap（对齐 Dialog）。 */
function trapFocus(e: KeyboardEvent, panel: HTMLElement | null) {
  if (!panel) return;
  const focusables = panel.querySelectorAll<HTMLElement>(
    'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
  );
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

