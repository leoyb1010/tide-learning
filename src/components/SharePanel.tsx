"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ShareNetwork,
  DownloadSimple,
  Link as LinkIcon,
  ShareFat,
  CheckCircle,
  Spinner,
  X,
} from "@phosphor-icons/react";
import { SPRING_TIDE } from "./motion";

/**
 * SharePanel —— v3.0 全局分享面板（client）。
 *
 * 触发按钮 → elev-3 浮层，内含分享图预览 + 三动作：
 *   ① 下载图片（fetch blob → a[download]）
 *   ② 复制链接（navigator.clipboard，成功反馈）
 *   ③ 系统分享（navigator.share，优先带图片，降级仅链接；不可用则隐藏）
 *
 * 分享图走已就绪服务：GET /api/share-card/{kind}?{params}（竖版默认）。
 * STUDIO 语义 token；reduce-motion 由 framer-motion + 全局降级；触达 ≥44px；零 em-dash。
 */

/** 与 /api/share-card/[kind] 服务端 Kind 联合保持一致。 */
export type ShareKind =
  | "student-card"
  | "week-report"
  | "course-done"
  | "note-quote"
  | "streak"
  | "exam-result";

export interface SharePanelProps {
  /** 分享图种类，决定拉取哪张图。 */
  kind: ShareKind;
  /** 透传给分享图服务的 query（如 courseId / noteId / examId）。 */
  params?: Record<string, string | number | undefined | null>;
  /** 面板标题；默认「分享」。 */
  title?: string;
  /** 复制/系统分享用的落地链接；缺省时「复制链接」禁用。 */
  shareUrl?: string;
  /** 自定义触发器；缺省渲染默认图标按钮。 */
  trigger?: ReactNode;
  /** 触发按钮的无障碍标签（默认触发器用）。 */
  triggerLabel?: string;
  /** 触发按钮附加类名（默认触发器用）。 */
  triggerClassName?: string;
  /** 下载文件名（不含扩展名）；默认按 kind 派生。 */
  fileName?: string;
}

