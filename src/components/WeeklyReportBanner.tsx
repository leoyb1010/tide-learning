"use client";

import type { CSSProperties } from "react";
import {
  TrendUp,
  TrendDown,
  Minus,
  Timer,
  CheckCircle,
  NotePencil,
  Flame,
} from "@phosphor-icons/react/dist/ssr";
import { SharePanel } from "./SharePanel";
import type { WeeklyReport, WeeklyDelta } from "@/lib/weekly-report";

/**
 * 本周学习周报（书桌横幅）—— 留存回路的「一周回望」。
 *
 * 数据由服务端 getWeeklyReport(userId) 组装成可序列化 props 传入（本文件不引任何
 * server-only 模块，仅 import type 周报形状，编译期擦除，不入客户端 bundle）。
 *
 * 视觉：elev-1 材质卡，STUDIO 语义 token。关键数字 mono + num-pop；对比上周用
 * 升/降/持平箭头着功能色（升 --ok、降 --ink3、持平 --ink4）。7 天迷你柱图，
 * 峰值日红点睛、今日描边。进场走 .stagger / .studio-rise（reduce-motion 全降级）。
 * 右上「分享周报」挂 <SharePanel kind="week-report" />（F3 已就绪）。零 em-dash。
 */

const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"] as const;

export interface WeeklyReportBannerProps {
  report: WeeklyReport;
  /** 分享落地链接（复制/系统分享用），默认成长档案页。 */
  shareUrl?: string;
}

