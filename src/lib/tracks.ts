/**
 * 赛道（内容板块）体系：融合有道学习会员真实业务 + 潮汐通用平台。
 * 有道现有板块：躺学单词篇 / 口语小班课 / 银发口语 / 三合一全能英语（均英语）
 * 潮汐扩展：AI 技能 / 生活实用；未来赛道：职教 / 考证 / 留学 / 亲子（预留）
 *
 * 权益按赛道 scope（§融合 Tier3：分赛道自由组合订阅，对应有道 2026H2 规划）。
 */
export interface Track {
  key: string;
  label: string;
  people: string; // 目标人群
  blurb: string;
  cover: "tide" | "dawn";
  isEnglish?: boolean;
}

export const TRACKS: Track[] = [
  { key: "english_oral", label: "口语实战", people: "想开口交流的英语学习者", blurb: "即学即用的场景口语，短时见效", cover: "tide", isEnglish: true },
  { key: "english_foundation", label: "听说读写全能", people: "有基础的学习者 / 备考人群", blurb: "躺学单词，夯实语法与词汇根基", cover: "dawn", isEnglish: true },
  { key: "silver_english", label: "银发口语", people: "50+ 长辈学员", blurb: "只教当下能开口的短句，学完就能用", cover: "dawn", isEnglish: true },
  { key: "ai_skill", label: "AI 技能", people: "职场人 / 自媒体", blurb: "AI 办公、写作、做图，每周更新", cover: "tide" },
  { key: "life", label: "生活实用", people: "35–65 岁通用", blurb: "防诈骗、就医前信息整理等生活刚需", cover: "tide" },
];

export const TRACK_MAP: Record<string, Track> = Object.fromEntries(TRACKS.map((t) => [t.key, t]));

export function trackLabel(key: string): string {
  return TRACK_MAP[key]?.label ?? key;
}

/**
 * 视觉映射：赛道 category 到 D1 封面渐变 token（纯展示，不参与数据/权益逻辑）。
 * 英语三门共用绿系，AI 紫、银发暖橙、生活蓝，未识别兜底冷灰。
 */
export function trackGradientVar(category: string): string {
  switch (category) {
    case "ai_skill":
      return "var(--track-ai)";
    case "english_oral":
    case "english_foundation":
      return "var(--track-english)";
    case "silver_english":
      return "var(--track-elder)";
    case "life":
      return "var(--track-life)";
    default:
      return "var(--track-default)";
  }
}

/**
 * 视觉映射：赛道 category 到封面主题图标 key（纯字符串，不 import 图标本体，
 * 避免把图标组件耦合进 lib）。组件层按此 key 从图标表取对应 Phosphor 图标。
 * 与 trackGradientVar 同源，共同构成「课程封面 = 赛道渐变 + 主题图标」的视觉语言。
 */
export function trackIconKey(category: string): string {
  switch (category) {
    case "ai_skill":
      return "ai";
    case "english_oral":
    case "english_foundation":
      return "english";
    case "silver_english":
      return "elder";
    case "life":
      return "life";
    default:
      return "default";
  }
}

// 未来赛道（仅展示"即将上线"，对应有道跨赛道扩张规划）
export const FUTURE_TRACKS = [
  { key: "vocational", label: "职业教育" },
  { key: "certification", label: "考试考证" },
  { key: "abroad", label: "出国留学" },
  { key: "parenting", label: "亲子共建" },
];
