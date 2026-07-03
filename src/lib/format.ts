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
  quarter: "每季",
  month_recurring: "连续包月",
  year: "每年",
};

// 渠道来源（融合有道流量结构）
export const CHANNEL_LABELS: Record<string, string> = {
  youdao_dict: "端内私域（词典）",
  ad_external: "端外投放",
  private_domain: "私域运营",
  organic: "自然流量",
};

export const LEAD_STATUS: Record<string, { label: string; tone: string }> = {
  new: { label: "新线索", tone: "tide" },
  contacting: { label: "电联中", tone: "dawn" },
  booked: { label: "已预约试听", tone: "dawn" },
  trialing: { label: "试听中", tone: "dawn" },
  converted: { label: "已转化", tone: "success" },
  lost: { label: "已流失", tone: "muted" },
};

/**
 * 笔记摘要：从 Markdown 正文生成纯文本预览（≤maxLen 字）。
 * v2.2：写入时落库到 Note.excerpt，列表直接读，避免每次渲染动态截断（借鉴 LeoJarvis excerpt）。
 * 去掉常见 markdown 标记（#、*、`、>、-、图片/链接语法），压缩空白。
 */
export function buildExcerpt(md: string, maxLen = 120): string {
  const plain = md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // 链接保留文字
    .replace(/[#>*_`~-]/g, " ") // markdown 符号
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > maxLen ? plain.slice(0, maxLen) + "…" : plain;
}

/**
 * URL slug：小写化、非字母数字转连字符、去首尾连字符、截断 40 字符。
 * 空输入返回 "course"（调用方通常再拼一段随机后缀保证唯一）。
 * v2.2：合并 generate-course / import-source 两处逐字重复的实现。
 */
export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "course";
}
