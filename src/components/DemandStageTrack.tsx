"use client";

import { WaveProgress, TidalReveal } from "./motion";
import { CheckCircle, CircleNotch, Circle } from "@phosphor-icons/react/dist/ssr";

/**
 * DemandStageTrack — Kickstarter 式制作进度剧场（C2.2）。
 * 用 WaveProgress 表现整体水位推进，阶段点标注每一环节状态。
 * 阶段顺序：scripting → recording → editing → reviewing → published。
 */

export interface StageItem {
  stage: string;
  status: string; // pending / active / done
  note: string | null;
  updatedAt: string | null;
}

const STAGE_LABELS: Record<string, string> = {
  scripting: "脚本撰写",
  recording: "录制",
  editing: "剪辑",
  reviewing: "审校",
  published: "上线",
};
const STAGE_ORDER = ["scripting", "recording", "editing", "reviewing", "published"];

export function DemandStageTrack({ stages }: { stages: StageItem[] }) {
  // 按固定顺序排列，补齐缺失阶段。
  const byStage = new Map(stages.map((s) => [s.stage, s]));
  const ordered = STAGE_ORDER.map(
    (stage) => byStage.get(stage) ?? { stage, status: "pending", note: null, updatedAt: null },
  );

  const doneCount = ordered.filter((s) => s.status === "done").length;
  const activeIdx = ordered.findIndex((s) => s.status === "active");
  // 进度水位：已完成阶段 + 进行中阶段算半格。
  const progress = (doneCount + (activeIdx >= 0 ? 0.5 : 0)) / STAGE_ORDER.length;

  return (
    <TidalReveal>
      <div className="rounded-2xl border border-ink-100 bg-paper-raised p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink-950">制作进度剧场</h2>
          <span className="num text-sm text-ink-500">
            {doneCount}/{STAGE_ORDER.length} 环节完成
          </span>
        </div>

        <WaveProgress value={progress} height={12} className="mb-6" />

        <ol className="grid grid-cols-1 gap-3 sm:grid-cols-5">
          {ordered.map((s, i) => {
            const label = STAGE_LABELS[s.stage] ?? s.stage;
            const done = s.status === "done";
            const active = s.status === "active";
            return (
              <li
                key={s.stage}
                className={`flex flex-col items-start gap-1.5 rounded-xl border p-3 transition-colors duration-[var(--dur-normal)] ${
                  done
                    ? "border-success/30 bg-success/5"
                    : active
                      ? "border-accent-300 bg-accent-50"
                      : "border-ink-100 bg-paper"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {done ? (
                    <CheckCircle size={18} weight="fill" className="text-success" />
                  ) : active ? (
                    <CircleNotch size={18} weight="bold" className="animate-spin text-accent-600" />
                  ) : (
                    <Circle size={18} className="text-ink-300" />
                  )}
                  <span
                    className={`text-sm font-medium ${
                      done ? "text-success" : active ? "text-accent-700" : "text-ink-500"
                    }`}
                  >
                    <span className="num mr-1 text-xs text-ink-300">{i + 1}</span>
                    {label}
                  </span>
                </div>
                {s.note && <p className="text-xs text-ink-500">{s.note}</p>}
              </li>
            );
          })}
        </ol>
      </div>
    </TidalReveal>
  );
}
