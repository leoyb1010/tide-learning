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

/**
 * 封面池映射：让「无专属封面」的课（AI 造课 / 新课 / 无 cover-<slug>.jpg 的课）
 * 也能落到一张与赛道气质相符的真实封面，而不是露出纯渐变。
 *
 * public/covers/cover-pool-<key>.jpg 已就位（通用赛道封面池）：
 *   ai_skill           → ai-1 / ai-2 / ai-3
 *   english_oral       → oral-1 / oral-2 / oral-3
 *   english_foundation → english-1 / english-2
 *   silver_english     → silver-1 / silver-2
 *   life               → life-1 / life-2
 * 未识别 category 兜底走 ai 池（中性科技感），仍是真实图，不回渐变。
 *
 * 纯函数、无副作用、无 "use client"：server 与 client 组件都能直接调用。
 */
const COVER_POOL: Record<string, string[]> = {
  ai_skill: ["ai-1", "ai-2", "ai-3", "ai-4"],
  english_oral: ["oral-1", "oral-2", "oral-3", "oral-4"],
  english_foundation: ["english-1", "english-2", "english-3"],
  silver_english: ["silver-1", "silver-2", "silver-3"],
  life: ["life-1", "life-2", "life-3"],
};

/** category 无对应池时的兜底池（仍是真实封面，非渐变）。 */
const COVER_POOL_FALLBACK = COVER_POOL.ai_skill;

/**
 * 稳定 hash：把 seed（course id 或 slug）散成非负整数。
 * 同一门课永远命中池内同一张，翻页/刷新不跳图（djb2 变体，纯数值运算）。
 */
function stableHash(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 33) ^ seed.charCodeAt(i);
  }
  return h >>> 0; // 转无符号 32 位
}

/**
 * 按 category 从封面池挑一张稳定图，返回可直接用于 <img src> 的 public 路径。
 * @param category 赛道 key
 * @param seed     稳定选图种子，传 course.id 或 course.slug（同课稳定不跳）
 */
export function coverPoolSrc(category: string, seed: string): string {
  const pool = COVER_POOL[category] ?? COVER_POOL_FALLBACK;
  const pick = pool[stableHash(seed) % pool.length];
  return `/covers/cover-pool-${pick}.jpg`;
}

/**
 * 专属封面白名单：已就位 public/covers/cover-<slug>.jpg 的 8 门 seed 课。
 * server 组件（如 CourseCard）无法用 <img onError> 探测文件是否存在，
 * 故用此白名单在渲染前决定「走专属封面」还是「走封面池」，避免新课露渐变。
 * 新增专属封面的课，在此登记 slug 即可（同时放好对应 jpg）。
 */
export const DEDICATED_COVER_SLUGS = new Set<string>([
  "oral-smallclass-001",
  "all-round-002",
  "silver-oral-003",
  "three-in-one-004",
  "ai-office-005",
  "ai-writing-006",
  "anti-fraud-007",
  "pre-visit-008",
]);

/**
 * 课程封面决策（纯函数，server/client 通用）：
 * 有专属封面 → /covers/cover-<slug>.jpg；否则 → 按 category+seed 从封面池取一张真实图。
 * 任何情况下都返回一张真实图路径，永不落回纯渐变。
 * @param slug     课程 slug
 * @param category 赛道 key
 * @param seed     封面池选图种子（course.id 优先，缺省用 slug）
 */
export function resolveCoverSrc(slug: string, category: string, seed?: string): string {
  if (DEDICATED_COVER_SLUGS.has(slug)) return `/covers/cover-${slug}.jpg`;
  return coverPoolSrc(category, seed ?? slug);
}

