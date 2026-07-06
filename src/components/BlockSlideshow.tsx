"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  CaretLeft,
  CaretRight,
  CornersOut,
  CornersIn,
  Check,
  FlagCheckered,
  NotePencil,
  Keyboard,
  X,
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
 * 一页就是一页（不滚）：舞台固定高度（桌面/移动各一档，全屏用视口档），页内内容垂直居中；
 * 若某页内容超出舞台高度，用 transform:scale 等比缩到一屏（clamp 到 [0.68,1]），而非页内滚动。
 * 这样翻页时各页宽高统一、单屏一眼看完，消除「翻页后需上下滚动看同一页」。
 *
 * 键盘（学习台快捷键）：← 上一页 · → / 空格 下一页 · F 全屏 · N 记笔记 · Esc 退出全屏 · ? 快捷键帮助。
 * 全屏调笔记：传入 notePanel 时，右下角常驻「记笔记」浮钮 + N 键呼出笔记浮层（全屏 DOM 子树内，
 * 原生全屏也可用），记完关闭回到学习，不打断翻页节奏。
 *
 * 无障碍 / 降级：
 *   - reduce-motion：转场退化为「即时切换」（无位移，opacity 也不做长动画），自适应缩放不加过渡。
 *   - 所有翻页控件命中区 ≥ 44px；页码用 aria-live 播报；键盘可全程操作。
 *   - 深色黑板页正文走 on-dark token（对比达标）。
 */
