"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { CornersOut, CornersIn, Sparkle } from "@phosphor-icons/react";

/**
 * HtmlCourseware —— AI 生成的自包含 HTML 课件的**沙箱渲染器**（v3.4：默认翻页，可切滚动）。
 *
 * 见计划 §7：把不可信课件当敌意代码。用 `<iframe srcDoc sandbox="allow-scripts">`——
 * **绝不加 allow-same-origin**（否则被嵌文档可自行卸掉 sandbox 拿到父页同源权限）。
 * 课件 HTML 内部已带 CSP（掐断网络/外链）、reduce-motion、只动 transform/opacity 的动效（见 courseware-html.ts）。
 *
 * 翻页/滚动双模式：沙箱下父页读不到 iframe DOM，翻页逻辑（每 section 一页 + fit-scale + 键盘 + 页脚控件）
 * 全部在 iframe 内的运行时脚本里；本组件只负责：模式切换 UI（默认翻页，localStorage 记忆偏好）、
 * 按模式定 iframe 高度（翻页=固定视口档；滚动=postMessage 上报的全高）、全屏、键盘转发。
 * 协议（postMessage，均校验 event.source）：
 *   iframe → 父：ct-ready{pages}（运行时具备翻页能力）· ct-page{index,total} · ct-height{height}（仅滚动模式）
 *   父 → iframe：ct-mode{mode} · ct-nav{dir}（键盘转发）
 * 旧课件（无新运行时）不会发 ct-ready → 不显示切换 UI，按滚动模式用上报高度渲染，零破坏。
 */

type ViewMode = "paged" | "scroll";
const VIEW_PREF_KEY = "tide-courseware-view";

