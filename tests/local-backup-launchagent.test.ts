import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("本地生产备份 LaunchAgent", () => {
  it("由 Node 包装器进入备份脚本，并强制加密与初次运行验收", () => {
    const installer = source("scripts/install-local-backup-launchagent.sh");
    expect(installer).toContain("run-backup-launchagent.mjs");
    expect(installer).toContain("<key>REQUIRE_ENCRYPTION</key><string>1</string>");
    expect(installer).toContain("Initial backup failed with exit code");
    expect(installer).toContain('chmod 600 "$PASSWORD_FILE"');
    expect(installer).toContain('KEEP must be 1-365');
  });

  it("备份产物默认私有，并在轮转前校验 KEEP 边界", () => {
    const backup = source("scripts/backup-db.sh");
    expect(backup).toContain("umask 077");
    expect(backup).toContain('chmod 700 "$BACKUP_DIR"');
    expect(backup).toContain("KEEP 必须是 1-365 的整数");
    expect(backup.indexOf("KEEP 必须是 1-365 的整数")).toBeLessThan(backup.indexOf("tail -n +$((KEEP + 1))"));
  });

  it("包装器透传子进程退出码，不把失败伪装成成功", () => {
    const wrapper = source("scripts/run-backup-launchagent.mjs");
    expect(wrapper).toContain('spawnSync("/bin/bash"');
    expect(wrapper).toContain("process.exit(result.status ?? 1)");
  });
});