/**
 * 集市摊位「橱窗背景」映射：赛道 category 到 market-cover 图 key。
 * public/covers/market-cover-<key>.jpg 已就位（各赛道 16:9 摊位橱窗背景）：
 *   ai_skill                         → ai
 *   english_oral / english_foundation→ english
 *   silver_english                   → senior
 *   life                             → life
 * 未识别 category 兜底 ai（中性科技感，仍是真实图，不回渐变）。
 *
 * 仅集市摊位卡使用：当课程「没有自己的专属封面」时，用赛道橱窗图作氛围底，
 * 叠在赛道渐变之上、内容之下（详见 marketStallCoverSrc 与 MarketStallCard）。
 */
export function marketCoverKey(category: string): string {
  switch (category) {
    case "ai_skill":
      return "ai";
    case "english_oral":
    case "english_foundation":
      return "english";
    case "silver_english":
      return "senior";
    case "life":
      return "life";
    default:
      return "ai";
  }
}

/** 按 category 拼集市橱窗背景图路径（public/covers/market-cover-<key>.jpg）。 */
export function marketCoverSrc(category: string): string {
  return `/covers/market-cover-${marketCoverKey(category)}.jpg`;
}

/**
 * 集市摊位封面决策（纯函数，server/client 通用）——优先级：
 *   1. 课程自己的专属封面（DEDICATED_COVER_SLUGS → cover-<slug>.jpg）
 *   2. 赛道橱窗背景（market-cover-<赛道>.jpg，无专属封面的课统一走这张，摊位橱窗质感）
 * 任何情况都返回一张真实图，永不落回纯渐变；渐变仍在图层之下作融合暗角。
 * 与集市外的 resolveCoverSrc(走通用封面池)不同：集市专用橱窗底，赛道气质更统一。
 * @param slug     课程 slug
 * @param category 赛道 key
 */
export function marketStallCoverSrc(slug: string, category: string): string {
  if (DEDICATED_COVER_SLUGS.has(slug)) return `/covers/cover-${slug}.jpg`;
  return marketCoverSrc(category);
}

/**
 * 视觉映射：赛道 category 到课程定格图（lesson still）token。
 * public/lesson-stills/lesson-still-<key>.jpg 已就位：oral / ai / silver / life / english。
 * 用作视频区 poster / 续播缩略的真实底图，替代纯渐变；未识别兜底 ai。
 */
export function trackStillKey(category: string): string {
  switch (category) {
    case "ai_skill":
      return "ai";
    case "silver_english":
      return "silver";
    case "life":
      return "life";
    case "english_oral":
      return "oral";
    case "english_foundation":
      return "english";
    default:
      return "ai";
  }
}

/** 按 category 拼课程定格图路径（public/lesson-stills/lesson-still-<key>.jpg）。 */
export function trackStillSrc(category: string): string {
  return `/lesson-stills/lesson-still-${trackStillKey(category)}.jpg`;
}

/**
 * 视觉映射：赛道 category 到 scene 块「为什么学」代入场景背景图 key。
 * public/lesson-stills/scene-bg-<key>.jpg 已就位：ai / english / life（宽幅深色场景底）。
 * 英语三门（口语 / 全能 / 银发）共用 english 场景；未识别兜底 life（最中性的生活场景）。
 * 图作 SceneBlock 的氛围底，其上仍叠 --video-grad 暗化，保证浅色文字可读。
 */
export function trackSceneKey(category: string): "ai" | "english" | "life" {
  switch (category) {
    case "ai_skill":
      return "ai";
    case "english_oral":
    case "english_foundation":
    case "silver_english":
      return "english";
    case "life":
      return "life";
    default:
      return "life";
  }
}

/** 按 category 拼 scene 场景背景图路径（public/lesson-stills/scene-bg-<key>.jpg）。 */
export function trackSceneSrc(category: string): string {
  return `/lesson-stills/scene-bg-${trackSceneKey(category)}.jpg`;
}

// 未来赛道（仅展示"即将上线"，对应有道跨赛道扩张规划）
export const FUTURE_TRACKS = [
  { key: "vocational", label: "职业教育" },
  { key: "certification", label: "考试考证" },
  { key: "abroad", label: "出国留学" },
  { key: "parenting", label: "亲子共建" },
];
