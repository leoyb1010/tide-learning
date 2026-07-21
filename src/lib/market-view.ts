/**
 * 集市视图纯函数（无 "use client"，无 server 链）——server page 与 client 摊位卡共用。
 * 只做展示派生：摊主等级徽章、数字缩写、赛道渐变映射代理。铁律：零副作用、零 IO。
 */

import { trackGradientVar } from "@/lib/tracks";

/** 摊位卡视图模型（server 组装，透传给 client 卡片；结构即 v4.0 摊位契约）。 */
export interface MarketStall {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  category: string;
  coverColor: string;
  coverSrc: string;
  origin: string; // ai_generated / user_imported / user_created / official
  /** 拿走数（= 有该课学习记录的去重用户数，排除作者本人，来自数据层）。 */
  collectCount: number;
  /** 累计学习人数（Course.learnersCount 真值，交易气息补充信号）。 */
  learnersCount: number;
  /** 售价（积分）：null 或 0 = 免费；>0 = 付费。UI 据此出价签 / 「免费」标。 */
  priceCredits: number | null;
  /** 是否付费（priceCredits>0 的派生量，view 层给 UI 少算一次）。 */
  isPaid: boolean;
  /** 累计成交数（付费被购买次数；免费拿走不计入，销量真值口径）。 */
  salesCount: number;
  /** 当前登录用户是否已把此课拿到书架（决定 CTA 初始态）。 */
  collectedByMe: boolean;
  /**
   * 当前登录用户的订阅是否覆盖本课赛道（U4-a 价签智能化）。
   * true = 已订阅且订阅涵盖本课 category（付费课对该用户免额外付费 → 价签显示「订阅已含」）。
   * 游客 / 未订阅 / 订阅未覆盖本赛道 → false。免费课不受此影响（照常显示「免费」）。
   * 可选字段：iOS 旧客户端可忽略（缺省按 false 处理，退回价格显示），不破契约。
   */
  subscriptionCovered?: boolean;
  /** 是否本人摊位（自己造的课不出「拿走」，显示「你的摊位」）。 */
  mine: boolean;
  /** 上新时间戳（毫秒），用于"今日上新"氛围计算与"最新"排序。 */
  createdAtMs: number;
  /** 评分均分（S5）：有真实评价读真实均分；零评价回退占位派生（数据层已算好，卡片/排序直接读）。 */
  ratingScore: number;
  /** 评价条数（S5）：真实条数；零评价为占位派生数。 */
  ratingCount: number;
  /** 是否占位评分（无真实评价时 true）：卡片据此标「示例」，诚实不冒充。 */
  ratingIsPlaceholder: boolean;
  seller: {
    id: string | null;
    nickname: string;
    avatarUrl: string | null;
    /** 摊主等级(1~4)：按其在本集市所有摊位的累计被拿走数派生（sellerBadge tier），无数据为 1。 */
    level: number;
  };
}

/**
 * 排序键（交易市场维度）：
 *   hot   = 热销（成交/拿走多，交易市场默认看热货）
 *   new   = 最新（上新时间倒序）
 *   rated = 口碑（评分高优先，读 MarketStall.ratingScore：真实评价优先，零评价占位派生）
 *   price = 价格（免费优先→积分从低到高，让囊中羞涩者先看得起的）
 * URL searchParam 契约；iOS GET /api/market 复用同集合。
 */
export type MarketSort = "hot" | "new" | "rated" | "price";

/** 合法排序键集合（用于 GET /api/market 归一化，避免各处硬编码字符串漂移）。 */
export const MARKET_SORT_KEYS: readonly MarketSort[] = ["hot", "new", "rated", "price"] as const;

export const MARKET_SORTS: { key: MarketSort; label: string }[] = [
  { key: "hot", label: "热销" },
  { key: "new", label: "最新" },
  { key: "rated", label: "口碑" },
  { key: "price", label: "价格" },
];

/** 把任意入参规整为合法排序键，非法值回落"热销"（交易市场默认看热货）。兼容 iOS 旧值 newest→new。 */
export function normalizeSort(raw: string | undefined | null): MarketSort {
  if (raw === "newest") return "new";
  return (MARKET_SORT_KEYS as readonly string[]).includes(raw ?? "")
    ? (raw as MarketSort)
    : "hot";
}