export function BlockSlideshow({
  blocks,
  courseId,
  sceneBg,
  initialIndex = 0,
  onSlideChange,
  onComplete,
  notePanel,
}: {
  blocks: BlockWithId[];
  courseId?: string;
  /** SceneBlock 赛道场景背景图路径（透传给单块渲染）。无则 scene 保持纯渐变兜底。 */
  sceneBg?: string;
  /** 续读起始页（0-indexed）。恢复上次读到的位置；超界会被 clamp 到 [0, total-1]。默认 0（首页）。 */
  initialIndex?: number;
  /** 翻页时上报（index 从 0 起，total 为总页数）。用于把「当前页 / 总页」映射成学习进度。 */
  onSlideChange?: (index: number, total: number) => void;
  /** 抵达并停留最后一页时触发一次（用于完课）。 */
  onComplete?: () => void;
  /**
   * 笔记面板节点（通常是 Player 的 NoteEditor）。传入后：右下角出现「记笔记」浮钮、N 键呼出笔记浮层。
   * 面板渲染在本组件 rootRef 子树内，故原生全屏时也能呼出。不传则无笔记入口（纯翻页）。
   */
  notePanel?: ReactNode;
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
  const [noteOpen, setNoteOpen] = useState(false); // 笔记浮层开合（仅 notePanel 存在时有意义）
  const [helpOpen, setHelpOpen] = useState(false); // 快捷键帮助浮层（? 键）
  const rootRef = useRef<HTMLDivElement>(null);
  const completedRef = useRef(false); // 完课只触发一次

  // 自适应缩放：测量「舞台可用高度」vs「本页内容自然高度」，超出则等比缩到一屏（不滚）。
  const stageRef = useRef<HTMLDivElement>(null); // 舞台可视区（固定高度、居中容器）
  const contentRef = useRef<HTMLDivElement>(null); // 本页内容（自然高度，被缩放的对象）
  const [fitScale, setFitScale] = useState(1);

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

  // 键盘（学习台快捷键）：← 上一页 · → / 空格 下一页 · F 全屏 · N 记笔记 · Esc 退出全屏/关浮层 · ? 帮助。
  // 焦点在输入类元件内时只保留 Esc（关浮层），其余不劫持，避免干扰块内答题 / 笔记输入。
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  onKeyRef.current = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    const typing = tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT";
    // Esc 优先：先关帮助 / 笔记浮层，再退原生全屏（原生全屏 Esc 由浏览器接管，这里兜 CSS 兜底态）。
    if (e.key === "Escape") {
      if (helpOpen) { e.preventDefault(); setHelpOpen(false); return; }
      if (noteOpen) { e.preventDefault(); setNoteOpen(false); return; }
      // 原生全屏的 Esc 由浏览器接管退出（fullscreenchange 会同步 state）；这里只兜「CSS 满屏兜底态」的退出，
      // 避免在原生全屏已退出后误触发再次进入全屏。
      if (fullscreen && !document.fullscreenElement) { e.preventDefault(); setFullscreen(false); return; }
      return;
    }
    if (typing) return; // 输入中：除 Esc 外全部让行
    if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); }
    else if (e.key === "ArrowRight" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); goNext(); }
    else if (e.key === "f" || e.key === "F") { e.preventDefault(); void toggleFullscreen(); }
    else if (notePanel && (e.key === "n" || e.key === "N")) { e.preventDefault(); setNoteOpen((v) => !v); }
    else if (e.key === "?" || (e.key === "/" && e.shiftKey)) { e.preventDefault(); setHelpOpen((v) => !v); }
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

  // 自适应缩放（一页不滚的核心）：舞台是固定高度盒；内容以自然高度渲染，
  // 若其高度超过舞台，按 舞台高/内容高 等比缩小到刚好一屏（clamp 到 [0.68, 1]，太小则达底不再缩，
  // 极端超长页仍可读且不至于缩成蚂蚁）。measure 用 scrollHeight（不含缩放），故先复位再测。
  const measureFit = useCallback(() => {
    const stage = stageRef.current;
    const content = contentRef.current;
    if (!stage || !content) return;
    const avail = stage.clientHeight;
    // content 的自然高度：scrollHeight 不受 transform:scale 影响，可直接作分母。
    const natural = content.scrollHeight;
    if (avail <= 0 || natural <= 0) { setFitScale(1); return; }
    const next = natural > avail ? Math.max(0.68, avail / natural) : 1;
    // 量化到 3 位小数，避免亚像素抖动导致的无效重渲染。
    setFitScale((prev) => (Math.abs(prev - next) > 0.004 ? Number(next.toFixed(3)) : prev));
  }, []);

  // 换页 / 全屏切换后重测（内容变了）。用 useEffect（非 useLayoutEffect）避免 SSR 告警；
  // 首帧默认 fitScale=1，超高页会有一帧全尺寸后即缩到位（transition 平滑，无突兀闪跳）。
  useEffect(() => {
    measureFit();
    // 字体 / 图片异步就位后再测一次（图片加载会改变自然高度）。
    const raf = requestAnimationFrame(measureFit);
    return () => cancelAnimationFrame(raf);
  }, [safeIndex, fullscreen, measureFit]);

  // 视口 / 舞台尺寸变化（窗口缩放、移动端旋转、块内交互展开）时重测。
  useEffect(() => {
    const stage = stageRef.current;
    const content = contentRef.current;
    if (!stage || !content || typeof ResizeObserver === "undefined") {
      const onResize = () => measureFit();
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }
    const ro = new ResizeObserver(() => measureFit());
    ro.observe(stage);
    ro.observe(content);
    return () => ro.disconnect();
  }, [measureFit, safeIndex]);

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
        {/* 快捷键帮助（? 键或点击）。命中区 ≥44px（after 伪元素外扩）。 */}
        <button
          type="button"
          onClick={() => setHelpOpen((v) => !v)}
          className="studio-press relative grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink3)] transition-colors after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] hover:text-[var(--ink)]"
          title="键盘快捷键"
          aria-label="键盘快捷键"
          aria-expanded={helpOpen}
        >
          <Keyboard size={16} />
        </button>
        {/* 记笔记（N 键或点击）：仅当宿主传入 notePanel 时出现。 */}
        {notePanel && (
          <button
            type="button"
            onClick={() => setNoteOpen((v) => !v)}
            className={`studio-press relative grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border transition-colors after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] ${
              noteOpen
                ? "border-[var(--red-soft-border)] bg-[var(--red-soft)] text-[var(--red)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink3)] hover:text-[var(--ink)]"
            }`}
            title={noteOpen ? "关闭笔记" : "记笔记"}
            aria-label={noteOpen ? "关闭笔记" : "记笔记"}
            aria-expanded={noteOpen}
          >
            <NotePencil size={16} />
          </button>
        )}
        <button
          type="button"
          onClick={toggleFullscreen}
          className="studio-press relative grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink3)] transition-colors after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] hover:text-[var(--ink)]"
          title={fullscreen ? "退出全屏" : "全屏播放"}
          aria-label={fullscreen ? "退出全屏" : "全屏播放"}
        >
          {fullscreen ? <CornersIn size={16} /> : <CornersOut size={16} />}
        </button>
      </div>

      {/* 黑板/纸面单屏舞台：一次一页，framer-motion 方向转场。
          舞台固定高度（桌面/移动/全屏各一档），各页宽高统一；本页内容垂直居中，
          超出时用 fitScale 等比缩到一屏 —— 消除页内上下滚动，「学习一页就是一页」。 */}
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
              fullscreen
                ? "h-[calc(100vh-150px)]"
                : "h-[460px] sm:h-[540px]"
            } flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] ${
              isDarkBoard ? "slide-board" : "slide-paper"
            }`}
          >
            {/* 页眉「粉笔标」：语义标签 + 页序，黑板页走 on-dark 配色。shrink-0 不被内容压缩。 */}
            <div
              className={`flex shrink-0 items-center gap-2 border-b px-5 py-3 ${
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

            {/* 舞台可视区（固定高度、居中、不滚动）。内容以自然高度渲染并按 fitScale 等比缩到一屏。
                stageRef 量可用高度、contentRef 量内容自然高度。overflow-hidden 兜底极端页不外溢。 */}
            <div
              ref={stageRef}
              className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-5 sm:px-8 sm:py-7"
            >
              <div
                ref={contentRef}
                className="w-full"
                style={{
                  transform: fitScale < 1 ? `scale(${fitScale})` : undefined,
                  transformOrigin: "center center",
                  transition: reduce ? undefined : "transform .28s var(--ease-out-expo)",
                }}
              >
                {/* 页内容：居中限宽，纵向排布本页块（通常 1-3 块）。复用 BlockSwitch 单块渲染。
                    slide-stagger：每次换页 motion.div 按 key 重挂，页内块按 --i 逐个上浮（reduce-motion 静态直显）。 */}
                <div className={`mx-auto flex w-full max-w-3xl flex-col gap-5 sm:gap-6 ${reduce ? "" : "slide-stagger"}`}>
                  {current.blocks.map((block, bi) => (
                    <div key={block.id} data-block-id={block.id} style={{ "--i": bi } as CSSProperties}>
                      <BlockSwitch block={block} courseId={courseId} sceneBg={sceneBg} />
                    </div>
                  ))}
                </div>
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
          title="上一页"
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
                title={`第 ${i + 1} 页`}
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
            title="下一页"
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

      {/* 全屏时的「记笔记」浮钮：右下角常驻，随时呼出笔记不打断学习。触达 56px。
          非全屏时顶部已有笔记按钮，这里只在全屏补一个更醒目的浮钮。 */}
      {notePanel && fullscreen && !noteOpen && (
        <button
          type="button"
          onClick={() => setNoteOpen(true)}
          className="studio-press cta-glow fixed bottom-6 right-6 grid h-14 w-14 place-items-center rounded-full bg-[var(--red)] text-white shadow-[0_10px_30px_-8px_rgba(0,0,0,.5)] transition-transform hover:scale-105"
          style={{ zIndex: "calc(var(--z-focus) + 1)" }}
          title="记笔记 (N)"
          aria-label="记笔记 (N)"
        >
          <NotePencil size={22} weight="fill" />
        </button>
      )}

      {/* 笔记浮层：全屏 DOM 子树内（原生全屏也可用）。桌面右侧抽屉、移动端底部抽屉。
          复用宿主传入的 notePanel（NoteEditor 采集能力原样保留）。z 用 focus+1，压过舞台但让位 toast。 */}
      {notePanel && (
        <AnimatePresence>
          {noteOpen && (
            <>
              <motion.div
                className="fixed inset-0 bg-black/45"
                style={{ zIndex: "calc(var(--z-focus) + 1)" }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.2 }}
                onClick={() => setNoteOpen(false)}
                aria-hidden
              />
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-label="学习笔记"
                className="slide-note-drawer elev-3 fixed inset-x-0 bottom-0 flex max-h-[80vh] flex-col overflow-hidden rounded-t-[var(--radius-card)] sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[380px] sm:rounded-none sm:rounded-l-[var(--radius-card)]"
                style={{ zIndex: "calc(var(--z-focus) + 2)" }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={reduce ? { duration: 0.12 } : { duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--ink)]">
                    <NotePencil size={15} className="text-[var(--red)]" /> 学习笔记
                  </span>
                  <button
                    type="button"
                    onClick={() => setNoteOpen(false)}
                    className="studio-press relative grid h-9 w-9 place-items-center rounded-[10px] text-[var(--ink3)] transition-colors after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] hover:bg-[var(--surface2)] hover:text-[var(--ink)]"
                    title="关闭笔记"
                    aria-label="关闭笔记"
                  >
                    <X size={16} weight="bold" />
                  </button>
                </div>
                {/* 移动端底抽屉时给个抓手；桌面隐藏。 */}
                <div className="mx-auto mt-1.5 h-1 w-9 shrink-0 rounded-full bg-[var(--border2)] sm:hidden" aria-hidden />
                <div className="min-h-0 flex-1 overflow-hidden">{notePanel}</div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      )}

      {/* 快捷键帮助浮层：? 键或点击键盘图标呼出。列出学习台所有快捷键。 */}
      <AnimatePresence>
        {helpOpen && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/40"
              style={{ zIndex: "calc(var(--z-focus) + 3)" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.18 }}
              onClick={() => setHelpOpen(false)}
              aria-hidden
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="键盘快捷键"
              className="elev-3 fixed left-1/2 top-1/2 w-[min(92vw,360px)] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-card)] p-5"
              style={{ zIndex: "calc(var(--z-focus) + 4)" }}
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 6 }}
              transition={reduce ? { duration: 0.12 } : { type: "spring", stiffness: 320, damping: 30 }}
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-[14px] font-bold text-[var(--ink)]">
                  <Keyboard size={16} className="text-[var(--red)]" /> 键盘快捷键
                </span>
                <button
                  type="button"
                  onClick={() => setHelpOpen(false)}
                  className="studio-press relative grid h-8 w-8 place-items-center rounded-[9px] text-[var(--ink3)] transition-colors after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] hover:text-[var(--ink)]"
                  title="关闭"
                  aria-label="关闭"
                >
                  <X size={15} weight="bold" />
                </button>
              </div>
              <dl className="space-y-2">
                {(
                  [
                    ["← / →", "上一页 / 下一页"],
                    ["空格", "下一页"],
                    ["F", "全屏 / 退出全屏"],
                    ...(notePanel ? [["N", "记笔记"] as const] : []),
                    ["Esc", "退出全屏 / 关闭浮层"],
                    ["?", "显示 / 隐藏本帮助"],
                  ] as const
                ).map(([keyLabel, desc]) => (
                  <div key={keyLabel} className="flex items-center justify-between gap-3">
                    <kbd className="mono shrink-0 rounded-[7px] border border-[var(--border)] bg-[var(--surface-inset)] px-2 py-1 text-[12px] font-semibold text-[var(--ink2)]">
                      {keyLabel}
                    </kbd>
                    <span className="text-right text-[13px] text-[var(--ink3)]">{desc}</span>
                  </div>
                ))}
              </dl>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
