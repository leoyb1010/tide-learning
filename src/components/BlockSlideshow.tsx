"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  CaretLeft,
  CaretRight,
  CornersOut,
  CornersIn,
  Check,
  FlagCheckered,
} from "@phosphor-icons/react";
import type { BlockWithId } from "@/lib/slides";
import { groupBlocksToSlides, slideKindLabel, type Slide } from "@/lib/slides";
import { BlockSwitch } from "./BlockRenderer";

/**
 * BlockSlideshow —— 翻页课件 · 黑板式单屏视图（客户端）。
 *
 * 把线性块数组交给纯函数 groupBlocksToSlides 切成「一幕幕单屏页」，一次只呈现一页（居中黑板/纸面），
 * 左右翻页（← → 键 + 底部翻页控件 + 页码 1/N + 顶部进度条），framer-motion 方向滑动/淡入转场，
 * 像看 PPT / Keynote。可全屏沉浸。翻到最后一页触发完课回调。
 *
 * 复用：每页内部仍用 BlockRenderer 的单块渲染逻辑（BlockSwitch），只是容器从长列表换成单屏页。
 * 翻卡 / quiz 判分等块内交互原样保留（各块自持 state）。
 *
 * 无障碍 / 降级：
 *   - reduce-motion：转场退化为「即时切换」（无位移，opacity 也不做长动画）。
 *   - 所有翻页控件命中区 ≥ 44px；页码用 aria-live 播报；键盘可全程操作。
 *   - 深色黑板页正文走 on-dark token（对比达标）。
 */
