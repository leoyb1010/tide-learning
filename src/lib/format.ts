export function yuan(cents: number): string {
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
}

export function formatDurationSec(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h > 0) return `${h}小时${m}分`;
  return `${m}分钟`;
}

export function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export const UPDATE_TYPE_LABELS: Record<string, string> = {
  added: "新增",
  revised: "修订",
  fixed: "纠错",
  removed: "删除",
};

export const DEMAND_STATUS: Record<string, { label: string; tone: string }> = {
  pending_review: { label: "待审核", tone: "muted" },
  collecting: { label: "征集中", tone: "tide" },
  evaluating: { label: "评估中", tone: "tide" },
  scheduled: { label: "已排期", tone: "dawn" },
  producing: { label: "制作中", tone: "dawn" },
  launched: { label: "已上线", tone: "success" },
  rejected: { label: "未采纳", tone: "muted" },
  merged: { label: "已合并", tone: "muted" },
};

export const PLAN_PERIOD_LABELS: Record<string, string> = {
  month: "每月",
  month_recurring: "连续包月",
  year: "每年",
};
