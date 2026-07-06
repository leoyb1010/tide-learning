import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// P1-9：SQLite 连接后开 WAL + busy_timeout，缓解并发读写下的 "database is locked"。
// 仅对 sqlite（DATABASE_URL 以 file: 开头）生效；用不 await 的 IIFE 后台跑，失败仅 console.warn，
// 不阻塞模块导入、不破坏单例。用全局标记确保只跑一次（复用 globalForPrisma 单例时不重复执行）。
// 注意：PRAGMA journal_mode / busy_timeout 会「返回结果行」，SQLite 下必须用 $queryRawUnsafe，
// 用 $executeRawUnsafe 会抛「Execute returned results, which is not allowed in SQLite」——
// 那样第一条就抛、第二条 busy_timeout 永不执行（WAL 仅因是库文件持久属性而看似生效）。
const globalForPragma = globalForPrisma as { prismaSqlitePragma?: boolean };
if (!globalForPragma.prismaSqlitePragma && (process.env.DATABASE_URL ?? "").startsWith("file:")) {
  globalForPragma.prismaSqlitePragma = true;
  void (async () => {
    try {
      await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
      await prisma.$queryRawUnsafe("PRAGMA busy_timeout=5000;");
    } catch (e) {
      console.warn("[db] SQLite PRAGMA 初始化失败（不影响运行）：", e instanceof Error ? e.message : e);
    }
  })();
}
