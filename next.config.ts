import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 三端复用预留：所有业务逻辑集中在 src/lib 与 API 层，
  // Web 视图层与后续 iOS/Android 客户端共享同一套服务端 entitlement。

  // gzip 压缩 HTML/JS/CSS 响应（自建 next start 生效；线上速度直接受益）。
  compress: true,

  // 不暴露 X-Powered-By: Next.js 头（减少指纹信息泄露）。
  poweredByHeader: false,

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

  // 安全响应头 + 静态资源缓存。self-host next start 生效。
  // TODO：HSTS（Strict-Transport-Security）与 CSP（Content-Security-Policy）
  //       不在本轮范围——上线走 HTTPS 后再补 HSTS，CSP 需先梳理内联脚本/样式白名单。
  async headers() {
    return [
      {
        // 全站安全头：禁点击劫持、禁 MIME 嗅探、收敛 Referer 泄露。
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // 视频为内容寻址的不可变资源（改内容即换文件名），可长缓存 7 天。
        source: "/videos/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=604800, immutable" },
        ],
      },
      {
        // 课件图同理长缓存 7 天，命中即免回源。
        source: "/courseware/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=604800, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
