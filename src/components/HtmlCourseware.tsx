"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { CornersOut, CornersIn, Sparkle } from "@phosphor-icons/react";

/**
 * HtmlCourseware —— AI 生成的自包含 HTML 课件的**沙箱渲染器**（v3.3）。
 *
 * 见计划 §7：把不可信课件当敌意代码。用 `<iframe srcDoc sandbox="allow-scripts">`——
 * **绝不加 allow-same-origin**（否则被嵌文档可自行卸掉 sandbox 拿到父页同源权限）。
 * 课件 HTML 内部已带 CSP（掐断网络/外链）、reduce-motion、只动 transform/opacity 的动效（见 courseware-html.ts）。
 *
 * 自适应高度：sandbox 无同源，父页读不到 iframe 内容高度。课件脚本用 postMessage 上报文档高度，
 * 本组件监听并校验 event.source === iframe.contentWindow 后设高度（无脚本时用兜底 min-height + 内部滚动）。
 */
export function HtmlCourseware({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number>(560);
  const [fullscreen, setFullscreen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      // 只接受来自本 iframe 的高度上报；sandbox 下 contentWindow 引用仍可比对。
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
      const d = e.data;
      if (d && d.type === "ct-height" && typeof d.height === "number") {
        // clamp：防异常极值；上限给足长课件，下限保证不塌陷。
        const h = Math.max(240, Math.min(20000, Math.round(d.height)));
        setHeight(h);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

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

  return (
    <div
      ref={rootRef}
      className={`relative overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card),var(--inner-hi)] ${
        fullscreen ? "fixed inset-0 z-[var(--z-focus)] rounded-none" : ""
      }`}
    >
      {/* 顶栏：标识 + 全屏。极简，不抢课件本身。 */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3.5 py-2">
        <span className="mono inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-[var(--ink3)]">
          <Sparkle size={12} weight="fill" className="text-[var(--red)]" /> 精品课件
        </span>
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
      <iframe
        ref={iframeRef}
        srcDoc={html}
        // 安全核心：只给 allow-scripts；绝不给 allow-same-origin / allow-top-navigation / allow-popups / allow-forms。
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        loading="lazy"
        title="AI 课件"
        className="block w-full border-0 bg-white"
        style={{ height: fullscreen ? "calc(100vh - 41px)" : height }}
      />
    </div>
  );
}
