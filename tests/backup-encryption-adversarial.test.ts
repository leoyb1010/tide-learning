import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
let root = "";
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });
describe("encrypted snapshot publication", () => {
  it("does not publish or retain plaintext when encryption fails", () => {
    root = mkdtempSync(join(tmpdir(), "tide-backup-failure-"));
    const database = join(root, "test.db"), output = join(root, "backups"), key = join(root, "key");
    execFileSync("sqlite3", [database, "create table proof(value); insert into proof values(1);"]);
    writeFileSync(key, "synthetic-key-at-least-twenty-bytes");
    // Activate only the base provider: no AES cipher is available, so encryption
    // fails after the plaintext SQLite snapshot is created (OpenSSL 3 on CI).
    const config = join(root, "no-ciphers.cnf");
    writeFileSync(config, "openssl_conf = init\n[init]\nproviders = providers\n[providers]\nbase = base\n[base]\nactivate = 1\n");
    mkdirSync(output);
    const run = spawnSync("bash", ["scripts/backup-db.sh", database, output], { env: { ...process.env, ASSETS_DIR: join(root, "missing-assets"), REQUIRE_ENCRYPTION: "1", BACKUP_ENCRYPTION_PASSWORD_FILE: key, OPENSSL_CONF: config }, encoding: "utf8" });
    expect(run.status).not.toBe(0);
    expect(readdirSync(output)).toEqual([]);
  });
});
