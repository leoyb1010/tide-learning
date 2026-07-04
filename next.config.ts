import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 三端复用预留：所有业务逻辑集中在 src/lib 与 API 层，
  // Web 视图层与后续 iOS/Android 客户端共享同一套服务端 entitlement。

  // gzip 压缩 HTML/JS/CSS 响应（自建 next start 生效；线上速度直接受益）。
  compress: true,

  // 按需拆包图标 barrel：@phosphor-icons/react 不在 Next 默认白名单，
  // 38 个 client 组件从裸 barrel 引图标会整包进 bundle。声明后 Next 自动
  // 改写成按图标的深路径导入，仅打包实际用到的图标，覆盖全站。
  experimental: {
    optimizePackageImports: ["@phosphor-icons/react"],
  },

  images: {
    // 现网图片均为本站资源（/brand/*.png 等），暂无外域图，
    // 故 remotePatterns 留空；将来接 CDN 时在此白名单化具体域，切勿放通配。
    remotePatterns: [],
    // 优先输出 WebP（体积更小），浏览器不支持时 next/image 自动回退原格式。
    formats: ["image/webp"],
  },
};

export default nextConfig;
