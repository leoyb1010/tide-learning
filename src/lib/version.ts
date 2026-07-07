import { readFile } from "node:fs/promises";
import { join, basename } from "node:path";

/**
 * 版本 / 构建溯源（P1-2）。
 *
 * 目标：能从运行中的实例证明「当前跑的是哪个 commit / 哪次构建 / 何时启动」，
 * 消除审计发现的「进程早于 Git HEAD、无法证明运行版本」的不可追踪性。
 * 铁律：绝不回传任何密钥；DATABASE_URL 只暴露库文件名（basename）。
 */

/** 进程启动时间（模块首次加载即锁定），标识「运行的是哪次启动」。 */
export const PROCESS_STARTED_AT = new Date().toISOString();

export interface BuildInfo {
  commit: string;
  commitShort: string;
  branch: string;
  builtAt: string | null;
}

/** 读构建期落盘的 public/version.json（scripts/gen-version.mjs 生成）。缺失（dev / 未构建）→ unknown。 */
async function readBuildInfo(): Promise<BuildInfo> {
  try {
    const raw = await readFile(join(process.cwd(), "public", "version.json"), "utf8");
    const j = JSON.parse(raw) as Partial<BuildInfo>;
    return {
      commit: typeof j.commit === "string" ? j.commit : "unknown",
      commitShort: typeof j.commitShort === "string" ? j.commitShort : "unknown",
      branch: typeof j.branch === "string" ? j.branch : "unknown",
      builtAt: typeof j.builtAt === "string" ? j.builtAt : null,
    };
  } catch {
    return { commit: "unknown", commitShort: "unknown", branch: "unknown", builtAt: null };
  }
}

/** 读 Next 构建 id（.next/BUILD_ID，仅生产构建产物有）。dev 无此文件 → null。 */
async function readBuildId(): Promise<string | null> {
  try {
    return (await readFile(join(process.cwd(), ".next", "BUILD_ID"), "utf8")).trim();
  } catch {
    return null;
  }
}

/** DATABASE_URL 只暴露库文件名（basename），绝不回传完整路径 / 凭据。 */
function dbAlias(): string | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const cleaned = url.replace(/^file:/, "");
  return basename(cleaned) || null;
}

export interface VersionPayload {
  commit: string;
  commitShort: string;
  branch: string;
  builtAt: string | null;
  buildId: string | null;
  startedAt: string;
  nodeEnv: string;
  dbFile: string | null;
}

/** 汇总版本 / 构建溯源信息（不含任何密钥）。供 /api/version 与 /api/health 复用。 */
export async function getVersionPayload(): Promise<VersionPayload> {
  const [info, buildId] = await Promise.all([readBuildInfo(), readBuildId()]);
  return {
    commit: info.commit,
    commitShort: info.commitShort,
    branch: info.branch,
    builtAt: info.builtAt,
    buildId,
    startedAt: PROCESS_STARTED_AT,
    nodeEnv: process.env.NODE_ENV ?? "unknown",
    dbFile: dbAlias(),
  };
}
