"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkle, ArrowRight } from "@phosphor-icons/react/dist/ssr";

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

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = value.trim();
    router.push(q ? `/create?prompt=${encodeURIComponent(q)}` : "/create");
  }

  return (
    <form onSubmit={submit} className="w-full">
      <div
        className="group flex items-center gap-2 rounded-[16px] border border-[var(--hairline-on-dark)] bg-white/[0.06] p-2 pl-4 backdrop-blur-md transition-colors focus-within:border-[var(--red)]/50"
        style={{ boxShadow: "0 8px 30px -12px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)" }}
      >
        <Sparkle size={18} weight="fill" className="shrink-0 text-[var(--red)]" aria-hidden />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="说出想学的，AI 帮你造一门课…"
          aria-label="想学什么"
          maxLength={200}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-[var(--ink-on-dark)] outline-none placeholder:text-[var(--ink-on-dark-3)]"
        />
        <button
          type="submit"
          className="cta-glow studio-press inline-flex shrink-0 items-center gap-1.5 rounded-[12px] bg-[var(--red)] px-4 py-2.5 text-[13px] font-bold text-white transition-[filter] hover:brightness-105"
        >
          开始造课
          <ArrowRight size={14} weight="bold" aria-hidden />
        </button>
      </div>
    </form>
  );
}
