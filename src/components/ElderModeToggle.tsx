"use client";

import { useMode } from "./ModeProvider";

// §13.6 长辈模式：设置页可切换、字号可调（P2 完整体验，此处提供入口与开关）
export function ElderModeToggle() {
  const { mode, fontScale, setMode, setFontScale } = useMode();
  return (
    <div className="space-y-4 rounded-2xl border border-ink-100 bg-paper-raised p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-ink-950">长辈模式</p>
          <p className="text-sm text-ink-500">大字、大按钮、低密度、降噪，去除诱导</p>
        </div>
        <button
          onClick={() => setMode(mode === "elder" ? "standard" : "elder")}
          className={`relative h-7 w-12 rounded-full transition-colors ${mode === "elder" ? "bg-tide-600" : "bg-ink-200"}`}
          aria-pressed={mode === "elder"}
        >
          <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-transform ${mode === "elder" ? "translate-x-5" : "translate-x-0.5"}`} />
        </button>
      </div>
      <div>
        <p className="mb-2 text-sm text-ink-500">字号：{Math.round(fontScale * 100)}%</p>
        <input
          type="range"
          min={1}
          max={1.5}
          step={0.05}
          value={fontScale}
          onChange={(e) => setFontScale(Number(e.target.value))}
          className="w-full accent-tide-600"
        />
      </div>
    </div>
  );
}
