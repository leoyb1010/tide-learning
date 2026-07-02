"use client";

import { WarningCircle } from "@phosphor-icons/react/dist/ssr";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-28 text-center">
      <WarningCircle size={40} weight="light" className="text-error" />
      <h1 className="mt-5 text-2xl font-semibold tracking-tight text-ink-950">出错了</h1>
      <p className="mt-2 text-ink-500">页面加载遇到问题，请稍后重试</p>
      <button onClick={reset} className="mt-7 rounded-xl bg-accent-600 px-6 py-3 text-sm font-medium text-white transition-all duration-200 [transition-timing-function:var(--ease-out-expo)] hover:bg-accent-700 active:scale-[0.97]">重试</button>
    </div>
  );
}
