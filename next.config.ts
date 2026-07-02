import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 三端复用预留：所有业务逻辑集中在 src/lib 与 API 层，
  // Web 视图层与后续 iOS/Android 客户端共享同一套服务端 entitlement。
};

export default nextConfig;
