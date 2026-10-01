import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
it.each(["contract", "search"])("explicit %s runtime contracts fail when their server is unavailable", suite => {
  const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", `tests/${suite}.test.ts`], { env: { ...process.env, CONTRACT_BASE: "http://127.0.0.1:1" }, encoding: "utf8", timeout: 30_000 });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
}, 35_000);
