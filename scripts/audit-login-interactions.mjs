/** Isolated, stubbed login failure/repeat/retry contract. Never sends credentials to a provider. */
import { chromium } from "playwright";
import { restrictToLocalApp } from "./audit-browser-network.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const base = process.env.BASE_URL || "http://127.0.0.1:3100";
const out = process.env.QA_OUT || path.join(process.cwd(), "evidence", "browser-qa");
assert(["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(base).hostname), "audit only supports an isolated loopback app");
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const viewport of [{ name: "mobile", width: 375, height: 812 }, { name: "desktop", width: 1440, height: 1000 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: "block" });
    await restrictToLocalApp(context, base);
    const page = await context.newPage();
    let requests = 0;
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    await page.route("**/api/auth/login", async route => {
      requests++;
      if (requests === 1) await pending;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "合成测试：服务暂时不可用，请重试" }) });
    });
    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await page.getByLabel("用户名 / 手机号 / 邮箱").fill("synthetic@example.test");
    await page.getByLabel("密码", { exact: true }).fill("Synthetic-login-only-123");
    const requestStarted = page.waitForRequest(request => request.url().endsWith("/api/auth/login"));
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await requestStarted;
    assert.equal(await page.getByRole("button", { name: "去注册", exact: true }).isDisabled(), true, "mode switched during active login");
    assert.equal(await page.getByRole("button", { name: "登录", exact: true }).isDisabled(), true, "submit is not disabled");
    await page.getByLabel("密码", { exact: true }).press("Enter");
    await page.screenshot({ path: path.join(out, `${viewport.name}-login-pending.png`) });
    assert.equal(requests, 1, "repeat input issued another login request");
    release();
    await page.getByRole("alert").waitFor({ state: "visible" });
    assert.match(await page.getByRole("alert").innerText(), /服务暂时不可用/);
    await page.screenshot({ path: path.join(out, `${viewport.name}-login-server-error.png`) });
    assert.equal(await page.getByRole("button", { name: "去注册", exact: true }).isEnabled(), true);
    const retryResponse = page.waitForResponse(response => response.url().endsWith("/api/auth/login"));
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await retryResponse;
    assert.equal(requests, 2, "error state cannot retry");
    await page.getByRole("button", { name: "去注册", exact: true }).click();
    await page.getByLabel("昵称（可选）").waitFor({ state: "visible" });
    await page.getByRole("button", { name: "去登录", exact: true }).click();
    assert.equal(await page.getByLabel("用户名 / 手机号 / 邮箱").inputValue(), "synthetic@example.test");
    results.push({ viewport: viewport.name, repeatedSubmission: "passed", pendingModeLock: "passed", visibleError: "passed", retry: "passed", modeReturn: "passed", providerCalls: 0 });
    await context.close();
  }
} finally { await browser.close(); }
await writeFile(path.join(out, "login-interactions.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