export function HtmlCourseware({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number>(560);
  const [fullscreen, setFullscreen] = useState(false);
  const [mode, setMode] = useState<ViewMode>("paged");
  const [pagedReady, setPagedReady] = useState(false); // 收到 ct-ready 才认翻页能力（旧课件回落滚动）
  const [page, setPage] = useState<{ index: number; total: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<ViewMode>("paged");
  modeRef.current = mode;
  // 课件是否在视口内——键盘翻页只在可见时劫持，避免课件滚出屏幕后仍吞掉 ←/→/空格。
  const visibleRef = useRef(true);

  // 视图偏好：默认翻页；用户切过则记住（挂载时读一次）。
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_PREF_KEY);
      if (saved === "scroll" || saved === "paged") setMode(saved);
    } catch {
      /* 隐私模式等场景读不了就用默认 */
    }
  }, []);

  const postToFrame = useCallback((msg: Record<string, unknown>) => {
    // sandbox 无 allow-same-origin 时 iframe 为不透明源，只能用 '*'（内容是我方产物且无敏感数据）。
    iframeRef.current?.contentWindow?.postMessage(msg, "*");
  }, []);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      // 只接受来自本 iframe 的消息；sandbox 下 contentWindow 引用仍可比对。
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
      const d = e.data;
      if (!d || typeof d !== "object") return;
      if (d.type === "ct-height" && typeof d.height === "number") {
        // clamp：防异常极值；上限给足长课件，下限保证不塌陷。
        setHeight(Math.max(240, Math.min(20000, Math.round(d.height))));
      } else if (d.type === "ct-ready") {
        // ct-ready 会重播（对抗 hydration 竞态），需幂等：不覆盖已有页码。
        setPagedReady(true);
        if (typeof d.pages === "number" && d.pages > 0) {
          setPage((p) => p ?? { index: 0, total: d.pages as number });
        }
        // 运行时就绪后同步当前模式（覆盖 iframe 内的默认翻页，比如用户偏好是滚动）。
        postToFrame({ type: "ct-mode", mode: modeRef.current });
      } else if (d.type === "ct-page" && typeof d.index === "number" && typeof d.total === "number") {
        setPage({ index: d.index, total: d.total });
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [postToFrame]);

  const switchMode = useCallback(
    (m: ViewMode) => {
      setMode(m);
      try {
        localStorage.setItem(VIEW_PREF_KEY, m);
      } catch {
        /* 存不了不影响本次使用 */
      }
      postToFrame({ type: "ct-mode", mode: m });
    },
    [postToFrame],
  );

  // 课件可见性：滚出视口后不再劫持键盘（否则用户在页面别处按空格会被课件吞掉）。
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (ents) => {
        if (ents[0]) visibleRef.current = ents[0].isIntersecting;
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // 键盘转发（iframe 未获焦时也能 ←/→/空格 翻页）。不劫持的场景：
  // 焦点在输入元件 / 按钮 / 链接 / 可编辑区（否则空格会翻页而非激活按钮），或课件已滚出视口。
  useEffect(() => {
    if (!(pagedReady && mode === "paged")) return;
    const onKey = (e: KeyboardEvent) => {
      if (!visibleRef.current) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || tag === "A") return;
      if (target?.isContentEditable) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        postToFrame({ type: "ct-nav", dir: -1 });
      } else if (e.key === "ArrowRight" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        postToFrame({ type: "ct-nav", dir: 1 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pagedReady, mode, postToFrame]);

  const toggleFullscreen = useCallback(async () => {
    const el = rootRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) await el.requestFullscreen?.();
      else await document.exitFullscreen?.();
    } catch {
      setFullscreen((v) => !v);
    }
  }, []);

  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const paged = pagedReady && mode === "paged";
  // 翻页=固定视口档（单屏一页）；滚动=iframe 上报的全高；全屏恒撑满（减顶栏 41px）。
  const frameHeight = fullscreen
    ? "calc(100vh - 41px)"
    : paged
      ? "clamp(460px, calc(100vh - 260px), 640px)"
      : `${height}px`;

  return (
    <div
      ref={rootRef}
      className={`relative overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card),var(--inner-hi)] ${
        fullscreen ? "fixed inset-0 z-[var(--z-focus)] rounded-none" : ""
      }`}
    >
      {/* 顶栏：标识 + 页码 + 翻页/滚动切换 + 全屏。极简，不抢课件本身。 */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3.5 py-2">
        <span className="mono inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-[var(--ink3)]">
          <Sparkle size={12} weight="fill" className="text-[var(--red)]" /> 精品课件
        </span>
        <div className="flex items-center gap-2">
          {paged && page && page.total > 1 && (
            <span className="mono text-[11px] tabular-nums text-[var(--ink3)]" aria-live="polite">
              <span className="text-[var(--red-ink)]">{page.index + 1}</span> / {page.total}
            </span>
          )}
          {pagedReady && (
            <div
              className="flex items-center rounded-[9px] border border-[var(--border)] bg-[var(--surface-inset)] p-0.5"
              role="tablist"
              aria-label="课件视图"
            >
              {(
                [
                  ["paged", "翻页"],
                  ["scroll", "滚动"],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => switchMode(m)}
                  className={`studio-press rounded-[7px] px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    mode === m
                      ? "bg-[var(--surface)] text-[var(--ink)] shadow-[var(--card)]"
                      : "text-[var(--ink3)] hover:text-[var(--ink)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="studio-press grid h-8 w-8 place-items-center rounded-[9px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink3)] transition-colors hover:text-[var(--ink)]"
            aria-label={fullscreen ? "退出全屏" : "全屏"}
            title={fullscreen ? "退出全屏" : "全屏"}
          >
            {fullscreen ? <CornersIn size={15} /> : <CornersOut size={15} />}
          </button>
        </div>
      </div>
      <iframe
        ref={iframeRef}
        srcDoc={html}
        // 安全核心：只给 allow-scripts；绝不给 allow-same-origin / allow-top-navigation / allow-popups / allow-forms。
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        loading="lazy"
        title="AI 课件"
        className="block w-full border-0 bg-white"
        style={{ height: frameHeight }}
        // 握手兜底：若运行时的 ct-ready 早于本组件挂监听（SSR/hydration 竞态），load 后再要一次。
        onLoad={() => postToFrame({ type: "ct-hello" })}
      />
    </div>
  );
}
