import { chromium } from "playwright";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const outDir = process.env.QA_OUT ?? path.join(process.cwd(), "evidence", "browser-qa");
const configuredChrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chrome = existsSync(configuredChrome) ? configuredChrome : undefined;
const axePath = path.join(process.cwd(), "node_modules", "axe-core", "axe.min.js");
const pages = ["/", "/courses", "/demands", "/pricing", "/login"];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ ...(chrome ? { executablePath: chrome } : {}), headless: true });
const report = [];

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
]) {
  const context = await browser.newContext({ viewport });
  for (const route of pages) {
    const page = await context.newPage();
    const consoleErrors = [];
    const failed = [];
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    page.on("response", (res) => { if (res.status() >= 400) failed.push({ status: res.status(), url: res.url() }); });
    await page.addInitScript(() => {
      window.__qa = { cls: 0, lcp: 0, shifts: [] };
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__qa.lcp = entry.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) {
          window.__qa.cls += entry.value;
          window.__qa.shifts.push({
            value: entry.value,
            sources: entry.sources?.map((s) => ({ node: s.node?.outerHTML?.slice(0, 180), previousRect: s.previousRect, currentRect: s.currentRect })) ?? [],
          });
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    const started = Date.now();
    await page.goto(`${baseURL}${route}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    // 键盘基线：首个 Tab 必须进入可交互元素，不能把焦点留在 body/document。
    await page.keyboard.press("Tab");
    const keyboard = await page.evaluate(() => {
      const el = document.activeElement;
      return {
        focused: Boolean(el && el !== document.body && el !== document.documentElement),
        tag: el?.tagName ?? null,
        role: el?.getAttribute("role") ?? null,
        label: el?.getAttribute("aria-label") ?? el?.textContent?.trim().slice(0, 80) ?? null,
      };
    });
    await page.addScriptTag({ path: axePath });
    const metrics = await page.evaluate(async () => {
      const axeResult = await window.axe.run(document, { resultTypes: ["violations"] });
      const nav = performance.getEntriesByType("navigation")[0];
      return {
        lcp: Math.round(window.__qa.lcp),
        cls: Number(window.__qa.cls.toFixed(4)),
        shifts: window.__qa.shifts,
        domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
        load: Math.round(nav.loadEventEnd),
        bytes: performance.getEntriesByType("resource").reduce((sum, r) => sum + (r.transferSize || 0), 0),
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        axe: axeResult.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.length,
          samples: v.nodes.slice(0, 8).map((n) => ({ target: n.target, html: n.html.slice(0, 220), summary: n.failureSummary })),
        })),
        largestResources: performance.getEntriesByType("resource")
          .map((r) => ({ name: r.name, bytes: r.transferSize || 0, duration: Math.round(r.duration) }))
          .sort((a, b) => b.bytes - a.bytes)
          .slice(0, 8),
      };
    });
    const slug = route === "/" ? "home" : route.slice(1).replaceAll("/", "-");
    await page.screenshot({ path: path.join(outDir, `${viewport.name}-${slug}.png`), fullPage: false });
    report.push({ viewport: viewport.name, route, wallMs: Date.now() - started, ...metrics, keyboard, consoleErrors, failed });
    await page.close();
  }
  await context.close();
}

// 登录后检查造课模板资源，不让匿名重定向掩盖 404。
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const failed = [];
page.on("response", (res) => { if (res.status() >= 400) failed.push({ status: res.status(), url: res.url() }); });
await page.goto(`${baseURL}/login`);
await page.getByLabel("用户名 / 手机号 / 邮箱").fill("demo@tide.learning");
await page.getByLabel("密码").fill("demo123");
await page.getByRole("button", { name: "登录" }).click();
await page.waitForURL(/\/(me|desk)/);
await page.goto(`${baseURL}/create`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
report.push({ viewport: "desktop-auth", route: "/create", failed });
await page.screenshot({ path: path.join(outDir, "desktop-auth-create.png"), fullPage: false });

// 登录态真实媒体链：动态找到一个返回私有签名流的章节，确认页面渲染 <video> 且实际请求 video/*。
const mediaProbe = await page.evaluate(async () => {
  const courses = await fetch("/api/courses").then((r) => r.json());
  for (const course of courses?.data?.courses ?? []) {
    const detail = await fetch(`/api/courses/${course.id}`).then((r) => r.json());
    for (const lesson of detail?.data?.lessons ?? []) {
      const aggregate = await fetch(`/api/lessons/${lesson.id}`).then((r) => r.json());
      if (aggregate?.data?.lesson?.videoUrl?.startsWith("/api/stream/")) {
        return { courseId: course.id, lessonId: lesson.id };
      }
    }
  }
  return null;
});
const streamResponses = [];
page.on("response", (res) => {
  if (res.url().includes("/api/stream/")) {
    streamResponses.push({ status: res.status(), contentType: res.headers()["content-type"] ?? "" });
  }
});
if (mediaProbe) {
  await page.goto(`${baseURL}/courses/${mediaProbe.courseId}/learn/${mediaProbe.lessonId}`, { waitUntil: "networkidle" });
  const video = page.locator("video").first();
  const videoElement = await video.isVisible().catch(() => false);
  if (videoElement) {
    await video.evaluate((el) => { el.muted = true; el.load(); });
    await page.waitForTimeout(800);
  }
  report.push({
    viewport: "desktop-auth",
    route: "/learn/private-media",
    mediaProbe,
    videoElement,
    streamResponses,
  });
} else {
  report.push({ viewport: "desktop-auth", route: "/learn/private-media", mediaProbe: null, videoElement: false, streamResponses });
}

// 错误态与键盘提交：不填写凭据直接提交，错误信息必须可见且页面不能产生 5xx/控制台错误。
const errorContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
const errorPage = await errorContext.newPage();
const errorConsole = [];
const errorFailed = [];
errorPage.on("console", (msg) => { if (msg.type() === "error") errorConsole.push(msg.text()); });
errorPage.on("response", (res) => { if (res.status() >= 500) errorFailed.push({ status: res.status(), url: res.url() }); });
await errorPage.goto(`${baseURL}/login`, { waitUntil: "networkidle" });
await errorPage.getByRole("button", { name: "登录" }).focus();
await errorPage.keyboard.press("Enter");
await errorPage.waitForTimeout(300);
const errorText = await errorPage.locator("text=请输入账号和密码").isVisible().catch(() => false);
const nativeInvalid = await errorPage.getByLabel("用户名 / 手机号 / 邮箱").evaluate((el) => !el.checkValidity());
report.push({
  viewport: "mobile-keyboard",
  route: "/login-invalid",
  keyboardSubmit: true,
  visibleError: errorText || nativeInvalid,
  errorMode: errorText ? "application" : nativeInvalid ? "native-validation" : "missing",
  consoleErrors: errorConsole,
  failed: errorFailed,
});
await errorContext.close();

await browser.close();
await writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
const failures = report.filter((row) =>
  (Array.isArray(row.axe) && row.axe.length > 0) ||
  (Array.isArray(row.consoleErrors) && row.consoleErrors.length > 0) ||
  (Array.isArray(row.failed) && row.failed.length > 0) ||
  (typeof row.overflowX === "number" && row.overflowX > 0) ||
  (row.keyboard && !row.keyboard.focused) ||
  (row.route === "/login-invalid" && !row.visibleError) ||
  (row.route === "/learn/private-media" && (
    !row.videoElement || row.streamResponses.length === 0 ||
    row.streamResponses.some((res) => ![200, 206].includes(res.status) || !res.contentType.startsWith("video/"))
  ))
);
console.log(JSON.stringify(report, null, 2));
if (failures.length) {
  console.error(`Browser audit failed: ${failures.map((f) => `${f.viewport}:${f.route}`).join(", ")}`);
  process.exitCode = 1;
}
