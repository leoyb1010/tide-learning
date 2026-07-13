import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";

// sitemap.ts — 动态站点地图：静态营销页 + 已发布课程 + 已发布需求详情
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tide.learning";

  // 静态营销 / 合规入口
  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/courses`, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/updates`, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/demands`, changeFrequency: "daily", priority: 0.7 },
    { url: `${base}/pricing`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.3 },
  ];

  // 已发布课程与需求详情动态注入
  const [courses, demands] = await Promise.all([
    prisma.course.findMany({
      where: { status: "published", visibility: "public" },
      select: { slug: true, lastUpdatedAt: true },
    }),
    prisma.demand.findMany({
      // 仅收录已过审、进入公开榜单的需求
      where: { status: { in: ["collecting", "evaluating", "scheduled", "producing", "launched"] } },
      select: { id: true, updatedAt: true },
      take: 500,
    }),
  ]);

  const courseEntries: MetadataRoute.Sitemap = courses.map((c) => ({
    url: `${base}/courses/${c.slug}`,
    lastModified: c.lastUpdatedAt,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  const demandEntries: MetadataRoute.Sitemap = demands.map((d) => ({
    url: `${base}/demands/${d.id}`,
    lastModified: d.updatedAt,
    changeFrequency: "weekly",
    priority: 0.5,
  }));

  return [...staticEntries, ...courseEntries, ...demandEntries];
}
