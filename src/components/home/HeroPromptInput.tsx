"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkle, ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { BeamFrame } from "@/components/ui/BeamFrame";

/* ============================================================
   HeroPromptInput —— 首屏悬浮输入框（局部化状态）
   把「说出想学的」输入框 + 其 useState + 提交跳转从 ActOne 抽出，
   使按键只重渲这一小块，第一幕的视差/进场 motion 子树不再参与 reconcile。
   样式/占位/maxLength/提交行为与原 ActOne 内联版本逐一对齐、保持不变。
   纯 client，不引任何 server 链。
   ============================================================ */

export function HeroPromptInput() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = value.trim();
    router.push(q ? `/create?prompt=${encodeURIComponent(q)}` : "/create");
  }

  // 反馈「点击输入框部分位置无法激活输入」：输入框是带内边距 + 前置图标 + 提交按钮的 flex 行，
  // 点在图标/内边距/空白间隙上会落到容器而非 <input>。这里在容器 mousedown 时把非按钮、非输入框
  // 本身的点击统一转焦到输入框（preventDefault 防止焦点被 mousedown 移走而闪烁）。
  function focusInput(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    if (target === inputRef.current || target.closest("button")) return;
    e.preventDefault();
    inputRef.current?.focus();
  }

  return (
    <form onSubmit={submit} className="w-full">
      {/* 背景/描边/阴影由 .hero-prompt 提供（主题跟随 --scene-*，浅暗两态都不显硬边）。
          注意不加 backdrop-blur：输入框叠在呼吸的台灯光晕上，backdrop-filter 会随
          背后每帧变化持续重采样，是首屏帧率黑洞；半透明底色本身已足够融合。
          宽屏内边距/字号随视口放大，与第一幕响应式阶梯同步。 */}
      {/* 边框扫光：把视线引向「一句话造课」这个产品核心动作。极细红环、慢扫、随主题自适应，
          与 .hero-prompt 自身的聚焦呼吸底光互补（一个走边缘、一个走底线）。line 变体最克制。 */}
      {/* P3-1：移动端纵向堆叠——输入/提示独占一行、CTA 满宽单独一行，
          避免 390px 下「开始造课」按钮把 placeholder 挤到看不全。桌面(lg)恢复同排。 */}
      <BeamFrame
        variant="line"
        tone="brand"
        onMouseDown={focusInput}
        className="hero-prompt group relative flex cursor-text flex-col gap-2 rounded-[16px] p-2 lg:flex-row lg:items-center lg:gap-2.5 lg:rounded-[18px] lg:p-2.5 lg:pl-5"
      >
        <div className="flex w-full min-w-0 flex-1 items-center gap-2 pl-2 lg:pl-0">
          <Sparkle
            size={18}
            weight="fill"
            className="shrink-0 text-[var(--red)] lg:hidden"
            aria-hidden
          />
          <Sparkle
            size={21}
            weight="fill"
            className="hidden shrink-0 text-[var(--red)] lg:block"
            aria-hidden
          />
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="说出想学的，AI 帮你造一门课…"
            aria-label="想学什么"
            maxLength={200}
            className="min-w-0 flex-1 bg-transparent text-[15px] text-[var(--scene-ink)] outline-none focus:outline-none focus-visible:outline-none placeholder:text-[var(--scene-ink-3)] lg:text-[17px]"
          />
          {/* 接近上限（>160/200）才显字数，平时不占视觉；到顶时红色提示已达上限。 */}
          {value.length > 160 && (
            <span
              className="mono shrink-0 text-[11px] tabular-nums"
              style={{ color: value.length >= 200 ? "var(--red)" : "var(--scene-ink-3)" }}
              aria-live="polite"
            >
              {value.length}/200
            </span>
          )}
        </div>
        <button
          type="submit"
          className="cta-glow studio-press inline-flex w-full shrink-0 items-center justify-center gap-1.5 rounded-[12px] bg-[var(--red)] px-4 py-3 text-[14px] font-bold text-white transition-[filter] hover:brightness-105 lg:w-auto lg:rounded-[14px] lg:px-5 lg:py-3 lg:text-[15px]"
        >
          开始造课
          <ArrowRight size={14} weight="bold" aria-hidden />
        </button>
      </BeamFrame>
    </form>
  );
}
