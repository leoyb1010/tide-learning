import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// P1-9：SQLite 连接后开 WAL + busy_timeout，缓解并发读写下的 "database is locked"。
// 仅对 sqlite（DATABASE_URL 以 file: 开头）生效；$executeRaw 为异步，用不 await 的 IIFE
// 后台跑，失败仅 console.warn，不阻塞模块导入、不破坏单例。用全局标记确保只跑一次
// （复用 globalForPrisma 单例时不重复执行）。
const globalForPragma = globalForPrisma as { prismaSqlitePragma?: boolean };
if (!globalForPragma.prismaSqlitePragma && (process.env.DATABASE_URL ?? "").startsWith("file:")) {
  globalForPragma.prismaSqlitePragma = true;
  void (async () => {
    try {
      await prisma.$executeRawUnsafe("PRAGMA journal_mode=WAL;");
      await prisma.$executeRawUnsafe("PRAGMA busy_timeout=5000;");
    } catch (e) {
      console.warn("[db] SQLite PRAGMA 初始化失败（不影响运行）：", e instanceof Error ? e.message : e);
    }
  })();
}
