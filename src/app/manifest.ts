import type { MetadataRoute } from "next";

/**
 * PWA Web App Manifest。让「有道自习室 STUDIO」可安装到桌面/主屏，
 * 提升订阅制学习产品的留存与品牌感。图标见 public/icons/。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "有道自习室 STUDIO",
    short_name: "有道自习室",
    description: "订阅制学习平台：说出想学的，AI 造一门课，边学边记，到点复习。",
    start_url: "/",
    display: "standalone",
    background_color: "#e7eaf0",
    theme_color: "#e7eaf0",
    lang: "zh-CN",
    icons: [
      { src: "/icons/manifest-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/manifest-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/manifest-icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/manifest-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
