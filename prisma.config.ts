import path from "node:path";
// 有了 prisma.config.ts 后，Prisma 不再自动加载 .env（会打印 "skipping environment
// variable loading"）。这里显式加载 .env，保证 `prisma db push`/`npm run setup` 等仍能
// 从 .env 读到 DATABASE_URL（否则报 "Environment variable not found: DATABASE_URL"）。
import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma 配置（替代已废弃的 package.json#prisma；Prisma 7 将移除后者）。
 * - schema：schema 文件位置（保持默认 prisma/schema.prisma）。
 * - migrations.seed：`prisma db push`/`migrate reset` 后运行的 seed 命令（原 package.json 的 seed）。
 * schema 变更必须提交 prisma/migrations，并通过 migrate deploy 应用；seed 仍走 tsx。
 */
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
