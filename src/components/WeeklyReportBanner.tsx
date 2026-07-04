"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  TrendUp,
  TrendDown,
  Minus,
  Timer,
  CheckCircle,
  NotePencil,
  Flame,
  CalendarBlank,
  CalendarDots,
  CalendarStar,
  Sparkle,
} from "@phosphor-icons/react/dist/ssr";
import { Dialog } from "./Dialog";
import { SharePanel } from "./SharePanel";
import type { WeeklyReport, WeeklyDelta } from "@/lib/weekly-report";

/**
 * 学习回望 · ReportDock（v3.1 视觉深度重设计）
 *
 * 旧版是常驻大横幅，占据书桌最显眼位置、喧宾夺主。v3.1 改为一排「日报 / 周报 / 月报」
 * 三张紧凑小卡：每张只显示 1 个关键数字 + vs 上周箭头 + 一条迷你趋势，点击弹出完整详情
 * modal（含全部数字 + 7 天柱图 + 分享）。让位给上方的「今天想学」主入口，回望回落为
 * 「想看时点开」的轻量入口，不再常驻抢戏。
 *
 * 数据源不变：仍只吃服务端 getWeeklyReport(userId) 组装的 WeeklyReport（近两周潮汐日历派生）。
 * 日报 = days 里今天那一格；周报 = 本周合计 + 7 天柱图；月报 = 以「本周 vs 上周」现有窗口
 * 呈现近段动能（诚实呈现数据窗口，不虚构月度聚合）。
 *
 * 视觉：三小卡 elev-1 材质 + inner-hi 内顶高光 + studio-lift 悬浮；关键数字 mono + num-pop；
 * 一处红点睛（当前选中/峰值）。详情走统一 Dialog（scrim + 涨潮入场 + focus trap + Esc）。
 * 进场 stagger，全部动效 reduce-motion 降级；触达 ≥44px；零 em-dash。
 */

const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"] as const;

export interface WeeklyReportBannerProps {
  report: WeeklyReport;
  /** 分享落地链接（复制/系统分享用），默认成长档案页。 */
  shareUrl?: string;
}

type ReportKind = "day" | "week" | "month";

export function WeeklyReportBanner({ report, shareUrl = "/me" }: WeeklyReportBannerProps) {
  const [open, setOpen] = useState<ReportKind | null>(null);

  // 今天那一格（日报主数字）。找不到今天（理论不会）则回退到最后一格。
  const today = useMemo(
    () => report.days.find((d) => d.isToday) ?? report.days[report.days.length - 1],
    [report.days],
  );
  // 本周实际有活动的天数（周报副信息 / 空态判断）。
  const activeDayCount = useMemo(
    () => report.days.filter((d) => !d.isFuture && d.minutes > 0).length,
    [report.days],
  );
  // 月报动能：以现有「本周 vs 上周」两段窗口，给出近段总分钟（本周 + 上周），
  // 诚实呈现数据窗口，不虚构完整月度。
  const recentMinutes = report.minutes.value + report.minutes.prev;

  return (
    <>
      <section aria-label="学习回望" className="stagger grid grid-cols-3 gap-2.5 sm:gap-3">
        {/* —— 日报：今天学了多少（红点睛，因「今天」是此刻焦点）—— */}
        <ReportChip
          i={0}
          kind="day"
          icon={<CalendarBlank size={14} weight="fill" />}
          tone="red"
          eyebrow="今日"
          value={today?.minutes ?? 0}
          unit="分钟"
          hint={
            (today?.notes ?? 0) > 0
              ? `${today?.notes} 条笔记`
              : (today?.minutes ?? 0) > 0
                ? "已点亮"
                : "待点亮"
          }
          spark={report.days}
          onOpen={() => setOpen("day")}
        />
        {/* —— 周报：本周累计学习 + vs 上周 —— */}
        <ReportChip
          i={1}
          kind="week"
          icon={<CalendarDots size={14} weight="fill" />}
          tone="ink"
          eyebrow="本周"
          value={report.minutes.value}
          unit="分钟"
          delta={report.minutes}
          hint={`${activeDayCount}/7 天在学`}
          spark={report.days}
          onOpen={() => setOpen("week")}
        />
        {/* —— 月报：近段动能（本周 + 上周窗口）—— */}
        <ReportChip
          i={2}
          kind="month"
          icon={<CalendarStar size={14} weight="fill" />}
          tone="ink"
          eyebrow="近段"
          value={recentMinutes}
          unit="分钟"
          delta={report.minutes}
          hint={`完课 ${report.completed.value} 节`}
          spark={report.days}
          onOpen={() => setOpen("month")}
        />
      </section>

      {/* —— 详情弹窗：日 / 周 / 月共用同一份周报数据，按侧重展开 —— */}
      <ReportDialog
        kind={open}
        report={report}
        today={today}
        activeDayCount={activeDayCount}
        recentMinutes={recentMinutes}
        shareUrl={shareUrl}
        onClose={() => setOpen(null)}
      />
    </>
  );
}

