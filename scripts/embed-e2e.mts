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
 * 脚本会为 demo 用户建立一门临时双协议课程（翻页 + bespoke 长滚动），结束后级联删除，
 * 避免依赖某次 seed 是否恰好带 htmlJson，也不改任何真实课程。
 * 运行:需生产(或 dev)服在 E2E_BASE(默认 http://localhost:3100)。
 *   DATABASE_URL=file:$PWD/prisma/dev.db npx tsx scripts/embed-e2e.mts
 * 退出码非 0 = 有断言失败。只读浏览,唯一写入是 demo 账号一次翻页进度(与真实使用等价)。
 */
import { chromium } from "playwright";
import { prisma } from "../src/lib/db";
import { resolveCourseDesign } from "../src/lib/ai/courseware-design";
import { resolveLessonVariance } from "../src/lib/ai/courseware-variance";
import { buildContract, enforceTrustedCsp, injectBespokeAdapter, renderCoursewareHtml } from "../src/lib/ai/courseware-html";
import { validateBlocks } from "../src/lib/blocks";

const BASE = process.env.E2E_BASE || "http://localhost:3100";
const DEMO = { identifier: "demo@tide.learning", password: "demo123" };

const blocks = validateBlocks([
  { type: "scene", title: "一杯咖啡的成本", markdown: "把抽象的成本拆成可以观察的组成。" },
  { type: "concept", title: "固定与变动", markdown: "房租不随杯数变化，咖啡豆会随销量变化。" },
  { type: "example", markdown: "每天卖 100 杯时，把房租摊到每一杯。" },
  { type: "quiz", question: "哪项更接近变动成本？", options: ["房租", "咖啡豆"], answerIndex: 1, explain: "每多卖一杯都需要更多咖啡豆。" },
  { type: "summary", markdown: "先按是否随产量变化分类，再计算单位成本。" },
]);

function bespokeFixture(): string {
  const sections = Array.from({ length: 10 }, (_, index) =>
    `<section style="min-height:240px;padding:32px 7vw;border-bottom:1px solid #d8ccb9"><h2>观察 ${index + 1}</h2><p>这是一段需要真实向下阅读的原创长滚动课件内容。</p></section>`,
  ).join("");
  return injectBespokeAdapter(enforceTrustedCsp(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#f7f0e5;color:#2f281f;font:18px/1.7 system-ui}h1,h2{font-family:Georgia,serif}.hero{padding:56px 7vw 36px}</style></head><body><header class="hero"><h1 class="bespoke-title">长滚动协议验收</h1><p>只有真正抵达文末，宿主才能判定完成。</p></header>${sections}</body></html>`));
}

async function main() {
  const demo = await prisma.user.findFirst({ where: { email: "demo@tide.learning" }, select: { id: true } });
  if (!demo) {
    console.error("FAIL 前置:库内无 demo@tide.learning，请先 npm run db:seed");
    process.exit(2);
  }
  // 上次若在浏览器启动前被中断，清掉同名测试夹具；范围受标题 + slug 双重约束。
  await prisma.course.deleteMany({ where: { title: "课件双协议 E2E 临时课程", slug: { startsWith: "e2e-courseware-" } } });
  const slug = `e2e-courseware-${process.pid}-${Date.now()}`;
  const design = resolveCourseDesign({ id: slug, category: "ai_skill", template: null, designJson: null });
  const variance = resolveLessonVariance(slug, { id: "paged", title: "翻页协议验收", sortOrder: 0 }, design);
  const pagedHtml = renderCoursewareHtml({ title: "翻页协议验收", blocks, design, variance });
  const fixture = await prisma.course.create({
    data: {
      slug,
      title: "课件双协议 E2E 临时课程",
      category: "ai_skill",
      level: "L1",
      status: "published",
      visibility: "unlisted",
      origin: "ai_generated",
      ownerId: demo.id,
      authorUserId: demo.id,
      genStatus: "ready",
      publishedAt: new Date(),
      lessons: {
        create: [
          { title: "翻页协议验收", sortOrder: 0, contentType: "ai_block", isFree: true, status: "published", blocksJson: JSON.stringify({ version: 1, blocks }), htmlJson: JSON.stringify(buildContract(pagedHtml)), renderEngine: "deterministic", publishedAt: new Date() },
          { title: "长滚动协议验收", sortOrder: 1, contentType: "ai_block", isFree: true, status: "published", blocksJson: JSON.stringify({ version: 1, blocks }), htmlJson: JSON.stringify(buildContract(bespokeFixture())), renderEngine: "llm", publishedAt: new Date() },
        ],
      },
    },
    select: { slug: true, lessons: { orderBy: { sortOrder: "asc" }, select: { id: true } } },
  });
  const lessonId = fixture.lessons[0].id;
  const scrollLessonId = fixture.lessons[1].id;

  const failures: string[] = [];
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch();
    // —— 1&2:匿名 preview 页 ——
    const page = await browser.newPage();
    await page.goto(`${BASE}/courses/${fixture.slug}/preview`, { waitUntil: "domcontentloaded" });
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
      await prisma.learningProgress.deleteMany({ where: { userId: demo.id, lessonId } });
      const ctx = await browser.newContext();
      await ctx.addCookies([{ name: "tide_session", value: token, url: BASE }]);
      const lp = await ctx.newPage();
      await lp.goto(`${BASE}/courses/${fixture.slug}/learn/${lessonId}`, { waitUntil: "domcontentloaded" });
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
      await sp.goto(`${BASE}/courses/${fixture.slug}`, { waitUntil: "domcontentloaded" });
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

      // —— 5:bespoke 长滚动协议——不显示翻页控件；宿主尾部哨兵仅在真正抵达文末后完成一次。
      await prisma.learningProgress.deleteMany({ where: { userId: demo.id, lessonId: scrollLessonId } });
      const bp = await ctx.newPage();
      const completedRequests: string[] = [];
      bp.on("request", (request) => {
        if (!request.url().includes("/api/progress") || request.method() !== "POST") return;
        try {
          const data = JSON.parse(request.postData() || "{}") as { lessonId?: string; completed?: boolean };
          if (data.lessonId === scrollLessonId && data.completed === true) completedRequests.push(request.postData() || "");
        } catch {
          /* 非 JSON 请求由接口自行拒绝，与本断言无关 */
        }
      });
      await bp.goto(`${BASE}/courses/${fixture.slug}/learn/${scrollLessonId}`, { waitUntil: "domcontentloaded" });
      const bframe = bp.frameLocator('iframe[title="AI 课件"]');
      await bframe.locator(".bespoke-title").waitFor({ state: "visible", timeout: 15_000 }).catch(() => failures.push("bespoke:iframe 正文不可见"));
      await bp.waitForTimeout(1400);
      if (await bp.getByRole("tab", { name: "翻页" }).isVisible().catch(() => false)) failures.push("bespoke:长滚动课件错误冒充 ct-ready 翻页能力");
      if (completedRequests.length !== 0) failures.push("bespoke:未抵达文末就提前上报完成");
      const completed = bp.waitForRequest((request) => {
        if (!request.url().includes("/api/progress") || request.method() !== "POST") return false;
        try {
          const data = JSON.parse(request.postData() || "{}") as { lessonId?: string; completed?: boolean; kind?: string };
          return data.lessonId === scrollLessonId && data.completed === true && data.kind === "slide";
        } catch {
          return false;
        }
      }, { timeout: 12_000 }).catch(() => null);
      await bp.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "auto" }));
      if (!(await completed)) failures.push("bespoke:抵达宿主尾部后未上报 completed:true/kind:slide");
      await bp.evaluate(() => { window.scrollTo(0, 0); window.scrollTo(0, document.documentElement.scrollHeight); });
      await bp.waitForTimeout(1600);
      if (completedRequests.length !== 1) failures.push(`bespoke:重复握手/滚动导致完成上报 ${completedRequests.length} 次（应为 1）`);
      await bp.close();
      await ctx.close();
    }
  } finally {
    await browser?.close();
    await prisma.course.delete({ where: { slug } }).catch(() => {});
    await prisma.$disconnect();
  }

  if (failures.length) {
    console.error(`嵌入层 E2E:${failures.length} 项失败`);
    for (const f of failures) console.error("  ✗ " + f);
    process.exit(1);
  }
  console.log("嵌入层 E2E:5/5 通过(ct-ready / 可见文字 / 翻页进度 / 软导航 / bespoke 尾部幂等完课)");
}

main();
