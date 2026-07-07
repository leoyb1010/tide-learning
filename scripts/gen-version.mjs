// 构建期版本落盘（P1-2）：把当前 git commit + 分支 + 构建时间写入 public/version.json，
// 供 /api/version 与 /api/health 证明「3100 上正在运行的构建来自哪个 commit」。
// 关键：git 不可用（无 .git 的部署产物）时安全降级为 unknown，绝不让构建失败。
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

function safeGit(args) {
  try {
    return execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

const commit = safeGit("rev-parse HEAD") || "unknown";
const commitShort = commit === "unknown" ? "unknown" : commit.slice(0, 8);
const branch = safeGit("rev-parse --abbrev-ref HEAD") || "unknown";
const builtAt = new Date().toISOString();

const dir = join(process.cwd(), "public");
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, "version.json"),
  JSON.stringify({ commit, commitShort, branch, builtAt }, null, 2) + "\n",
);
console.log(`[gen-version] ${commitShort} @ ${builtAt} (branch ${branch}) → public/version.json`);
