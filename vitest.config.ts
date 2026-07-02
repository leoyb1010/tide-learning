import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Vitest 配置（工程测试）：
 *  - node 环境（被测 lib 均为纯服务端 TS，无 DOM 依赖）。
 *  - 配 @/* 别名与 tsconfig 一致，使测试可用 `@/lib/...` 导入。
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
  },
});
