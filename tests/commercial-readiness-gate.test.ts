import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { cwd } from "node:process";
import { describe, expect, it } from "vitest";

describe("commercial readiness release gate", () => {
  it("fails closed in production when real-money prerequisites are absent", () => {
    const directory = mkdtempSync(join(tmpdir(), "tide-commercial-gate-"));
    const run = spawnSync(process.execPath, ["scripts/commercial-readiness-check.mjs", "--json"], {
      cwd: cwd(),
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_URL: `file:${join(directory, "missing.db")}`,
        NEXT_PUBLIC_PAY_CHANNEL: "mock",
        NEXT_PUBLIC_SITE_URL: "https://example.com",
        STRIPE_SECRET_KEY: "",
        STRIPE_WEBHOOK_SECRET: "",
        REQUIRE_ENCRYPTION: "0",
        BACKUP_ENCRYPTION_PASSWORD_FILE: "",
      },
      encoding: "utf8",
    });
    rmSync(directory, { force: true, recursive: true });
    expect(run.status).toBe(1);
    const result = JSON.parse(run.stdout) as {
      ok: boolean;
      production: boolean;
      failures: Array<{ name: string }>;
    };

    expect(result.production).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.failures.map((failure) => failure.name)).toEqual(expect.arrayContaining([
      "payment_channel",
      "stripe_credentials",
      "encrypted_backups",
      "database_path",
      "database_queries",
    ]));
  });
});
