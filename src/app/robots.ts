import type { MetadataRoute } from "next";

// robots.ts — 动态 robots 规则；私有/后台路径禁抓
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tide.learning";
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // 私有与后台页面不进搜索引擎
        disallow: ["/admin", "/me", "/notes", "/api/", "/login"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