/* ============================================================
   小卡：紧凑入口（图标 + eyebrow + 大数字 + 迷你趋势 + vs 上周）
   ============================================================ */

type ChipTone = "red" | "ink";

function ReportChip({
  i,
  kind,
  icon,
  tone,
  eyebrow,
  value,
  unit,
  delta,
  hint,
  spark,
  onOpen,
}: {
  i: number;
  kind: ReportKind;
  icon: ReactNode;
  tone: ChipTone;
  eyebrow: string;
  value: number;
  unit: string;
  delta?: WeeklyDelta;
  hint: string;
  spark: WeeklyReport["days"];
  onOpen: () => void;
}) {
  const iconCls =
    tone === "red"
      ? "border-[var(--red-soft-border)] bg-[var(--red-soft)] text-[var(--red)]"
      : "border-[var(--border)] bg-[var(--surface2)] text-[var(--ink3)]";
  const valueCls =
    tone === "red"
      ? "text-[var(--red)]"
      : "text-[var(--ink)]";
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ "--i": i } as CSSProperties}
      aria-label={`${eyebrow}回望详情`}
      className="studio-lift group relative flex min-h-[112px] flex-col overflow-hidden rounded-[var(--radius-card-sm)] border border-[var(--border)] bg-[var(--surface)] p-3 text-left shadow-[var(--card),var(--inner-hi)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink3)]"
    >
      <div className="flex items-center justify-between">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-[8px] border ${iconCls} transition-transform group-hover:scale-105`}
        >
          {icon}
        </span>
        {delta ? (
          <DeltaPill delta={delta} />
        ) : (
          <span className="mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink4)]">
            {eyebrow}
          </span>
        )}
      </div>
      <p className="mt-2.5 flex items-baseline gap-1">
        <span
          key={value}
          className={`mono num-pop text-[22px] font-bold leading-none tracking-[-0.02em] sm:text-[24px] ${valueCls}`}
        >
          {value}
        </span>
        <span className="text-[10.5px] text-[var(--ink3)]">{unit}</span>
      </p>
      <p className="mt-1 truncate text-[10.5px] text-[var(--ink3)]">{hint}</p>
      {/* 迷你趋势：7 天极小柱，峰值/今日红点睛，纯装饰性 spark */}
      <MiniSpark days={spark} highlightToday={kind === "day"} />
    </button>
  );
}

/** 卡内迷你 7 天 spark（高 16px），非交互，只做趋势暗示。 */
function MiniSpark({
  days,
  highlightToday,
}: {
  days: WeeklyReport["days"];
  highlightToday: boolean;
}) {
  const peak = Math.max(1, ...days.map((d) => d.minutes));
  return (
    <div
      aria-hidden
      className="mt-auto flex h-4 items-end gap-[3px] pt-2 opacity-90"
    >
      {days.map((d, i) => {
        const h = d.minutes > 0 ? Math.max(0.14, d.minutes / peak) : 0.08;
        const hot = highlightToday
          ? d.isToday && d.minutes > 0
          : d.minutes > 0 && d.minutes >= peak;
        return (
          <span
            key={i}
            className={`weekly-bar flex-1 rounded-[2px] ${
              d.isFuture
                ? "bg-[var(--surface-inset)] opacity-50"
                : hot
                  ? "bg-[var(--red)]"
                  : d.minutes > 0
                    ? "bg-[var(--chart-bar-muted)]"
                    : "bg-[var(--surface-inset)]"
            }`}
            style={{ "--i": i, height: `${Math.round(h * 100)}%` } as CSSProperties}
          />
        );
      })}
    </div>
  );
}

/* ============================================================
   详情弹窗：完整数字 + 7 天柱图 + 分享
   ============================================================ */

const DIALOG_META: Record<
  ReportKind,
  { icon: ReactNode; title: string; badge: string }
> = {
  day: { icon: <CalendarBlank size={16} weight="fill" />, title: "今日回望", badge: "DAY" },
  week: { icon: <CalendarDots size={16} weight="fill" />, title: "本周周报", badge: "WEEK" },
  month: { icon: <CalendarStar size={16} weight="fill" />, title: "近段动能", badge: "RECENT" },
};

function ReportDialog({
  kind,
  report,
  today,
  activeDayCount,
  recentMinutes,
  shareUrl,
  onClose,
}: {
  kind: ReportKind | null;
  report: WeeklyReport;
  today: WeeklyReport["days"][number] | undefined;
  activeDayCount: number;
  recentMinutes: number;
  shareUrl: string;
  onClose: () => void;
}) {
  const meta = kind ? DIALOG_META[kind] : null;
  const barBase = Math.max(60, report.peakMinutes);

  // 弹窗顶部叙事文案，按 kind 分支。
  const lede =
    kind === "day"
      ? (today?.minutes ?? 0) > 0
        ? "今天已经点亮，这是你今日的足迹"
        : "今天还没点亮，学一课就有你的第一格"
      : kind === "week"
        ? report.hasActivity
          ? "这一周你走过的路，都在这里"
          : "本周还没点亮，学一课就有你的第一格"
        : "本周与上周的对比，看看你的近段状态";

  // 四联关键数字，按 kind 侧重（日报强调今天，其余强调本周合计）。
  const stats: {
    icon: ReactNode;
    tone: StatTone;
    value: number;
    unit: string;
    label: string;
    delta?: WeeklyDelta;
  }[] =
    kind === "day"
      ? [
          { icon: <Timer size={15} weight="fill" />, tone: "red", value: today?.minutes ?? 0, unit: "分钟", label: "今日学习" },
          { icon: <NotePencil size={15} weight="fill" />, tone: "info", value: today?.notes ?? 0, unit: "条", label: "今日笔记" },
          { icon: <CheckCircle size={15} weight="fill" />, tone: "ok", value: report.completed.value, unit: "节", label: "本周完课", delta: report.completed },
          { icon: <Flame size={15} weight="fill" />, tone: "warn", value: report.bestStreak.value, unit: "天", label: "本周连击", delta: report.bestStreak },
        ]
      : [
          { icon: <Timer size={15} weight="fill" />, tone: "red", value: report.minutes.value, unit: "分钟", label: kind === "month" ? "本周学习" : "本周学习", delta: report.minutes },
          { icon: <CheckCircle size={15} weight="fill" />, tone: "ok", value: report.completed.value, unit: "节", label: "完成课程", delta: report.completed },
          { icon: <NotePencil size={15} weight="fill" />, tone: "info", value: report.notes.value, unit: "条", label: "新增笔记", delta: report.notes },
          { icon: <Flame size={15} weight="fill" />, tone: "warn", value: report.bestStreak.value, unit: "天", label: "最高连击", delta: report.bestStreak },
        ];

  return (
    <Dialog open={kind !== null} onClose={onClose} className="max-w-xl !p-0 overflow-hidden">
      {meta && kind && (
        <div>
          {/* 顶部：语义色抬头条 + 标题 + 分享 */}
          <div className="relative flex items-start gap-3 border-b border-[var(--border)] px-5 pb-4 pt-5 sm:px-6">
            <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px]" style={{ background: "linear-gradient(90deg,transparent,var(--red) 50%,transparent)", opacity: 0.55 }} />
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-card-sm)] border border-[var(--red-soft-border)] bg-[var(--red-soft)] text-[var(--red)]">
              {meta.icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink4)]">
                {meta.badge} · REPORT
              </p>
              <h2 className="mt-0.5 text-[18px] font-bold tracking-[-0.01em] text-[var(--ink)]">
                {meta.title}
              </h2>
              <p className="mt-0.5 text-[12px] leading-[1.5] text-[var(--ink3)]">{lede}</p>
            </div>
          </div>

          <div className="px-5 pb-5 pt-4 sm:px-6">
            {/* 关键数字四联 */}
            <div className="stagger grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {stats.map((s, i) => (
                <StatCell key={s.label} i={i} {...s} />
              ))}
            </div>

            {/* 7 天柱图（周/月侧重；日报也展示，突出今日柱） */}
            <div className="mt-4 rounded-[var(--radius-card-sm)] border border-[var(--border)] bg-[var(--surface2)] p-4">
              <div className="flex items-baseline justify-between">
                <h3 className="text-[12.5px] font-bold text-[var(--ink)]">本周学习节奏</h3>
                <span className="mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink4)]">
                  分钟 · 天
                </span>
              </div>
              <div className="stagger mt-3.5 flex items-end justify-between gap-2" style={{ minHeight: 84 }}>
                {report.days.map((d, i) => {
                  const ratio = d.minutes > 0 ? Math.max(d.minutes / barBase, 0.08) : 0;
                  const isPeak = d.minutes > 0 && d.minutes >= report.peakMinutes;
                  const emphasizeToday = kind === "day" && d.isToday;
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
                              : isPeak || (emphasizeToday && d.minutes > 0)
                                ? "bg-[var(--red)]"
                                : d.minutes > 0
                                  ? "bg-[var(--chart-bar-muted)]"
                                  : "bg-[var(--surface-inset)]"
                          } ${d.isToday ? "ring-2 ring-[var(--red-soft-border)] ring-offset-1 ring-offset-[var(--surface2)]" : ""}`}
                          style={{ height: `${Math.round(ratio * 100)}%` }}
                          title={d.isFuture ? undefined : `周${WEEK_LABELS[i]} · ${d.minutes} 分钟`}
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

            {/* 月报补充：近段窗口说明（诚实标注数据范围，不虚构月度） */}
            {kind === "month" && (
              <div className="mt-3 flex items-center gap-2 rounded-[var(--radius-card-sm)] border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-3">
                <Sparkle size={14} weight="fill" className="shrink-0 text-[var(--red)]" />
                <p className="text-[11.5px] leading-[1.5] text-[var(--ink3)]">
                  近两周共学习{" "}
                  <span className="mono font-bold text-[var(--ink)]">{recentMinutes}</span> 分钟，本周{" "}
                  <DeltaInline delta={report.minutes} /> 上周。持续学下去，月度轨迹会更清晰。
                </p>
              </div>
            )}

            {/* 底部：分享（周报分享图已就绪，复用同一份周数据） */}
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="min-w-0 text-[11.5px] text-[var(--ink3)]">
                {activeDayCount > 0
                  ? `本周已有 ${activeDayCount} 天在学，继续保持`
                  : "点亮第一课，开启你的一周"}
              </p>
              <SharePanel
                kind="week-report"
                title="学习周报"
                shareUrl={shareUrl}
                params={{ week: report.weekLabel }}
                triggerLabel="分享"
                triggerClassName="studio-press inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius-card-sm)] bg-[var(--red)] px-4 text-[13px] font-bold text-white transition-colors hover:bg-[var(--red-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]/50"
              />
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}

