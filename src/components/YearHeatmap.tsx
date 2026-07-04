"use client";

import { useMemo, useState } from "react";

/**
 * YearHeatmap：GitHub 风格 365 天学习热力格（成长档案 /me）。
 *
 * 数据源：gamification getYearHeatmap（StreakDay 近 365 天：day/minutes/notes）。
 * todayKey 由服务端按 Asia/Shanghai 传入，作为「今日」与年段基准的唯一来源；
 * 组件内所有周/日推算都从该字符串确定性展开，不在渲染期调用 new Date() 读本地时区，
 * 避免 SSR 与 hydration 在日界处算出不同网格（与 TideCalendar 同一约束）。
 *
 * 纯 div 网格：53 周 × 7 天（周一→周日为行，周为列）。
 * 色阶 5 档：无活动 → --surface-inset；有活动按分钟深浅在 --red-soft → --red 间递进，
 * 只有高强度日落到满红（呼应 STUDIO「红=专注信号，克制使用」）。
 * reduce-motion 下无进场动画（.stagger/.studio- 均降级；本组件不叠加额外动效）。
 */

export interface HeatDay {
  day: string; // "YYYY-MM-DD"（Asia/Shanghai）
  minutes: number;
  notes: number;
}

const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
const MONTH_LABELS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

/** 分钟 → 色阶档位 0..4（0=无活动）。阈值贴合单日学习节奏。 */
function levelOf(minutes: number): 0 | 1 | 2 | 3 | 4 {
  if (minutes <= 0) return 0;
  if (minutes < 15) return 1;
  if (minutes < 30) return 2;
  if (minutes < 60) return 3;
  return 4;
}

/**
 * 档位 → 背景色。0 用中性内凹底；1..4 在有道红上叠不同透明度，
 * 底层铺 --surface 保证浅底不透出、暗色模式亦稳定。deepest 命中纯 --red。
 */
const LEVEL_BG: Record<number, string> = {
  0: "var(--surface-inset)",
  1: "color-mix(in srgb, var(--red) 22%, var(--surface))",
  2: "color-mix(in srgb, var(--red) 46%, var(--surface))",
  3: "color-mix(in srgb, var(--red) 72%, var(--surface))",
  4: "var(--red)",
};

