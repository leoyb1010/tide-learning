"use client";

import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CaretLeft, CaretRight } from "@phosphor-icons/react/dist/ssr";
import { EASE_TIDE } from "./motion";

export interface TideDay {
  day: string; // "YYYY-MM-DD"（Asia/Shanghai）
  minutes: number;
  notes: number;
}

const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
// 学满这么多分钟即视为“满潮”（水位封顶），避免个别长时段压平其余
const FULL_TIDE_MINUTES = 60;

/**
 * TideCalendar — 潮汐日历：月历每格水位高度 = 当日学习分钟数。
 * 水位越高说明当天学得越久，形成一片起伏的“潮汐海面”。
 */
export function TideCalendar({ calendar }: { calendar: TideDay[] }) {
  const reduce = useReducedMotion();
  const byDay = useMemo(() => {
    const m = new Map<string, TideDay>();
    for (const d of calendar) m.set(d.day, d);
    return m;
  }, [calendar]);

  // 以“当前月”为基准，可前后翻月
  const [offset, setOffset] = useState(0);
  const base = new Date();
  const cursor = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  const year = cursor.getFullYear();
  const month = cursor.getMonth(); // 0-based

  const cells = useMemo(() => buildMonthCells(year, month), [year, month]);
  const todayKey = fmtKey(base);

  return (
    <div className="rounded-2xl border border-ink-100 bg-paper-raised p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold tracking-tight text-ink-950">
          潮汐日历
          <span className="num ml-2 text-sm font-normal text-ink-400">{year} 年 {month + 1} 月</span>
        </h3>
        <div className="flex items-center gap-1">
          <button onClick={() => setOffset((o) => o - 1)} aria-label="上一月" className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-ink-50 hover:text-ink-700">
            <CaretLeft size={16} />
          </button>
          <button
            onClick={() => setOffset(0)}
            disabled={offset === 0}
            className="rounded-lg px-2 py-1 text-xs text-ink-400 transition-colors hover:text-ink-700 disabled:opacity-40"
          >
            本月
          </button>
          {/* 不允许翻到未来之后（未来无数据但允许看空月，仅到下月为止） */}
          <button onClick={() => setOffset((o) => Math.min(o + 1, 0))} disabled={offset >= 0} aria-label="下一月" className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-ink-50 hover:text-ink-700 disabled:opacity-40">
            <CaretRight size={16} />
          </button>
        </div>
      </div>

      <div className="mb-2 grid grid-cols-7 gap-1.5">
        {WEEK_LABELS.map((w) => (
          <div key={w} className="text-center text-[0.66rem] font-medium text-ink-300">{w}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((cell, i) => {
          if (!cell) return <div key={`pad-${i}`} />;
          const key = fmtKey(cell);
          const data = byDay.get(key);
          const minutes = data?.minutes ?? 0;
          const level = Math.min(minutes / FULL_TIDE_MINUTES, 1); // 0~1 水位
          const isToday = key === todayKey;

          return (
            <div
              key={key}
              title={minutes > 0 ? `${cell.getMonth() + 1}/${cell.getDate()} · ${minutes} 分钟 · ${data?.notes ?? 0} 条笔记` : undefined}
              className={`relative aspect-square overflow-hidden rounded-lg border transition-colors ${isToday ? "border-accent-400" : "border-ink-100"}`}
            >
              {/* 水位：从底部升起，高度 ∝ 分钟数 */}
              {level > 0 && (
                <motion.div
                  className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-accent-500/70 to-accent-300/40"
                  initial={reduce ? false : { height: 0 }}
                  animate={{ height: `${Math.max(level * 100, 12)}%` }}
                  transition={{ duration: 0.7, ease: EASE_TIDE, delay: reduce ? 0 : i * 0.008 }}
                />
              )}
              {/* 日期数字浮在水面上 */}
              <span className={`num absolute left-1 top-0.5 text-[0.6rem] ${level > 0.6 ? "text-white" : "text-ink-400"}`}>
                {cell.getDate()}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 text-[0.66rem] text-ink-400">
        <span>低潮</span>
        <div className="flex h-2.5 items-end gap-0.5">
          {[0.2, 0.45, 0.7, 1].map((l) => (
            <div key={l} className="w-2 rounded-sm bg-gradient-to-t from-accent-500/70 to-accent-300/40" style={{ height: `${l * 100}%` }} />
          ))}
        </div>
        <span>满潮</span>
      </div>
    </div>
  );
}

/* ---------- 工具 ---------- */

// 构建月历格子：前导空位对齐到周一，日期从 1 到当月最后一天
function buildMonthCells(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  // JS getDay(): 0=周日…6=周六；转成以周一为首列的偏移
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  return cells;
}

// 本地日期 → "YYYY-MM-DD"，与 shanghaiDayKey 对齐（客户端按本地时区近似）
function fmtKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
