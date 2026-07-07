"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "@phosphor-icons/react";

/**
 * SmartBackLink —— 统一「返回」入口：能回到真实来源页就回去，否则落到语义兜底页。
 *
 * 为什么不用写死的 `href="/notes"`：同一个详情页（笔记 / 笔记本 / 课程）可能从多个来源进入，
 * 硬编码返回一个固定页会丢上下文（如从「笔记本」进笔记，返回却到「笔记馆全部」）。
 *
 * 判定依据是 App Router 维护的 `window.history.state.idx`：
 *   - idx > 0 → 本次会话在站内已有更早的历史条目，`router.back()` 必回站内来源页；
 *   - idx === 0 → 新标签 / 外链直达 / 刷新，back() 会离开站点，改用 `fallback` 兜底。
 * 这样点击「返回」永远回到「你点进来的地方」，直链场景也有体面的落点。
 */
export function SmartBackLink({
  fallback,
  label,
  className,
  icon = true,
}: {
  /** 无站内来源时的兜底目标（如 /notes、/notes?view=notebook、/courses）。 */
  fallback: string;
  label: string;
  className?: string;
  /** 是否渲染左箭头图标（顶部返回用 true；文字型链接可设 false 自带 ← 字符）。 */
  icon?: boolean;
}) {
  const router = useRouter();

  return (
    <a
      href={fallback}
      onClick={(e) => {
        // 左键无修饰键才拦截；中键 / Cmd 点击照常在新标签打开兜底页。
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        // 点击时读标记（此刻所有导航 effect 早已跑完，无竞态）：站内导航过 → 回来源；否则兜底。
        let canBack = false;
        try {
          canBack = sessionStorage.getItem("tide:hasNavigated") === "1";
        } catch {
          canBack = false;
        }
        if (canBack) router.back();
        else router.push(fallback);
      }}
      className={
        className ??
        "inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--ink3)] transition-colors hover:text-[var(--ink)]"
      }
    >
      {icon && <ArrowLeft size={15} weight="bold" />} {label}
    </a>
  );
}
