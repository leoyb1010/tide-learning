import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { restrictToLocalApp } from "./audit-browser-network.mjs";

const base = process.env.BASE_URL || "http://127.0.0.1:3100";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
await restrictToLocalApp(page.context(), base);
const errors = [];
page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

function check(value, message) { if (!value) throw new Error(message); }

const home = await page.goto(`${base}/`, { waitUntil: "networkidle" });
const csp = home?.headers()["content-security-policy"] || "";
check(/script-src[^;]*'nonce-/.test(csp), "CSP missing script nonce");
if (process.env.NODE_ENV === "production") {
  check(!/script-src[^;]*unsafe-inline/.test(csp), "production script-src allows unsafe-inline");
  check(!/script-src[^;]*unsafe-eval/.test(csp), "production script-src allows unsafe-eval");
}

await page.goto(`${base}/pricing`, { waitUntil: "networkidle" });
const faq = page.getByRole("button", { name: "怎么退订？会立刻失效吗？" });
check(await faq.getAttribute("aria-expanded") === "true", "FAQ initial state missing");
await faq.click();
check(await faq.getAttribute("aria-expanded") === "false", "FAQ click did not hydrate");

await page.goto(`${base}/courses`, { waitUntil: "networkidle" });
// The mobile navigation also opens a dialog; scope this contract to course cards.
const previewTrigger = page.getByRole("main").locator('button[aria-haspopup="dialog"]').first();
const preview = page.getByRole("dialog", { name: / · 课程预览$/ });
await previewTrigger.click();
await preview.waitFor({ state: "visible" });
// Observe the real settled state; screenshot animation overrides can capture a compositor mid-frame.
await page.waitForFunction(() => {
  const panel = document.querySelector('[role="dialog"][aria-label$="课程预览"] .preview-sheet-in');
  if (!panel) return false;
  const css = getComputedStyle(panel);
  const box = panel.getBoundingClientRect();
  const transform = new DOMMatrixReadOnly(css.transform);
  return Number(css.opacity) >= 0.999 && Math.abs(transform.m42) < 0.1 &&
    box.top >= 0 && box.bottom <= innerHeight + 1 && box.left >= 0 && box.right <= innerWidth + 1 &&
    panel.getAnimations().every(animation => ["finished", "idle"].includes(animation.playState));
}, undefined, { timeout: 5000 });
await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
if (process.env.QA_OUT) {
  const settled = await preview.locator(".preview-sheet-in").evaluate(panel => {
    const css = getComputedStyle(panel);
    const box = panel.getBoundingClientRect();
    return { opacity: css.opacity, transform: css.transform, top: box.top, bottom: box.bottom, left: box.left, right: box.right, viewportWidth: innerWidth, viewportHeight: innerHeight };
  });
  await mkdir(process.env.QA_OUT, { recursive: true });
  await writeFile(join(process.env.QA_OUT, "course-preview-settled.json"), JSON.stringify(settled, null, 2));
  await page.screenshot({ path: join(process.env.QA_OUT, "mobile-course-preview.png"), fullPage: false });
}
await page.keyboard.press("Escape");
await page.getByRole("dialog").waitFor({ state: "hidden" });
check(await page.getByRole("dialog").count() === 0, "Escape left the preview dialog open");
await previewTrigger.click();
await preview.waitFor({ state: "visible" });
await preview.getByRole("button", { name: "关闭预览", exact: true }).click();
await page.getByRole("dialog").waitFor({ state: "hidden" });
check(await page.getByRole("dialog").count() === 0, "Close left the preview dialog open");
check(new URL(page.url()).pathname === "/courses", "dismissal changed the course-list location");
await page.goto(`${base}/pricing`, { waitUntil: "networkidle" });
await page.goBack({ waitUntil: "networkidle" });
check(new URL(page.url()).pathname === "/courses", "Back failed to restore the course-list page");
check(await page.getByRole("dialog").count() === 0, "Back resurrected a dismissed preview");
check(errors.length === 0, `browser console errors: ${errors.join(" | ")}`);

await page.goto(`${base}/does-not-exist`);
check(await page.getByRole("heading", { level: 1, name: "页面不存在" }).isVisible(), "404 has no visible h1");
errors.length = 0; // 浏览器会为预期的 404 文档记录一条资源错误。

await page.goto(`${base}/login`);
await page.getByLabel("用户名 / 手机号 / 邮箱").fill("demo@tide.learning");
await page.getByLabel("密码").fill("demo123");
await page.getByRole("button", { name: "登录" }).click();
await page.waitForURL(/\/(me|desk)/);
await page.goto(`${base}/me/settings/privacy`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "注销账号" }).click();
check(await page.getByText("输入“注销账号”").isVisible(), "self-service deletion confirmation UI missing");
check(await page.getByLabel("当前密码").isVisible(), "password confirmation UI missing");

check(errors.length === 0, `browser console errors: ${errors.join(" | ")}`);
await browser.close();
console.log("browser interaction contracts verified");
