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
  origin: string; // ai_generated / user_imported / official
  /** 拿走数（= 有该课学习记录的去重用户数，排除作者本人，来自数据层）。 */
  collectCount: number;
  /** 累计学习人数（Course.learnersCount 真值，交易气息补充信号）。 */
  learnersCount: number;
  /** 当前登录用户是否已把此课拿到书架（决定 CTA 初始态）。 */
  collectedByMe: boolean;
  /** 是否本人摊位（自己造的课不出「拿走」，显示「你的摊位」）。 */
  mine: boolean;
  /** 上新时间戳（毫秒），用于"今日上新"氛围计算与"最新"排序。 */
  createdAtMs: number;
  seller: {
    id: string | null;
    nickname: string;
    avatarUrl: string | null;
    /** 摊主等级(1~4)：按其在本集市所有摊位的累计被拿走数派生（sellerBadge tier），无数据为 1。 */
    level: number;
  };
}

/** 排序键：最热（拿走多）/ 最新。URL searchParam 契约。 */
export type MarketSort = "hot" | "new";

export const MARKET_SORTS: { key: MarketSort; label: string }[] = [
  { key: "hot", label: "最热" },
  { key: "new", label: "最新" },
];

/** 把任意入参规整为合法排序键，非法值回落"最热"（交易市场默认看热货）。 */
export function normalizeSort(raw: string | undefined | null): MarketSort {
  return raw === "new" ? raw : "hot";
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

/** 大数缩写：1234 → 1.2k，交易气息数字统一走这套（避免各卡各写）。 */
export function abbrevCount(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k >= 10 ? Math.round(k) : k.toFixed(1)}k`;
}

/** 赛道渐变（代理 tracks.trackGradientVar，保持 market 侧单一 import 面）。 */
export function stallGradientVar(category: string): string {
  return trackGradientVar(category);
}

/**
 * 客户端排序：卡片"拿走"乐观更新后，切排序 tab 无需回服务端，
 * 直接在已加载的摊位数组上稳定重排（同分保原序，交互零延迟）。
 * 纯函数、不改原数组。
 */
export function sortStalls(stalls: MarketStall[], sort: MarketSort): MarketStall[] {
  const arr = stalls.map((s, i) => ({ s, i }));
  arr.sort((a, b) => {
    if (sort === "new") {
      if (b.s.createdAtMs !== a.s.createdAtMs) return b.s.createdAtMs - a.s.createdAtMs;
    } else {
      if (b.s.collectCount !== a.s.collectCount) return b.s.collectCount - a.s.collectCount;
    }
    return a.i - b.i; // 同分：保稳定原序
  });
  return arr.map((x) => x.s);
}
