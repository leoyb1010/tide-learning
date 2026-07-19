"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { CornersOut, CornersIn, Sparkle } from "@phosphor-icons/react";
import { track } from "@/lib/analytics-client";

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

/**
 * 审计修复(P0)：middleware 的 CSP 是 `script-src 'self' 'nonce-…'`,而 **srcdoc iframe 继承父文档 CSP**,
 * 课件运行时的内联 <script> 无 nonce 会被整段拦截——翻页/高度上报/测验判分全废。
 * 服务端页面把本次请求的 nonce 传进来,这里注入到课件 HTML 的 <script> 标签上。
 * 课件 HTML 是我方管线产物(过 CSP/lint 硬门后落库),给它发 nonce 不扩大信任面;sandbox 铁律不变。
 */
function injectNonce(html: string, nonce: string | undefined): string {
  if (!nonce || !/^[\w+/=-]+$/.test(nonce)) return html;
  return html.replace(/<script\b(?![^>]*\bnonce=)/gi, `<script nonce="${nonce}"`);
}

export function HtmlCourseware({
  html,
  lessonId,
  nonce,
  onPage,
  initialPage,
}: {
  html: string;
  lessonId?: string;
  /** 父页 CSP nonce(middleware x-nonce)。不传则不注入——独立/测试渲染场景仍可用。 */
  nonce?: string;
  /** 翻页课件页码变化回调(index 0 起, total 总页数)。宿主用它接进度上报(蓝图 D1 补口)。 */
  onPage?: (index: number, total: number) => void;
  /** v4.2 续读:上次读到的页(0-indexed)。收到 ct-ready 后一次性下发 ct-goto 恢复位置。 */
  initialPage?: number;
}) {
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
  // 蓝图 D2：已上报过的 quiz 块（同一次会话内去重，服务端 upsert 兜底幂等）。
  // 注：Player 侧以 key={lesson.id} 挂载本组件,换课必重挂,Set 不会跨课残留(审计修复 H1)。
  const reportedQuizRef = useRef<Set<string>>(new Set());
  // 续读 ct-goto 只发一次(ct-ready 会重播)。
  const sentGotoRef = useRef(false);
  const srcdocHtml = useMemo(() => injectNonce(html, nonce), [html, nonce]);

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
        // v4.2 续读:一次性恢复上次读到的页(ct-ready 重播时靠 ref 幂等,不反复跳页打断用户)。
        if (initialPage && initialPage > 0 && !sentGotoRef.current) {
          sentGotoRef.current = true;
          postToFrame({ type: "ct-goto", page: initialPage });
        }
      } else if (d.type === "ct-page" && typeof d.index === "number" && typeof d.total === "number") {
        setPage({ index: d.index, total: d.total });
        // 蓝图 D1 补口：HTML 课件此前只更新页码 UI、从不上报进度——主力课型的 streak/完课恒空。
        onPage?.(d.index, d.total);
      } else if (d.type === "ct-flash" && lessonId) {
        // 审计修复：ct-flash 此前是无人接收的死信号——翻卡行为记入前端埋点(复习意愿信号,不落业务表)。
        track("courseware_flashcard_flip", { lesson_id: lessonId, block_id: typeof d.bid === "string" ? d.bid : null });
      } else if (d.type === "ct-quiz" && lessonId && typeof d.correct === "boolean") {
        // 蓝图 D2（审查 P0-6）：课件内答题结果落库——进掌握度表，答错自动转错题复习卡。
        // 沙箱 connect-src 'none'，课件自身无法发请求，必须由宿主代发。失败静默（学习主链不受影响）。
        const bid = typeof d.bid === "string" && d.bid ? d.bid : null;
        if (bid && !reportedQuizRef.current.has(bid)) {
          reportedQuizRef.current.add(bid);
          fetch(`/api/lessons/${lessonId}/quiz-result`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              blockId: bid,
              answerIndex: typeof d.answer === "number" ? d.answer : 0,
              correct: d.correct,
            }),
          }).catch(() => {});
        }
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [postToFrame, lessonId, onPage, initialPage]);

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
  // 蓝图 B6：上限 640→760，高屏设备不再留一大截底部空白（下限与 clamp 结构不变，矮屏不回退）。
  const frameHeight = fullscreen
    ? "calc(100vh - 41px)"
    : paged
      ? "clamp(460px, calc(100vh - 240px), 760px)"
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
        srcDoc={srcdocHtml}
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
