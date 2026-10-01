import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "tide-restore-test-")); roots.push(root);
  const source = join(root, "source.db"), target = join(root, "target.db"), assets = join(root, "assets");
  execFileSync("sqlite3", [source, "create table proof(value); insert into proof values(1);"]);
  execFileSync("sqlite3", [target, "create table proof(value); insert into proof values(2);"]);
  mkdirSync(assets); writeFileSync(join(assets, "keep.txt"), "original");
  return { root, source, target, assets };
}
function restore(f: ReturnType<typeof fixture>, archive: string, env = {}) {
  return spawnSync("bash", ["scripts/restore-db.sh", f.source, f.target, archive, "--force"], { env: { ...process.env, ASSETS_DIR: f.assets, ...env }, encoding: "utf8" });
}
function unchanged(f: ReturnType<typeof fixture>) {
  expect(readFileSync(join(f.assets, "keep.txt"), "utf8")).toBe("original");
  expect(execFileSync("sqlite3", [f.target, "select value from proof;"], { encoding: "utf8" }).trim()).toBe("2");
}
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { force: true, recursive: true })));
describe("offline restore preserves original data until validation", () => {
  it("rejects an empty archive without deleting live assets", () => {
    const f = fixture(); mkdirSync(join(f.root, "empty")); const archive = join(f.root, "empty.tar.gz");
    execFileSync("tar", ["-czf", archive, "-C", join(f.root, "empty"), "."]);
    expect(restore(f, archive).status).not.toBe(0); unchanged(f);
  });
  it("rejects multiple asset roots without selecting an arbitrary one", () => {
    const f = fixture(); mkdirSync(join(f.root, "one")); mkdirSync(join(f.root, "two")); const archive = join(f.root, "multiple.tar.gz");
    execFileSync("tar", ["-czf", archive, "-C", f.root, "one", "two"]);
    expect(restore(f, archive).status).not.toBe(0); unchanged(f);
  });
  it("restores a valid single-root snapshot and leaves a database safety backup", () => {
    const f = fixture(); mkdirSync(join(f.root, "snapshot")); writeFileSync(join(f.root, "snapshot", "new.txt"), "restored"); const archive = join(f.root, "assets.tar.gz");
    execFileSync("tar", ["-czf", archive, "-C", f.root, "snapshot"]);
    expect(restore(f, archive).status).toBe(0);
    expect(readFileSync(join(f.assets, "new.txt"), "utf8")).toBe("restored");
    expect(execFileSync("sqlite3", [f.target, "select value from proof;"], { encoding: "utf8" }).trim()).toBe("1");
    expect(readdirSync(f.root).some(name => name.startsWith("target.db.pre-restore-"))).toBe(true);
  });
  it("cleans temporary plaintext on failed decryption", () => {
    const f = fixture(); const secret = join(f.root, "key"); writeFileSync(secret, "synthetic-incorrect-key-only-for-test");
    const encrypted = join(f.root, "bad.db.enc"); writeFileSync(encrypted, "corrupt"); const temp = join(f.root, "temps"); mkdirSync(temp);
    const result = restore({ ...f, source: encrypted }, "", { BACKUP_ENCRYPTION_PASSWORD_FILE: secret, TMPDIR: temp });
    expect(result.status).not.toBe(0); unchanged(f); expect(readdirSync(temp)).toEqual([]);
  });
});
