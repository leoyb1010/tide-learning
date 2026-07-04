import { redirect } from "next/navigation";
import { listCourses, listUpdates, getHomeDemandTeaser } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { prisma } from "@/lib/db";
import { TrackView } from "@/components/TrackView";
import type { CourseCardData } from "@/components/CourseCard";
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
  const [all, updates, demandTeaserResult, plans] = await Promise.all([
    listCourses({ sort: "recommended" }),
    listUpdates(8),
    // 首页第三幕只需「榜首一条 teaser + 征集总数」，用轻查询替代最重的
    // listRankedDemands（7 条聚合 + 社交 join），关键路径不再被社交聚合阻塞。
    getHomeDemandTeaser(["collecting", "evaluating", "scheduled", "producing"]),
    prisma.plan.findMany({ where: { isActive: true }, orderBy: { priceCents: "asc" } }),
  ]);
  // 未登录分支：权益快照必为免费态，用于 VoteButton canVote 判定（保持签名一致）。
  const snapshot = await resolveEntitlement(null);

  // 全站课程总量（信任条真实数字）
  const totalCourses = all.length;

  // 书架墙数据：直接复用 listCourses 结果映射为 CourseShelf 所需的 CourseCardData 形状。
  // 本周有更新的课打 isNew（书脊 Sparkle 点睛）。
  const newSlugs = new Set(updates.map((u) => u.courseSlug));
  const shelfCourses: CourseCardData[] = all.map((c) => ({
    id: c.id,
    slug: c.slug,
    title: c.title,
    subtitle: c.subtitle,
    category: c.category,
    categoryLabel: c.categoryLabel,
    levelLabel: c.levelLabel,
    coverColor: c.coverColor,
    updateText: c.updateText,
    duration: c.duration,
    lessonsCount: c.lessonsCount,
    learnersCount: c.learnersCount,
    freeLessonsCount: c.freeLessonsCount,
    status: c.status,
    isNew: newSlugs.has(c.slug),
  }));

  // 第三幕共创 teaser：榜首需求（排序口径与需求广场 listRankedDemands 一致）。
  const demandTeaser = demandTeaserResult.teaser;

  // 订阅 teaser：优先全站年费方案，格式化成「¥N/年」文案。
  const yearPlan =
    plans.find((p) => p.scope === "all" && p.billingPeriod === "year") ??
    plans.find((p) => p.scope === "all") ??
    plans[0];
  const yearPriceText = yearPlan ? `¥${(yearPlan.priceCents / 100).toFixed(0)}/年` : null;

  // 「凌晨一点，还有 N 人在这里自习」——真实在线数占位：
  // 无实时在线埋点，用「全站累计学习人数」派生一个稳定、合理的当前在线数
  // （学习人数总和的一个小比例，落在 [120, 4800] 的可信区间；同一数据集稳定不乱跳）。
  // 真实 DOM 数字，SSR 直出，利于 LCP/SEO。
  const totalLearners = all.reduce((sum, c) => sum + (c.learnersCount ?? 0), 0);
  const onlineCount = Math.max(120, Math.min(4800, Math.round(totalLearners * 0.008) || 137));

  return (
    <>
      <TrackView event="homepage_view" properties={{ mode: "immersive" }} />
      {/* 沉浸场景全宽脱离 <main> 的 max-w/padding，贴满视口。真实内容由子组件 SSR 渲染。 */}
      <div className="studyroom-bleed">
        <ImmersiveStudyRoom
          onlineCount={onlineCount}
          totalCourses={totalCourses}
          courses={shelfCourses}
          demand={demandTeaser}
          demandCount={demandTeaserResult.count}
          canVote={snapshot.canVote}
          yearPriceText={yearPriceText}
        />
      </div>
    </>
  );
}
