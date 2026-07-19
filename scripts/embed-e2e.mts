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
  console.log("嵌入层 E2E:3/3 通过(ct-ready 握手 / iframe 首屏文字 / 翻页进度上报)");
}

main();