type StatTone = "red" | "ok" | "info" | "warn";

const TONE_ICON: Record<StatTone, string> = {
  red: "border-[var(--red-soft-border)] bg-[var(--red-soft)] text-[var(--red)]",
  ok: "border-[color-mix(in_srgb,var(--ok)_24%,transparent)] bg-[var(--ok-soft)] text-[var(--ok)]",
  info: "border-[color-mix(in_srgb,var(--info)_22%,transparent)] bg-[var(--info-soft)] text-[var(--info)]",
  warn: "border-[color-mix(in_srgb,var(--warn)_28%,transparent)] bg-[var(--warn-soft)] text-[var(--warn)]",
};

/** 单个数字格：图标 + mono 大数字（num-pop）+ 单位/标签 + 可选 vs 上周箭头。 */
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
  icon: ReactNode;
  tone: StatTone;
  value: number;
  unit: string;
  label: string;
  delta?: WeeklyDelta;
}) {
  return (
    <div
      style={{ "--i": i } as CSSProperties}
      className="flex flex-col rounded-[var(--radius-card-sm)] border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-[var(--card),var(--inner-hi)]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-[9px] border ${TONE_ICON[tone]}`}>
          {icon}
        </span>
        {delta ? <DeltaPill delta={delta} /> : null}
      </div>
      <p className="mt-3 flex items-baseline gap-1">
        <span key={value} className="mono num-pop text-[24px] font-bold leading-none text-[var(--ink)]">
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
      <span className="inline-flex items-center gap-0.5 text-[10px] text-[var(--ink4)]" aria-label="与上周持平">
        <Minus size={10} weight="bold" />
        持平
      </span>
    );
  }
  const up = d > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${
        up ? "text-[var(--ok)]" : "text-[var(--ink3)]"
      }`}
      aria-label={up ? `较上周增加 ${d}` : `较上周减少 ${Math.abs(d)}`}
    >
      {up ? <TrendUp size={10} weight="bold" /> : <TrendDown size={10} weight="bold" />}
      <span className="mono">{Math.abs(d)}</span>
    </span>
  );
}

/** 行内 vs 上周文字（用于月报补充说明）。 */
function DeltaInline({ delta }: { delta: WeeklyDelta }) {
  const d = delta.delta;
  if (d === 0) return <span className="font-semibold text-[var(--ink3)]">持平</span>;
  const up = d > 0;
  return (
    <span className={`font-semibold ${up ? "text-[var(--ok)]" : "text-[var(--ink3)]"}`}>
      {up ? "多学" : "少学"} <span className="mono">{Math.abs(d)}</span> 分钟于
    </span>
  );
}

export default WeeklyReportBanner;
