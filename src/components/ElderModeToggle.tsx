"use client";

import { useMode } from "./ModeProvider";

// §13.6 长辈模式：设置页可切换、字号可调（P2 完整体验，此处提供入口与开关）
// STUDIO v2：仅用 CSS 变量 token，作为「偏好」分区内的一个子块（无外层大卡，由父分区提供卡）。
export function ElderModeToggle() {
  const { mode, fontScale, setMode, setFontScale } = useMode();
  const isElder = mode === "elder";
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-[var(--ink)]">长辈模式</p>
          <p className="mt-0.5 text-[12px] text-[var(--ink3)]">大字、大按钮、低密度、降噪，去除诱导</p>
        </div>
        <button
          onClick={() => setMode(isElder ? "standard" : "elder")}
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${isElder ? "bg-[var(--red)]" : "bg-[var(--surface-inset)]"}`}
          aria-pressed={isElder}
          title="切换长辈模式"
          aria-label="切换长辈模式"
        >
          <span
            className={`absolute top-0.5 h-6 w-6 rounded-full bg-[var(--surface)] shadow-[var(--card)] transition-transform ${isElder ? "translate-x-5" : "translate-x-0.5"}`}
          />
        </button>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[12px] text-[var(--ink3)]">字号</p>
          <p className="mono text-[12px] font-semibold text-[var(--ink2)]">{Math.round(fontScale * 100)}%</p>
        </div>
        <input
          type="range"
          min={1}
          max={1.5}
          step={0.05}
          value={fontScale}
          onChange={(e) => setFontScale(Number(e.target.value))}
          className="w-full accent-[var(--red)]"
          aria-label="调整字号"
        />
      </div>
    </div>
  );
}