export function WeeklyReportBanner({ report, shareUrl = "/me" }: WeeklyReportBannerProps) {
  const { days, minutes, completed, notes, bestStreak, peakMinutes, hasActivity } = report;
  // 柱高基准：峰值日封顶，最低给 60 分钟基准，避免小数据全贴顶。
  const barBase = Math.max(60, peakMinutes);

  return (
    <section
      aria-label="本周学习周报"
      className="studio-rise elev-1 relative overflow-hidden rounded-[var(--radius-card)] p-5 sm:p-6"
    >
      {/* 顶边红点睛：1px 品牌信号，克制不抢视觉 */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--red) 50%, transparent)",
          opacity: 0.6,
        }}
      />

      {/* 抬头：标题 + 分享 */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink4)]">
            WEEKLY REPORT
          </p>
          <h2 className="mt-1.5 text-[17px] font-bold tracking-[-0.01em] text-[var(--ink)]">
            本周周报
          </h2>
          <p className="mt-0.5 text-[12px] text-[var(--ink3)]">
            {hasActivity
              ? "这一周你走过的路，都在这里"
              : "本周还没点亮，学一课就有你的第一格"}
          </p>
        </div>
        <SharePanel
          kind="week-report"
          title="学习周报"
          shareUrl={shareUrl}
          params={{ week: report.weekLabel }}
          triggerLabel="分享周报"
          triggerClassName="studio-press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 text-[12.5px] font-semibold text-[var(--ink2)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]/50"
        />
      </div>

      {/* 关键数字 4 联：分钟 / 完课 / 笔记 / 最高连击，各带 vs 上周箭头 */}
      <div className="stagger mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCell
          i={0}
          icon={<Timer size={15} weight="fill" />}
          tone="red"
          value={minutes.value}
          unit="分钟"
          label="本周学习"
          delta={minutes}
        />
        <StatCell
          i={1}
          icon={<CheckCircle size={15} weight="fill" />}
          tone="ok"
          value={completed.value}
          unit="节"
          label="完成课程"
          delta={completed}
        />
        <StatCell
          i={2}
          icon={<NotePencil size={15} weight="fill" />}
          tone="info"
          value={notes.value}
          unit="条"
          label="新增笔记"
          delta={notes}
        />
        <StatCell
          i={3}
          icon={<Flame size={15} weight="fill" />}
          tone="warn"
          value={bestStreak.value}
          unit="天"
          label="最高连击"
          delta={bestStreak}
        />
      </div>

      {/* 7 天迷你柱图 */}
      <div className="mt-5 rounded-[var(--radius-card-sm)] border border-[var(--border)] bg-[var(--surface2)] p-4">
        <div className="flex items-baseline justify-between">
          <h3 className="text-[12.5px] font-bold text-[var(--ink)]">本周学习节奏</h3>
          <span className="mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink4)]">
            分钟 · 天
          </span>
        </div>
        <div
          className="stagger mt-3.5 flex items-end justify-between gap-2"
          style={{ minHeight: 84 }}
        >
          {days.map((d, i) => {
            const ratio = d.minutes > 0 ? Math.max(d.minutes / barBase, 0.08) : 0;
            const isPeak = d.minutes > 0 && d.minutes >= peakMinutes;
            return (
              <div
                key={d.day}
                style={{ "--i": i } as CSSProperties}
                className="flex flex-1 flex-col items-center gap-1.5"
              >
                <div className="flex h-[64px] w-full items-end">
                  <div
                    className={`weekly-bar w-full rounded-t-[4px] ${
                      d.isFuture
                        ? "bg-[var(--surface-inset)] opacity-45"
                        : isPeak
                          ? "bg-[var(--red)]"
                          : d.minutes > 0
                            ? "bg-[var(--chart-bar-muted)]"
                            : "bg-[var(--surface-inset)]"
                    } ${d.isToday ? "ring-2 ring-[var(--red-soft-border)] ring-offset-1 ring-offset-[var(--surface2)]" : ""}`}
                    style={{ height: `${Math.round(ratio * 100)}%` }}
                    title={
                      d.isFuture ? undefined : `周${WEEK_LABELS[i]} · ${d.minutes} 分钟`
                    }
                  />
                </div>
                <span
                  className={`mono text-[10px] ${
                    d.isToday ? "font-bold text-[var(--ink2)]" : "text-[var(--ink4)]"
                  }`}
                >
                  {WEEK_LABELS[i]}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

type Tone = "red" | "ok" | "info" | "warn";

const TONE_ICON: Record<Tone, string> = {
  red: "border-[var(--red-soft-border)] bg-[var(--red-soft)] text-[var(--red)]",
  ok: "border-[color-mix(in_srgb,var(--ok)_24%,transparent)] bg-[var(--ok-soft)] text-[var(--ok)]",
  info: "border-[color-mix(in_srgb,var(--info)_22%,transparent)] bg-[var(--info-soft)] text-[var(--info)]",
  warn: "border-[color-mix(in_srgb,var(--warn)_28%,transparent)] bg-[var(--warn-soft)] text-[var(--warn)]",
};

/** 单个数字格：图标 + mono 大数字（num-pop）+ 单位/标签 + vs 上周箭头。 */
function StatCell({
  i,
  icon,
  tone,
  value,
  unit,
  label,
  delta,
}: {
  i: number;
  icon: React.ReactNode;
  tone: Tone;
  value: number;
  unit: string;
  label: string;
  delta: WeeklyDelta;
}) {
  return (
    <div
      style={{ "--i": i } as CSSProperties}
      className="flex flex-col rounded-[var(--radius-card-sm)] border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-[var(--card),var(--inner-hi)]"
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-[9px] border ${TONE_ICON[tone]}`}
        >
          {icon}
        </span>
        <DeltaPill delta={delta} />
      </div>
      <p className="mt-3 flex items-baseline gap-1">
        <span
          key={value}
          className="mono num-pop text-[24px] font-bold leading-none text-[var(--ink)]"
        >
          {value}
        </span>
        <span className="text-[11px] text-[var(--ink3)]">{unit}</span>
      </p>
      <p className="mt-1 text-[11.5px] text-[var(--ink3)]">{label}</p>
    </div>
  );
}

/** vs 上周对比小徽标：升 --ok / 降 --ink3 / 持平 --ink4，数字 mono。 */
function DeltaPill({ delta }: { delta: WeeklyDelta }) {
  const d = delta.delta;
  if (d === 0) {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[10.5px] text-[var(--ink4)]"
        aria-label="与上周持平"
      >
        <Minus size={11} weight="bold" />
        持平
      </span>
    );
  }
  const up = d > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10.5px] font-semibold ${
        up ? "text-[var(--ok)]" : "text-[var(--ink3)]"
      }`}
      aria-label={up ? `较上周增加 ${d}` : `较上周减少 ${Math.abs(d)}`}
    >
      {up ? (
        <TrendUp size={11} weight="bold" />
      ) : (
        <TrendDown size={11} weight="bold" />
      )}
      <span className="mono">{Math.abs(d)}</span>
    </span>
  );
}

export default WeeklyReportBanner;
