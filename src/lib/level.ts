/**
 * 学习等级体系（v2.3 §2 学生证）—— 由累计学习时长（秒）纯函数派生，不建表。
 * 用于学生证 `Lv.N {称号}` 展示，给成长以可视的阶梯与情感回报。
 */

interface LevelTier {
  level: number;
  title: string; // 称号
  minHours: number; // 达到该级所需累计小时
}

// 阶梯：小时数递增（对齐参考图 Lv.7 深度专注者量级）
const TIERS: LevelTier[] = [
  { level: 1, title: "初来乍到", minHours: 0 },
  { level: 2, title: "渐入佳境", minHours: 5 },
  { level: 3, title: "小有所成", minHours: 15 },
  { level: 4, title: "持之以恒", minHours: 40 },
  { level: 5, title: "学有专精", minHours: 100 },
  { level: 6, title: "融会贯通", minHours: 250 },
  { level: 7, title: "深度专注者", minHours: 600 },
  { level: 8, title: "学海无涯", minHours: 1500 },
];

export interface LevelInfo {
  level: number;
  title: string;
  hours: number; // 当前累计小时（保留 1 位）
  nextLevelHours: number | null; // 下一级门槛（满级为 null）
  progressPct: number; // 当前级 → 下一级的进度 0-100（满级 100）
}

/** 累计学习秒数 → 等级信息。 */
export function deriveLevel(totalSeconds: number): LevelInfo {
  const hours = Math.max(0, totalSeconds) / 3600;
  // 找当前所在档（最后一个 minHours <= hours 的）
  let idx = 0;
  for (let i = 0; i < TIERS.length; i++) {
    if (hours >= TIERS[i].minHours) idx = i;
  }
  const cur = TIERS[idx];
  const next = TIERS[idx + 1] ?? null;
  const progressPct = next
    ? Math.min(100, Math.round(((hours - cur.minHours) / (next.minHours - cur.minHours)) * 100))
    : 100;
  return {
    level: cur.level,
    title: cur.title,
    hours: Math.round(hours * 10) / 10,
    nextLevelHours: next?.minHours ?? null,
    progressPct,
  };
}
