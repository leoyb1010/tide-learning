import { redirect } from "next/navigation";
import { listCourses, getHomeDemandTeaser } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { prisma } from "@/lib/db";
import { TrackView } from "@/components/TrackView";
import { TRACKS, trackGradientVar, trackIconKey, resolveCoverSrc } from "@/lib/tracks";
import type { TrackCardData, FeaturedCourse } from "@/components/home/types";
import { ImmersiveStudyRoom } from "@/components/home/ImmersiveStudyRoom";

/**
 * 首页 · 双态（v4.0「沉浸式首页」）。
 * - 未登录：三幕式沉浸营销首页「推门进入一间深夜自习室」
 *   （第一幕 推门 / 第二幕 走近书桌 / 第三幕 环顾房间）。
 * - 登录后：书桌已独立成 /desk，这里直接 redirect 过去（书桌是登录用户的「家」）。
 *
 * 架构铁律：本文件是 server component（async，取真实数据）。沉浸的 3D/滚动/视差
 * 全部拆到 <ImmersiveStudyRoom>（"use client"）及其分幕子组件，本文件不引任何
 * client-only 原语，只做数据获取与真实内容装配；真实文案由子组件以真实 DOM 渲染
 * （SSR），利于 SEO/LCP。
 */
export default async function HomePage() {
  const user = await getCurrentUser();
  if (user) redirect("/desk"); // 登录 → 书桌（保持现有重定向逻辑不变）
  return <MarketingHome />;
}

/* ============================================================
   未登录：三幕沉浸营销首页（server 取真实数据 → client 场景渲染）
   ============================================================ */
async function MarketingHome() {
  const [all, demandTeaserResult, plans, activeLearners] = await Promise.all([
    listCourses({ sort: "recommended" }),
    // 首页第三幕只需「榜首一条 teaser + 征集总数」，用轻查询替代最重的
    // listRankedDemands（7 条聚合 + 社交 join），关键路径不再被社交聚合阻塞。
    getHomeDemandTeaser(["collecting", "evaluating", "scheduled", "producing"]),
    prisma.plan.findMany({ where: { isActive: true }, orderBy: { priceCents: "asc" } }),
    prisma.learningProgress.findMany({
      where: { lastPlayedAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } },
      distinct: ["userId"],
      select: { userId: true },
    }),
  ]);
  // 未登录分支：权益快照必为免费态，用于 VoteButton canVote 判定（保持签名一致）。
  const snapshot = await resolveEntitlement(null);

  // 全站课程总量（信任条真实数字）
  const totalCourses = all.length;

  // 第三幕赛道精选卡片墙数据（替代原 CourseShelf 书架墙，问题⑧-3）：
  // 真实赛道体系（TRACKS）+ 每赛道真实在架课程数，映射为赛道渐变 + 主题图标卡。
  // 书架能力回归 /desk，首页改用产品能力/赛道展示。
  const courseCountByCat = new Map<string, number>();
  for (const c of all) {
    courseCountByCat.set(c.category, (courseCountByCat.get(c.category) ?? 0) + 1);
  }
  const tracks: TrackCardData[] = TRACKS.map((t) => ({
    key: t.key,
    label: t.label,
    blurb: t.blurb,
    people: t.people,
    gradient: trackGradientVar(t.key),
    iconKey: trackIconKey(t.key),
    courseCount: courseCountByCat.get(t.key) ?? 0,
  }));

  // 首页课程抽屉（HomeFunnel 01）：取前 10 门真实在架课程，用 resolveCoverSrc
  // 映射到 public/covers 下真实封面 jpg（8 门专属 + 各赛道封面池，永不落回纯渐变）。
  const featuredCourses: FeaturedCourse[] = all.slice(0, 10).map((c) => ({
    slug: c.slug,
    title: c.title,
    subtitle: c.subtitle,
    categoryLabel: c.categoryLabel,
    gradient: trackGradientVar(c.category),
    cover: resolveCoverSrc(c.slug, c.category, c.id),
    lessonsCount: c.lessonsCount,
  }));

  // 第三幕共创 teaser：榜首需求（排序口径与需求广场 listRankedDemands 一致）。
  const demandTeaser = demandTeaserResult.teaser;

  // 订阅 teaser：优先全站年费方案，格式化成「¥N/年」文案。
  const yearPlan =
    plans.find((p) => p.scope === "all" && p.billingPeriod === "year") ??
    plans.find((p) => p.scope === "all") ??
    plans[0];
  const yearPriceText = yearPlan ? `¥${(yearPlan.priceCents / 100).toFixed(0)}/年` : null;

  // “此刻在学”只统计最近 5 分钟真实写入学习进度的去重用户，不再从累计人数伪造。
  const onlineCount = activeLearners.length;

  return (
    <>
      <TrackView event="homepage_view" properties={{ mode: "immersive" }} />
      {/* 沉浸场景全宽脱离 <main> 的 max-w/padding，贴满视口。真实内容由子组件 SSR 渲染。 */}
      <div className="studyroom-bleed">
        <ImmersiveStudyRoom
          onlineCount={onlineCount}
          totalCourses={totalCourses}
          tracks={tracks}
          featuredCourses={featuredCourses}
          demand={demandTeaser}
          demandCount={demandTeaserResult.count}
          canVote={snapshot.canVote}
          yearPriceText={yearPriceText}
        />
      </div>
    </>
  );
}
