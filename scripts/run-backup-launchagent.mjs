import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const dbPath = process.argv[2];
const backupDir = process.argv[3];

if (!dbPath || !backupDir) {
  console.error("Usage: node scripts/run-backup-launchagent.mjs DB_PATH BACKUP_DIR");
  process.exit(2);
}

const result = spawnSync("/bin/bash", [path.join(root, "scripts/backup-db.sh"), dbPath, backupDir], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