/** 本地日期部件 → "YYYY-MM-DD"。 */
function fmtKey(y: number, m0: number, d: number): string {
  return `${y}-${String(m0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

interface Cell {
  key: string;
  y: number;
  m0: number; // 0-based 月
  d: number;
  future: boolean;
}

/** 从 todayKey 反推 53 周网格：最后一列含今日，向前铺满 53 列 × 7 行。 */
function buildGrid(todayKey: string): { weeks: (Cell | null)[][]; monthTicks: { col: number; label: string }[] } {
  const [ty, tm, td] = todayKey.split("-").map(Number);
  // 用 UTC 基准做纯日期步进（不引入时区），仅取 Y/M/D 展示
  const todayUtc = Date.UTC(ty, tm - 1, td);
  const todayDow = (new Date(todayUtc).getUTCDay() + 6) % 7; // 周一=0
  // 网格末列所在周的周日（今日 → 本周日），据此往前推 53 周
  const lastSundayUtc = todayUtc + (6 - todayDow) * 864e5;
  const startUtc = lastSundayUtc - (53 * 7 - 1) * 864e5; // 起始格（周一）

  const weeks: (Cell | null)[][] = [];
  const monthTicks: { col: number; label: string }[] = [];
  let prevMonth = -1;

  for (let col = 0; col < 53; col++) {
    const week: (Cell | null)[] = [];
    for (let row = 0; row < 7; row++) {
      const cellUtc = startUtc + (col * 7 + row) * 864e5;
      const dt = new Date(cellUtc);
      const y = dt.getUTCFullYear();
      const m0 = dt.getUTCMonth();
      const d = dt.getUTCDate();
      const key = fmtKey(y, m0, d);
      const future = key > todayKey;
      week.push({ key, y, m0, d, future });
      // 月份刻度：某列第一天（row 0）跨入新月时打标
      if (row === 0 && m0 !== prevMonth) {
        monthTicks.push({ col, label: MONTH_LABELS[m0] });
        prevMonth = m0;
      }
    }
    weeks.push(week);
  }
  return { weeks, monthTicks };
}

export function YearHeatmap({ days, todayKey }: { days: HeatDay[]; todayKey: string }) {
  const byDay = useMemo(() => {
    const m = new Map<string, HeatDay>();
    for (const d of days) m.set(d.day, d);
    return m;
  }, [days]);

  const { weeks, monthTicks } = useMemo(() => buildGrid(todayKey), [todayKey]);

  const [hover, setHover] = useState<{ key: string; minutes: number; notes: number; x: number; y: number } | null>(null);

  // 汇总：活跃天数 / 总分钟（近一年）
  const { activeDays, totalMinutes } = useMemo(() => {
    let a = 0;
    let t = 0;
    for (const d of days) {
      if (d.minutes > 0) a += 1;
      t += d.minutes;
    }
    return { activeDays: a, totalMinutes: t };
  }, [days]);

  const CELL = 12; // 格边长(px)
  const GAP = 3;
  const STEP = CELL + GAP;

  return (
    <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card),var(--inner-hi)]">
      {/* 抬头：标题 + 近一年汇总 */}
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[15px] font-bold text-[var(--ink)]">
          学习热力
          <span className="mono ml-2 text-[11px] font-normal text-[var(--ink4)]">近一年</span>
        </h3>
        <p className="text-[12px] text-[var(--ink3)]">
          <span className="mono font-semibold text-[var(--ink2)]">{activeDays}</span> 天活跃 ·{" "}
          <span className="mono font-semibold text-[var(--ink2)]">{Math.round(totalMinutes / 60)}</span> 小时
        </p>
      </div>

      {/* 网格：窄屏横向滚动。周几标签固定左列，热力格右侧 */}
      <div className="relative overflow-x-auto pb-1">
        <div className="flex gap-2" style={{ width: "max-content" }}>
          {/* 周几标签列（只标 一 / 三 / 五，避免过密）*/}
          <div className="flex shrink-0 flex-col justify-between pt-[18px]" style={{ height: 7 * STEP - GAP }}>
            {WEEK_LABELS.map((w, i) => (
              <div
                key={w}
                className="flex items-center text-[10px] leading-none text-[var(--ink4)]"
                style={{ height: CELL, visibility: i % 2 === 0 ? "visible" : "hidden" }}
              >
                {w}
              </div>
            ))}
          </div>

          <div className="shrink-0">
            {/* 月份刻度行 */}
            <div className="relative mb-1" style={{ height: 14, width: 53 * STEP - GAP }}>
              {monthTicks.map((t) => (
                <span
                  key={`${t.label}-${t.col}`}
                  className="mono absolute top-0 text-[10px] leading-none text-[var(--ink4)]"
                  style={{ left: t.col * STEP }}
                >
                  {t.label}月
                </span>
              ))}
            </div>

            {/* 热力格：列=周，行=周一→周日 */}
            <div className="flex" style={{ gap: GAP }}>
              {weeks.map((week, ci) => (
                <div key={ci} className="flex flex-col" style={{ gap: GAP }}>
                  {week.map((cell, ri) => {
                    if (!cell || cell.future) {
                      // 未来格：占位透明，保持网格对齐
                      return <div key={ri} style={{ width: CELL, height: CELL }} aria-hidden />;
                    }
                    const rec = byDay.get(cell.key);
                    const minutes = rec?.minutes ?? 0;
                    const notes = rec?.notes ?? 0;
                    const level = levelOf(minutes);
                    const isToday = cell.key === todayKey;
                    return (
                      <div
                        key={ri}
                        className="rounded-[3px] transition-colors"
                        style={{
                          width: CELL,
                          height: CELL,
                          background: LEVEL_BG[level],
                          boxShadow: isToday
                            ? "0 0 0 1.5px var(--red-ink)"
                            : level === 0
                              ? "inset 0 0 0 1px color-mix(in srgb, var(--border) 60%, transparent)"
                              : undefined,
                        }}
                        onMouseEnter={(e) => {
                          const frame = e.currentTarget.closest(".overflow-x-auto") as HTMLElement | null;
                          const fr = frame?.getBoundingClientRect();
                          const cr = e.currentTarget.getBoundingClientRect();
                          setHover({
                            key: cell.key,
                            minutes,
                            notes,
                            x: fr ? cr.left - fr.left + CELL / 2 : 0,
                            y: fr ? cr.top - fr.top : 0,
                          });
                        }}
                        onMouseLeave={() => setHover(null)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* tooltip 宿主锚点 + 浮层（相对滚动容器定位，随内容滚动） */}
        <div data-heatmap-host className="pointer-events-none absolute inset-0">
          {hover && (
            <div
              className="absolute z-10 -translate-x-1/2 -translate-y-full rounded-[8px] border border-[var(--border2)] bg-[var(--surface)] px-2.5 py-1.5 shadow-[var(--card-hover)]"
              style={{ left: hover.x, top: hover.y - 6, whiteSpace: "nowrap" }}
              role="tooltip"
            >
              <p className="mono text-[11px] font-semibold text-[var(--ink)]">{hover.key}</p>
              <p className="mt-0.5 text-[11px] text-[var(--ink3)]">
                {hover.minutes > 0 ? (
                  <>
                    <span className="mono font-semibold text-[var(--ink2)]">{hover.minutes}</span> 分钟
                    {hover.notes > 0 && (
                      <>
                        {" · "}
                        <span className="mono font-semibold text-[var(--ink2)]">{hover.notes}</span> 条笔记
                      </>
                    )}
                  </>
                ) : (
                  "未学习"
                )}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 图例：少 → 多 */}
      <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-[var(--ink4)]">
        <span>少</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span
            key={l}
            className="rounded-[3px]"
            style={{
              width: 12,
              height: 12,
              background: LEVEL_BG[l],
              boxShadow: l === 0 ? "inset 0 0 0 1px color-mix(in srgb, var(--border) 60%, transparent)" : undefined,
            }}
            aria-hidden
          />
        ))}
        <span>多</span>
      </div>
    </div>
  );
}