/**
 * 价签文案（交易市场统一口径）：免费课 → "免费"；付费课 → "N 积分"。
 * priceCredits null/0 一律视免费（与 schema「null=免费」及 collect 端点分支一致）。
 * 纯展示，不做任何折算；数字缩写不介入（价格通常小，全量展示更可信）。
 */
export function formatPrice(priceCredits: number | null): { free: boolean; label: string; amount: number } {
  const amount = priceCredits ?? 0;
  if (amount <= 0) return { free: true, label: "免费", amount: 0 };
  return { free: false, label: `${amount} 积分`, amount };
}

/**
 * 成交热度文案（交易市场「销量」口径）：
 *   付费课看 salesCount（真实成交）；免费课看 collectCount（被拿走数，等价成交气息）。
 * 二者取更能代表「有多少人入袋」的那个，统一驱动卡片/详情的「N 人入手」信号。
 */
export function tradeVolume(stall: Pick<MarketStall, "isPaid" | "salesCount" | "collectCount">): number {
  return stall.isPaid ? stall.salesCount : stall.collectCount;
}

/**
 * 摊主等级徽章：按累计被拿走数分档，给摊主一个"经营口碑"标签。
 * MVP 无独立等级字段，用真实拿走量派生，热门作者自然升档，克制不夸张。
 */
export function sellerBadge(collectTotal: number): { label: string; tier: 1 | 2 | 3 | 4 } {
  if (collectTotal >= 50) return { label: "金牌摊主", tier: 4 };
  if (collectTotal >= 20) return { label: "人气摊主", tier: 3 };
  if (collectTotal >= 5) return { label: "活跃摊主", tier: 2 };
  return { label: "新摊主", tier: 1 };
}

/** 大数缩写（中国大陆口径，「万」而非「k」）：<10000 直接展示，≥10000 折算为「N.N万」。
 *  例：1234 → 1234；12345 → 1.2万；123456 → 12万。交易气息数字统一走这套（避免各卡各写）。 */
export function abbrevCount(n: number): string {
  if (n < 10000) return String(n);
  const w = n / 10000;
  return `${w >= 10 ? Math.round(w) : w.toFixed(1)}万`;
}

/** 赛道渐变（代理 tracks.trackGradientVar，保持 market 侧单一 import 面）。 */
export function stallGradientVar(category: string): string {
  return trackGradientVar(category);
}

/**
 * 交易市场排序（server 页与 iOS API 共用；纯函数、不改原数组、同分保稳定原序）。
 *   hot   → 成交热度降序（tradeVolume：付费看销量、免费看拿走数）
 *   new   → 上新时间降序
 *   rated → 评分降序（读数据层已算好的 ratingScore：有真实评价读真实、零评价占位派生，同课稳定）
 *   price → 价格升序（免费=0 排最前，付费按积分从低到高，价同再按热度）
 */
export function sortStalls(stalls: MarketStall[], sort: MarketSort): MarketStall[] {
  const arr = stalls.map((s, i) => ({ s, i }));
  arr.sort((a, b) => {
    if (sort === "new") {
      if (b.s.createdAtMs !== a.s.createdAtMs) return b.s.createdAtMs - a.s.createdAtMs;
    } else if (sort === "rated") {
      const ra = a.s.ratingScore;
      const rb = b.s.ratingScore;
      if (rb !== ra) return rb - ra;
      // 同分再按成交热度，避免评分并列时纯靠原序
      if (tradeVolume(b.s) !== tradeVolume(a.s)) return tradeVolume(b.s) - tradeVolume(a.s);
    } else if (sort === "price") {
      const pa = a.s.priceCredits ?? 0;
      const pb = b.s.priceCredits ?? 0;
      if (pa !== pb) return pa - pb; // 升序：免费/低价在前
      if (tradeVolume(b.s) !== tradeVolume(a.s)) return tradeVolume(b.s) - tradeVolume(a.s);
    } else {
      // hot（默认）：成交热度降序
      if (tradeVolume(b.s) !== tradeVolume(a.s)) return tradeVolume(b.s) - tradeVolume(a.s);
    }
    return a.i - b.i; // 同分：保稳定原序
  });
  return arr.map((x) => x.s);
}