export function BlockSlideshow({
  blocks,
  courseId,
  initialIndex = 0,
  onSlideChange,
  onComplete,
}: {
  blocks: BlockWithId[];
  courseId?: string;
  /** 续读起始页（0-indexed）。恢复上次读到的位置；超界会被 clamp 到 [0, total-1]。默认 0（首页）。 */
  initialIndex?: number;
  /** 翻页时上报（index 从 0 起，total 为总页数）。用于把「当前页 / 总页」映射成学习进度。 */
  onSlideChange?: (index: number, total: number) => void;
  /** 抵达并停留最后一页时触发一次（用于完课）。 */
  onComplete?: () => void;
}) {
  const reduce = useReducedMotion();
  const slides = useMemo<Slide[]>(() => groupBlocksToSlides(blocks), [blocks]);
  const total = slides.length;

  // 续读：initialIndex clamp 到 [0, total-1]（total 为 0 时归 0，下方空态提前 return）。
  const [index, setIndex] = useState(() =>
    Math.max(0, Math.min(initialIndex, Math.max(0, total - 1))),
  );
  // 翻页方向：+1 下一页（新页从右滑入），-1 上一页（从左滑入）。驱动转场方向。
  const [dir, setDir] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const completedRef = useRef(false); // 完课只触发一次

  // index 越界保护（blocks 变化导致页数缩水时夹回）
  const safeIndex = Math.min(index, Math.max(0, total - 1));
  const current = slides[safeIndex];
  const isFirst = safeIndex <= 0;
  const isLast = safeIndex >= total - 1;

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(total - 1, next));
      setDir(clamped >= safeIndex ? 1 : -1);
      setIndex(clamped);
    },
    [total, safeIndex],
  );
  const goPrev = useCallback(() => goTo(safeIndex - 1), [goTo, safeIndex]);
  const goNext = useCallback(() => goTo(safeIndex + 1), [goTo, safeIndex]);

  // 上报当前页（含首次挂载），并在停留最后一页时触发一次完课
  useEffect(() => {
    if (total === 0) return;
    onSlideChange?.(safeIndex, total);
    if (safeIndex >= total - 1 && !completedRef.current) {
      completedRef.current = true;
      onComplete?.();
    }
    // onSlideChange/onComplete 由父组件 useCallback 稳定；仅页序/页数变化时上报
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeIndex, total]);

  // 键盘导航：← 上一页 / → 或空格 下一页。焦点在输入类元件内时不劫持（不干扰块内答题/输入）。
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  onKeyRef.current = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
    if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); goNext(); }
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // 全屏：优先原生 Fullscreen API（沉浸），失败降级为 CSS fixed 满屏（fullscreen state 同时驱动）。
  const toggleFullscreen = useCallback(async () => {
    const el = rootRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen?.();
      } else {
        await document.exitFullscreen?.();
      }
    } catch {
      // 原生全屏被拒（iframe 权限 / 浏览器策略）：仅切换 CSS 满屏兜底
      setFullscreen((v) => !v);
    }
  }, []);

  // 同步原生全屏态到 state（用户按 Esc 退出全屏也能同步）
  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  if (total === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--ink2)]">
        本课暂无内容块
      </div>
    );
  }

  const isDarkBoard = current.kind === "scene" || current.kind === "summary";
  const pct = ((safeIndex + 1) / total) * 100;

  // 转场变体：reduce-motion 下位移/缩放归零、时长压到极短（即时切换）。
  // 方向滑动 + 轻微景深（进入页略微从远处推近：scale 0.965 → 1；退出页略微退远）——像「推进一页」。
  const enterX = reduce ? 0 : dir > 0 ? 52 : -52;
  const exitX = reduce ? 0 : dir > 0 ? -52 : 52;
  const enterScale = reduce ? 1 : 0.965;
  const exitScale = reduce ? 1 : 0.985;

  return (
    <div
      ref={rootRef}
      className={`flex flex-col ${
        fullscreen
          ? "fixed inset-0 bg-[var(--surface2)] p-4 sm:p-6"
          : "rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface2)] p-3 shadow-[var(--card),var(--inner-hi)] sm:p-4"
      }`}
      style={fullscreen ? { zIndex: "var(--z-focus)" } : undefined}
    >
      {/* 顶部进度条 + 页序 + 全屏（进度条更精致：内嵌轨 + 红芯 + 右缘流光） */}
      <div className="mb-3 flex items-center gap-3">
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-inset)] shadow-[inset_0_1px_2px_rgba(35,41,53,.08)]"
          role="progressbar"
          aria-valuenow={safeIndex + 1}
          aria-valuemin={1}
          aria-valuemax={total}
          aria-label={`阅读进度：第 ${safeIndex + 1} 页，共 ${total} 页`}
        >
          <div className="slide-progress-fill h-full rounded-full bg-[var(--red)]" style={{ width: `${pct}%` }} />
        </div>
        <span
          className="mono shrink-0 text-[12px] font-semibold tabular-nums text-[var(--ink3)]"
          aria-live="polite"
          aria-label={`第 ${safeIndex + 1} 页，共 ${total} 页`}
        >
          <span className="text-[var(--red-ink)]">{safeIndex + 1}</span> / {total}
        </span>
        <button
          type="button"
          onClick={toggleFullscreen}
          className="studio-press grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink3)] transition-colors hover:text-[var(--ink)]"
          aria-label={fullscreen ? "退出全屏" : "全屏播放"}
        >
          {fullscreen ? <CornersIn size={16} /> : <CornersOut size={16} />}
        </button>
      </div>

      {/* 黑板/纸面单屏舞台：一次一页，framer-motion 方向转场。
          min-h 给单屏舒适高度；内部超高的少数页可自身滚动（overflow-y-auto），不撑破舞台。 */}
      <div className="relative flex-1">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={current.id}
            custom={dir}
            initial={{ opacity: 0, x: enterX, scale: enterScale }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: exitX, scale: exitScale }}
            transition={reduce ? { duration: 0.12 } : { type: "spring", stiffness: 260, damping: 30, mass: 0.9 }}
            style={{ transformOrigin: dir > 0 ? "left center" : "right center", willChange: "transform, opacity" }}
            className={`flex ${
              fullscreen ? "min-h-[calc(100vh-160px)]" : "min-h-[440px] sm:min-h-[520px]"
            } flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] ${
              isDarkBoard ? "slide-board" : "slide-paper"
            }`}
          >
            {/* 页眉「粉笔标」：语义标签 + 页序，黑板页走 on-dark 配色 */}
            <div
              className={`flex items-center gap-2 border-b px-5 py-3 ${
                isDarkBoard ? "border-white/10" : "border-[var(--border)]"
              }`}
            >
              <span
                className="mono inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
                style={
                  isDarkBoard
                    ? { background: "rgba(255,255,255,.10)", color: "var(--ink-on-dark-2)" }
                    : { background: "var(--surface-inset)", color: "var(--ink3)" }
                }
              >
                {slideKindLabel(current.kind)}
              </span>
              <div className="flex-1" />
              <span
                className="mono text-[11px] tabular-nums"
                style={{ color: isDarkBoard ? "var(--ink-on-dark-2)" : "var(--ink4)" }}
              >
                {safeIndex + 1} / {total}
              </span>
            </div>

            {/* 页内容：居中限宽，纵向排布本页块（通常 1-3 块）。复用 BlockSwitch 单块渲染。
                slide-stagger：每次换页 motion.div 按 key 重挂，页内块按 --i 逐个上浮（reduce-motion 静态直显）。 */}
            <div className="flex flex-1 items-center overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
              <div className={`mx-auto flex w-full max-w-3xl flex-col gap-5 sm:gap-6 ${reduce ? "" : "slide-stagger"}`}>
                {current.blocks.map((block, bi) => (
                  <div key={block.id} data-block-id={block.id} style={{ "--i": bi } as CSSProperties}>
                    <BlockSwitch block={block} courseId={courseId} />
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* 底部翻页控件 + 圆点指示 */}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={goPrev}
          disabled={isFirst}
          className="studio-press group inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 text-[13px] font-semibold text-[var(--ink2)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)] disabled:cursor-default disabled:opacity-40"
          aria-label="上一页"
        >
          <CaretLeft size={16} className="transition-transform group-enabled:group-hover:-translate-x-0.5" />
          <span className="hidden sm:inline">上一页</span>
        </button>

        {/* 圆点页码指示：可点击直达；当前页红色拉长。页多时保持可横向滚动不换行。 */}
        <div className="flex flex-1 items-center justify-center gap-1.5 overflow-x-auto px-1" role="tablist" aria-label="页码">
          {slides.map((s, i) => {
            const active = i === safeIndex;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => goTo(i)}
                role="tab"
                aria-selected={active}
                aria-label={`第 ${i + 1} 页`}
                className="grid h-11 w-4 shrink-0 place-items-center"
              >
                <span
                  className={`block rounded-full transition-all duration-300 ${
                    active ? "h-2 w-6 bg-[var(--red)]" : "h-2 w-2 bg-[var(--border2)] hover:bg-[var(--ink4)]"
                  }`}
                />
              </button>
            );
          })}
        </div>

        {isLast ? (
          <span className="mono inline-flex h-11 items-center gap-1.5 rounded-[12px] bg-[var(--ok-soft)] px-4 text-[13px] font-semibold text-[var(--ok)]">
            <FlagCheckered size={15} weight="fill" /> 已到末页
          </span>
        ) : (
          <button
            type="button"
            onClick={goNext}
            className="studio-press cta-glow group inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-[12px] bg-[var(--red)] px-4 text-[13px] font-bold text-white transition-colors hover:bg-[var(--red-hover)]"
            aria-label="下一页"
          >
            <span className="hidden sm:inline">下一页</span>
            <CaretRight size={16} className="transition-transform group-hover:translate-x-0.5" />
          </button>
        )}
      </div>

      {/* 末页完课提示条（非全屏时显示，避免抢全屏沉浸；给学习页一个「学完」信号锚点） */}
      {isLast && !fullscreen && (
        <div className="mt-2.5 flex items-center justify-center gap-1.5 text-[12px] text-[var(--ink3)]">
          <Check size={13} weight="bold" className="text-[var(--ok)]" />
          已翻完全部 {total} 页
        </div>
      )}
    </div>
  );
}