/** 把 params 拼成稳定 query 串（跳过空值，键排序保证缓存命中一致）。 */
function buildQuery(params?: SharePanelProps["params"]): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const key of Object.keys(params).sort()) {
    const v = params[key];
    if (v === undefined || v === null || v === "") continue;
    sp.set(key, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

type ActionState = "idle" | "busy" | "done";

export function SharePanel({
  kind,
  params,
  title = "分享",
  shareUrl,
  trigger,
  triggerLabel = "分享",
  triggerClassName,
  fileName,
}: SharePanelProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const openPanel = useCallback(() => setOpen(true), []);
  const closePanel = useCallback(() => setOpen(false), []);

  // 关闭后把焦点还给触发器（无障碍：焦点不丢）。
  useEffect(() => {
    if (!open) triggerRef.current?.focus?.();
  }, [open]);

  return (
    <>
      {trigger ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={openPanel}
          aria-haspopup="dialog"
          aria-label={triggerLabel}
          className="contents"
        >
          {trigger}
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          onClick={openPanel}
          aria-haspopup="dialog"
          aria-label={triggerLabel}
          className={
            triggerClassName ??
            "group studio-press inline-flex h-11 w-11 items-center justify-center rounded-[12px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink2)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]/50"
          }
        >
          <ShareNetwork size={18} weight="bold" className="icon-nudge" />
        </button>
      )}

      <SharePanelModal
        open={open}
        onClose={closePanel}
        kind={kind}
        params={params}
        title={title}
        shareUrl={shareUrl}
        fileName={fileName}
      />
    </>
  );
}

/** 面板本体：抽出以便 Portal 层与触发器解耦，也方便复用现有 Dialog 语义。 */
function SharePanelModal({
  open,
  onClose,
  kind,
  params,
  title,
  shareUrl,
  fileName,
}: {
  open: boolean;
  onClose: () => void;
  kind: ShareKind;
  params?: SharePanelProps["params"];
  title: string;
  shareUrl?: string;
  fileName?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const imgSrc = `/api/share-card/${kind}${buildQuery(params)}`;
  const dlName = `${fileName ?? kind}.png`;

  // Portal 挂载点：面板须逃出触发处的局部堆叠上下文（如笔记详情 .studio-rise
  // 容器因 transform 造成的 stacking context），否则 z-index 再高也被祖先困住、
  // 被吸顶栏/其他浮层遮挡。挂到 body 后与全站浮层同处根上下文，z-share 生效。
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [copyState, setCopyState] = useState<ActionState>("idle");
  const [dlState, setDlState] = useState<ActionState>("idle");
  const [canNativeShare, setCanNativeShare] = useState(false);

  // 侦测系统分享能力（仅客户端，且需 HTTPS/安全上下文）。
  useEffect(() => {
    setCanNativeShare(
      typeof navigator !== "undefined" && typeof navigator.share === "function",
    );
  }, []);

  // 每次打开重置瞬态：图片重新加载、动作反馈归零。
  useEffect(() => {
    if (open) {
      setImgLoaded(false);
      setImgError(false);
      setCopyState("idle");
      setDlState("idle");
    }
  }, [open]);

  // Esc 关闭 + Tab 焦点陷阱 + 滚动锁 + 初始焦点。
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab") {
        trapFocus(e, panelRef.current);
      }
    };
    document.addEventListener("keydown", onKey);
    const raf = requestAnimationFrame(() =>
      panelRef.current
        ?.querySelector<HTMLElement>("[data-autofocus]")
        ?.focus(),
    );
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
    };
  }, [open, onClose]);

  // ── 动作①：下载图片 ─────────────────────────────
  const handleDownload = useCallback(async () => {
    if (dlState === "busy") return;
    setDlState("busy");
    try {
      const res = await fetch(imgSrc);
      if (!res.ok) throw new Error(`bad status ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = dlName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // 释放对象 URL：延后一拍，确保下载已触发。
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDlState("done");
      window.setTimeout(() => setDlState("idle"), 2200);
    } catch {
      setDlState("idle");
    }
  }, [dlState, imgSrc, dlName]);

  // ── 动作②：复制链接 ─────────────────────────────
  const handleCopy = useCallback(async () => {
    if (!shareUrl || copyState === "busy") return;
    setCopyState("busy");
    const ok = await copyText(shareUrl);
    if (ok) {
      setCopyState("done");
      window.setTimeout(() => setCopyState("idle"), 2200);
    } else {
      setCopyState("idle");
    }
  }, [shareUrl, copyState]);

  // ── 动作③：系统分享（优先带图片，降级仅链接/文本）──
  const handleNativeShare = useCallback(async () => {
    if (typeof navigator === "undefined" || typeof navigator.share !== "function")
      return;
    const text = title;
    // 尝试携带图片文件分享；能力探测失败时回退纯链接。
    try {
      const res = await fetch(imgSrc);
      if (res.ok) {
        const blob = await res.blob();
        const file = new File([blob], dlName, {
          type: blob.type || "image/png",
        });
        const withFile: ShareData & { files?: File[] } = {
          title: text,
          text,
          url: shareUrl,
          files: [file],
        };
        const canFile =
          typeof navigator.canShare === "function"
            ? navigator.canShare(withFile)
            : false;
        if (canFile) {
          await navigator.share(withFile);
          return;
        }
      }
    } catch {
      // 落到纯链接分支。
    }
    try {
      await navigator.share({ title: text, text, url: shareUrl });
    } catch {
      // 用户取消或不支持：静默。
    }
  }, [imgSrc, dlName, title, shareUrl]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 flex items-center justify-center p-4"
          style={{ zIndex: "var(--z-share)" }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
        >
          {/* scrim：完整覆盖视口 */}
          <motion.div
            className="absolute inset-0 bg-[#0e1116]/55 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={onClose}
          />
          {/* 面板：elev-3 浮层。小屏限高可滚，图预览不撑破视口 */}
          <motion.div
            ref={panelRef}
            className="elev-3 relative flex max-h-[90vh] w-full max-w-sm flex-col overflow-y-auto overflow-x-hidden rounded-3xl p-5"
            initial={{ opacity: 0, y: 22, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ ...SPRING_TIDE, type: "spring" }}
          >
            {/* 顶边红点睛：克制的 1px 品牌信号 */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
              style={{
                background:
                  "linear-gradient(90deg, transparent, var(--red) 50%, transparent)",
                opacity: 0.7,
              }}
            />

            <div className="mb-4 flex items-center justify-between gap-3">
              <h2
                id={headingId}
                className="text-[15px] font-semibold text-[var(--ink)]"
              >
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭"
                className="studio-press inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--ink3)] transition-colors hover:bg-[var(--surface-inset)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]/50"
              >
                <X size={16} weight="bold" />
              </button>
            </div>

            {/* 分享图预览：竖版 3:4，加载骨架 + 出错兜底。shrink-0 防止在限高滚动容器里被压扁 */}
            <div
              className="relative mb-4 w-full shrink-0 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-inset)]"
              style={{ aspectRatio: "1080 / 1440" }}
            >
              {!imgLoaded && !imgError && (
                <div
                  className="share-skeleton absolute inset-0"
                  aria-hidden
                />
              )}
              {imgError ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
                  <span className="text-[13px] text-[var(--ink3)]">
                    预览暂不可用
                  </span>
                </div>
              ) : (
                // 预览图非交互装饰，动作按钮承载语义；这里用 alt 传达内容。
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imgSrc}
                  alt={`${title}预览图`}
                  className="absolute inset-0 h-full w-full object-cover"
                  style={{
                    opacity: imgLoaded ? 1 : 0,
                    transition: "opacity .3s ease",
                  }}
                  onLoad={() => setImgLoaded(true)}
                  onError={() => setImgError(true)}
                  draggable={false}
                />
              )}
            </div>

            {/* 三动作 */}
            <div className="flex flex-col gap-2.5">
              <ActionButton
                data-autofocus
                onClick={handleDownload}
                state={dlState}
                idleIcon={<DownloadSimple size={17} weight="bold" />}
                idleLabel="下载图片"
                busyLabel="生成中"
                doneLabel="已下载"
              />
              <ActionButton
                onClick={handleCopy}
                state={copyState}
                disabled={!shareUrl}
                idleIcon={<LinkIcon size={17} weight="bold" />}
                idleLabel="复制链接"
                busyLabel="复制中"
                doneLabel="已复制"
              />
              {canNativeShare && (
                <ActionButton
                  onClick={handleNativeShare}
                  state="idle"
                  idleIcon={<ShareFat size={17} weight="bold" />}
                  idleLabel="系统分享"
                />
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** 单个动作按钮：idle / busy / done 三态，触达 44px，图标切换有反馈。 */
function ActionButton({
  onClick,
  state,
  disabled,
  idleIcon,
  idleLabel,
  busyLabel,
  doneLabel,
  ...rest
}: {
  onClick: () => void;
  state: ActionState;
  disabled?: boolean;
  idleIcon: ReactNode;
  idleLabel: string;
  busyLabel?: string;
  doneLabel?: string;
} & Record<`data-${string}`, unknown>) {
  const done = state === "done";
  const busy = state === "busy";
  const label = busy ? busyLabel ?? idleLabel : done ? doneLabel ?? idleLabel : idleLabel;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      aria-label={idleLabel}
      className={`studio-press group inline-flex h-11 w-full items-center justify-center gap-2 rounded-[13px] border text-[14px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]/50 disabled:cursor-not-allowed disabled:opacity-40 ${
        done
          ? "border-[var(--ok)]/40 bg-[var(--ok-soft)] text-[var(--ok)]"
          : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:border-[var(--border2)] hover:bg-[var(--surface-inset)]"
      }`}
      {...rest}
    >
      <span className="inline-flex items-center justify-center">
        {done ? (
          <CheckCircle size={17} weight="fill" />
        ) : busy ? (
          <Spinner size={17} weight="bold" className="share-spin" />
        ) : (
          <span className="icon-nudge text-[var(--ink2)] transition-colors group-hover:text-[var(--red)]">
            {idleIcon}
          </span>
        )}
      </span>
      <span>{label}</span>
    </button>
  );
}

/** Tab 焦点陷阱：与 Dialog.tsx 语义一致。 */
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

/** 复制文本：优先 Clipboard API，降级 execCommand。返回是否成功。 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 落到降级路径。
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export default SharePanel;
