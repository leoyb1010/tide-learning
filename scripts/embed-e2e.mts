/**
 * 嵌入层 E2E(v4.2·防 P0 回归网)—— 在**真实 App 页面**里验证课件三链路,而非独立渲染课件。
 *
 * 背景:2026-07-19 发现的 P0(middleware CSP 拦掉 srcdoc 内联脚本→全站课件瘫痪)在快照/单测/
 * 契约冒烟全绿的情况下潜伏了 6 天——因为那些检查都绕过了「课件嵌在 App 里」这一层。
 * 本脚本断言恰好落在该层:
 *  1) 匿名 preview 页:宿主收到 ct-ready(「翻页」切换出现 = 握手成立 = 课件脚本在跑);
 *  2) iframe 内首屏有可见文字(CSP/nonce 断裂时只剩装饰、文字全 opacity:0);
 *  3) 登录 learn 页:iframe 内点「下一页」→ 宿主发出 POST /api/progress(D1 进度闭环通电)。
 *
 * 运行:需生产(或 dev)服在 E2E_BASE(默认 http://localhost:3100)。
 *   DATABASE_URL=file:$PWD/prisma/dev.db npx tsx scripts/embed-e2e.mts
 * 退出码非 0 = 有断言失败。只读浏览,唯一写入是 demo 账号一次翻页进度(与真实使用等价)。
 */
import { chromium } from "playwright";
import { prisma } from "../src/lib/db";

const BASE = process.env.E2E_BASE || "http://localhost:3100";
const DEMO = { identifier: "demo@tide.learning", password: "demo123" };

async function main() {
  // 与 preview 页同口径取一门可预览课
  const course = await prisma.course.findFirst({
    where: {
      status: "published",
      visibility: { in: ["public", "unlisted"] },
      lessons: { some: { isFree: true, status: "published", htmlJson: { not: null } } },
    },
    select: {
      slug: true,
      lessons: {
        where: { isFree: true, status: "published", htmlJson: { not: null } },
        orderBy: { sortOrder: "asc" },
        take: 1,
        select: { id: true },
      },
    },
  });
  if (!course?.lessons[0]) {
    console.error("FAIL 前置:库内无可预览课(free+published+htmlJson)");
    process.exit(2);
  }
  const lessonId = course.lessons[0].id;

  const browser = await chromium.launch();
  const failures: string[] = [];
  try {
    // —— 1&2:匿名 preview 页 ——
    const page = await browser.newPage();
    await page.goto(`${BASE}/courses/${course.slug}/preview`, { waitUntil: "domcontentloaded" });
    const modeToggle = page.getByRole("tab", { name: "翻页" });
    await modeToggle.waitFor({ state: "visible", timeout: 15_000 }).catch(() => failures.push("preview:未收到 ct-ready(「翻页」切换未出现)——课件脚本疑似被拦"));

    const frame = page.frameLocator('iframe[title="AI 课件"]');
    const firstText = await frame
      .locator("h1, .lead, .q, .body")
      .first()
      .innerText({ timeout: 10_000 })
      .catch(() => "");
    if (!firstText.trim()) failures.push("preview:iframe 首屏无可见文字(reveal 未执行/CSP 断裂)");

    // —— 3:登录 learn 页,翻页必须打出 /api/progress ——
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(DEMO),
    }).then((r) => r.json() as Promise<{ data?: { sessionToken?: string } }>);
    const token = login?.data?.sessionToken;
    if (!token) {
      failures.push("learn:demo 登录失败,跳过进度断言");
    } else {
      // 清 demo 在本节的历史进度:否则 ct-goto 续读会恢复到末页(下一页禁用),翻页断言失真。
      const demo = await prisma.user.findFirst({ where: { email: "demo@tide.learning" }, select: { id: true } });
      if (demo) await prisma.learningProgress.deleteMany({ where: { userId: demo.id, lessonId } });
      const ctx = await browser.newContext();
      await ctx.addCookies([{ name: "tide_session", value: token, url: BASE }]);
      const lp = await ctx.newPage();
      await lp.goto(`${BASE}/courses/${course.slug}/learn/${lessonId}`, { waitUntil: "domcontentloaded" });
      await lp
        .getByRole("tab", { name: "翻页" })
        .waitFor({ state: "visible", timeout: 15_000 })
        .catch(() => failures.push("learn:未收到 ct-ready"));
      const lframe = lp.frameLocator('iframe[title="AI 课件"]');
      const progressReq = lp
        .waitForRequest((r) => r.url().includes("/api/progress") && r.method() === "POST", { timeout: 10_000 })
        .catch(() => null);
      await lframe.locator(".ct-pager button", { hasText: "下一页" }).click({ timeout: 10_000 }).catch(() => {
        failures.push("learn:iframe 内「下一页」不可点");
      });
      if (!(await progressReq)) failures.push("learn:翻页后未发出 POST /api/progress(D1 断流)");

      // —— 4:软导航进入(2026-07-20 空白根因的用户真实路径,必测!)——
      // 此前全部断言都是 URL 直达(整页加载),软导航下的 CSP/nonce 错配类空白全绿漏网:
      // 用户点着链接进课件页(Next 软导航)才是真实路径。从课程详情页点 learn 链接进入,
      // 断言 iframe 内首屏文字真实可见(computed opacity ≠ 0),而不只是 innerText 非空。
      const sp = await ctx.newPage();
      await sp.goto(`${BASE}/courses/${course.slug}`, { waitUntil: "domcontentloaded" });
      await sp.waitForTimeout(1500);
      // 找第一个「可见」的 learn 链接(首个可能藏在折叠/浮层里点不了)
      let softOk = false;
      const learnLinks = sp.locator(`a[href*="/learn/"]`);
      const linkCount = await learnLinks.count();
      for (let i = 0; i < linkCount && !softOk; i++) {
        const l = learnLinks.nth(i);
        if (!(await l.isVisible().catch(() => false))) continue;
        softOk = await l
          .scrollIntoViewIfNeeded()
          .then(() => l.click())
          .then(() => sp.waitForURL(/\/learn\//, { timeout: 15_000 }))
          .then(() => true)
          .catch(() => false);
      }
      if (!softOk) {
        failures.push("softnav:详情页无可点 learn 链接或跳转失败");
      } else {
        await sp.waitForTimeout(3500);
        const sframe = sp.frames().find((f) => f !== sp.mainFrame());
        if (!sframe) {
          failures.push("softnav:learn 页无课件 iframe");
        } else {
          const visible = await sframe
            .evaluate(() => {
              const els = [...document.querySelectorAll("h1, .lead, .q, .body, [data-reveal]")];
              // 至少一个内容元素:有文字且 computed opacity 不为 0(揭示已执行或底线生效)
              return els.some((e) => {
                const t = (e as HTMLElement).innerText?.trim();
                return !!t && getComputedStyle(e).opacity !== "0";
              });
            })
            .catch(() => false);
          if (!visible) failures.push("softnav:软导航进入后 iframe 无可见文字(CSP/nonce 错配类空白回归!)");
        }
      }
      await sp.close();
      await ctx.close();
    }
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }

  if (failures.length) {
    console.error(`嵌入层 E2E:${failures.length} 项失败`);
    for (const f of failures) console.error("  ✗ " + f);
    process.exit(1);
  }
  console.log("嵌入层 E2E:4/4 通过(ct-ready 握手 / iframe 首屏文字 / 翻页进度上报 / 软导航进入可见)");
}

main();
