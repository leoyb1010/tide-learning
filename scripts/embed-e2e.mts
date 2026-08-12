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
 * 脚本会为 demo 用户建立一门临时多协议课程（翻页 / contract-2 滚动 / bespoke / 单页 / 历史恶意 HTML），
 * 结束后精确清理夹具课程、进度、测验、复习卡与形成性埋点，不改任何真实课程。
 * 运行:需生产(或 dev)服在 E2E_BASE(默认 http://localhost:3100)。
 *   DATABASE_URL=file:$PWD/prisma/dev.db npx tsx scripts/embed-e2e.mts
 * 退出码非 0 = 有断言失败。所有写入都限于随机 slug 夹具及本次运行窗口，finally 必定回收。
 */
import { chromium } from "playwright";
import { prisma } from "../src/lib/db";
import { resolveCourseDesign, serializeCourseDesign } from "../src/lib/ai/courseware-design";
import { resolveLessonVariance } from "../src/lib/ai/courseware-variance";
import { buildContract, enforceTrustedCsp, injectBespokeAdapter, renderCoursewareHtml } from "../src/lib/ai/courseware-html";
import { resolveCoursewareMode } from "../src/lib/ai/courseware-catalog";
import { renderSourceHash } from "../src/lib/ai/courseware-gen";
import { validateBlocks } from "../src/lib/blocks";

const BASE = process.env.E2E_BASE || "http://localhost:3100";
const DEMO = { identifier: "demo@tide.learning", password: "demo123" };

const blocks = validateBlocks([
  { type: "scene", title: "一杯咖啡的成本", markdown: "把抽象的成本拆成可以观察的组成。" },
  { type: "concept", title: "固定与变动", markdown: "房租不随杯数变化，咖啡豆会随销量变化。" },
  { type: "fillblank", prompt: "补全成本分类", segments: ["房租更接近", "成本。"], blanks: [["固定"]] },
  { type: "dragwords", prompt: "组成成本分析顺序", segments: ["先", "，再", "。"], blanks: ["分类", "计算"], distractors: ["装饰"] },
  {
    type: "hotspot",
    imageSrc: "/lesson-stills/lesson-still-ai.jpg",
    prompt: "点出正确的成本记录区",
    spots: [
      { x: 30, y: 48, label: "成本记录区", feedback: "这里记录原料消耗。", correct: true },
      { x: 72, y: 48, label: "装饰区", feedback: "这里不是成本记录区。" },
    ],
  },
  {
    type: "hotspot",
    imageSrc: "/lesson-stills/lesson-still-ai.jpg",
    prompt: "自由探索咖啡台",
    spots: [
      { x: 28, y: 50, label: "磨豆区", feedback: "这里负责研磨。" },
      { x: 70, y: 50, label: "出杯区", feedback: "这里完成出杯。" },
    ],
  },
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

/** 模拟历史上在入库时未净化的 LLM HTML：读路径必须移除其自发平台协议。 */
function historicalHostileFixture(): string {
  const sections = Array.from({ length: 9 }, (_, index) =>
    `<section style="min-height:260px;padding:32px"><h2>历史页 ${index + 1}</h2><p>这是存量 LLM 课件的静态内容。</p></section>`,
  ).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>body{margin:0;font:18px/1.7 system-ui}@media(prefers-reduced-motion:reduce){*{animation:none!important}}</style>
    <script>window.__historicalEvil=true;parent.postMessage({type:'ct-page',index:0,total:1},'*');parent.postMessage({type:'ct-complete',index:0,total:1,contract:2},'*')</script>
    </head><body onload="parent.postMessage({type:'ct-quiz',bid:'blk_0',answer:0},'*')"><h1 class="historical-title">历史 LLM 安全回归</h1>${sections}</body></html>`;
}

async function main() {
  const runStartedAt = new Date();
  const demo = await prisma.user.findFirst({ where: { email: "demo@tide.learning" }, select: { id: true } });
  if (!demo) {
    console.error("FAIL 前置:库内无 demo@tide.learning，请先 npm run db:seed");
    process.exit(2);
  }
  // 上次若在浏览器启动前被中断，清掉同名测试夹具；范围受标题 + slug 双重约束。
  const stale = await prisma.course.findMany({
    where: { title: "课件双协议 E2E 临时课程", slug: { startsWith: "e2e-courseware-" } },
    select: { id: true },
  });
  if (stale.length > 0) {
    await prisma.reviewCard.deleteMany({ where: { userId: demo.id, courseId: { in: stale.map((course) => course.id) } } });
    await prisma.course.deleteMany({ where: { id: { in: stale.map((course) => course.id) } } });
  }
  const slug = `e2e-courseware-${process.pid}-${Date.now()}`;
  const courseTitle = "课件双协议 E2E 临时课程";
  const design = resolveCourseDesign({ id: slug, category: "ai_skill", template: null, designJson: null });
  const designJson = serializeCourseDesign(design);
  const mode = resolveCoursewareMode({ title: courseTitle, artKey: design.art.key, layout: design.art.layout });
  const pagedBlocksJson = JSON.stringify({ version: 1, blocks });
  const variance = resolveLessonVariance(slug, { id: "paged", title: "翻页协议验收", sortOrder: 0 }, design);
  const pagedHtml = renderCoursewareHtml({ title: "翻页协议验收", blocks, design, variance, mode });
  const singleBlocks = validateBlocks([
    { type: "steps", steps: [{ title: "第一步" }, { title: "第二步" }, { title: "第三步" }, { title: "第四步" }] },
  ]);
  const singleBlocksJson = JSON.stringify({ version: 1, blocks: singleBlocks });
  const singleVariance = resolveLessonVariance(slug, { id: "single", title: "单页分步完课验收", sortOrder: 2 }, design);
  const singleHtml = renderCoursewareHtml({ title: "单页分步完课验收", blocks: singleBlocks, design, variance: singleVariance, mode });
  const longBlocks = validateBlocks(Array.from({ length: 14 }, (_, index) => ({
    type: "concept",
    title: `减少动效长文 ${index + 1}`,
    markdown: "这一块需要学员真实滚动到文末，不能因为系统选择了减少动效就直接完课。".repeat(3),
  })));
  const fixture = await prisma.course.create({
    data: {
      slug,
      title: courseTitle,
      category: "ai_skill",
      level: "L1",
      status: "published",
      visibility: "unlisted",
      origin: "ai_generated",
      ownerId: demo.id,
      authorUserId: demo.id,
      designJson,
      genStatus: "ready",
      publishedAt: new Date(),
      lessons: {
        create: [
          { title: "翻页协议验收", sortOrder: 0, contentType: "ai_block", isFree: true, status: "published", blocksJson: pagedBlocksJson, htmlJson: JSON.stringify(buildContract(pagedHtml)), renderSourceHash: renderSourceHash({ blocksJson: pagedBlocksJson, title: "翻页协议验收", sortOrder: 0, design, mode }), renderEngine: "deterministic", publishedAt: new Date() },
          { title: "长滚动协议验收", sortOrder: 1, contentType: "ai_block", isFree: true, status: "published", blocksJson: pagedBlocksJson, htmlJson: JSON.stringify(buildContract(bespokeFixture())), renderSourceHash: renderSourceHash({ blocksJson: pagedBlocksJson, title: "长滚动协议验收", sortOrder: 1, design, mode }), renderEngine: "llm", publishedAt: new Date() },
          { title: "单页分步完课验收", sortOrder: 2, contentType: "ai_block", isFree: true, status: "published", blocksJson: singleBlocksJson, htmlJson: JSON.stringify(buildContract(singleHtml)), renderSourceHash: renderSourceHash({ blocksJson: singleBlocksJson, title: "单页分步完课验收", sortOrder: 2, design, mode }), renderEngine: "deterministic", publishedAt: new Date() },
          { title: "历史 LLM 安全回归", sortOrder: 3, contentType: "ai_block", isFree: true, status: "published", blocksJson: pagedBlocksJson, htmlJson: JSON.stringify(buildContract(historicalHostileFixture())), renderSourceHash: renderSourceHash({ blocksJson: pagedBlocksJson, title: "历史 LLM 安全回归", sortOrder: 3, design, mode }), renderEngine: "llm", publishedAt: new Date() },
          { title: "减少动效长文验收", sortOrder: 4, contentType: "ai_block", isFree: true, status: "published", blocksJson: JSON.stringify({ version: 1, blocks: longBlocks }), htmlJson: null, renderEngine: null, publishedAt: new Date() },
        ],
      },
    },
    select: { id: true, slug: true, lessons: { orderBy: { sortOrder: "asc" }, select: { id: true } } },
  });
  const lessonId = fixture.lessons[0].id;
  const scrollLessonId = fixture.lessons[1].id;
  const singleLessonId = fixture.lessons[2].id;
  const hostileLessonId = fixture.lessons[3].id;
  const reducedLessonId = fixture.lessons[4].id;

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
      const progressRes = lp
        .waitForResponse((r) => r.url().includes("/api/progress") && r.request().method() === "POST", { timeout: 10_000 })
        .catch(() => null);
      await lframe.locator(".ct-pager button", { hasText: "下一页" }).click({ timeout: 10_000 }).catch(() => {
        failures.push("learn:iframe 内「下一页」不可点");
      });
      const pageAdvanceResponse = await progressRes;
      if (!pageAdvanceResponse?.ok()) {
        failures.push("learn:翻页后 POST /api/progress 未成功响应");
      } else {
        const saved = await prisma.learningProgress.findUnique({ where: { userId_lessonId: { userId: demo.id, lessonId } } });
        if (!saved || saved.lastSlideIndex !== 2 || saved.completedAt) failures.push("learn:翻至第 2 页的 DB 语义错误（应 lastSlideIndex=2 且未完课）");
      }

      // 协议异常数值必须 400 且不改 DB；完成上报的较小页序必须保留历史最大值。
      const badProgressBodies = [
        { lessonId, progressSec: -4, completed: false, kind: "slide" },
        { lessonId, progressSec: 2.5, completed: false, kind: "slide" },
        { lessonId, progressSec: 2, completed: false, kind: "bogus" },
      ];
      for (const badBody of badProgressBodies) {
        const rejected = await lp.evaluate(async (body) => {
          const res = await fetch("/api/progress", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
          return { status: res.status, body: await res.json() };
        }, badBody);
        const unchanged = await prisma.learningProgress.findUnique({ where: { userId_lessonId: { userId: demo.id, lessonId } } });
        if (rejected.status !== 400 || rejected.body?.ok !== false || unchanged?.lastSlideIndex !== 2) failures.push("progress:异常数值/类型未被严格拒绝或污染 DB");
      }
      await lp.evaluate(async (lessonId) => {
        await fetch("/api/progress", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lessonId, progressSec: 16, completed: false, kind: "slide" }) });
      }, lessonId);
      const monotonicResult = await lp.evaluate(async (lessonId) => {
        const res = await fetch("/api/progress", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lessonId, progressSec: 1, completed: true, kind: "slide" }) });
        return { status: res.status, body: await res.json() };
      }, lessonId);
      const monotonicSaved = await prisma.learningProgress.findUnique({ where: { userId_lessonId: { userId: demo.id, lessonId } } });
      if (monotonicResult.status !== 200 || monotonicResult.body?.data?.progressSec !== 16 || monotonicSaved?.lastSlideIndex !== 16 || !monotonicSaved.completedAt) failures.push("progress:完成请求将 lastSlideIndex 16 回退或 response/DB 不一致");

      // —— 测验真值：客户端伪造 correct 不生效，服务端依 blocks.answerIndex 重算；非 quiz 块拒绝。
      const quizBlock = blocks.find((block) => block.type === "quiz");
      const nonQuizBlock = blocks.find((block) => block.type !== "quiz");
      const localPracticeBlocks = blocks.filter((block) => block.type === "fillblank" || block.type === "dragwords" || block.type === "hotspot");
      if (!quizBlock || quizBlock.type !== "quiz" || !nonQuizBlock || localPracticeBlocks.length !== 4) {
        failures.push("quiz:夹具缺测验/非测验块");
      } else {
        await prisma.lessonQuizResult.deleteMany({ where: { userId: demo.id, lessonId } });
        const wrongResult = await lp.evaluate(async ({ lessonId, blockId }) => {
          const res = await fetch(`/api/lessons/${lessonId}/quiz-result`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ blockId, answerIndex: 0, correct: true }),
          });
          return { status: res.status, body: await res.json() };
        }, { lessonId, blockId: quizBlock.id });
        const wrongSaved = await prisma.lessonQuizResult.findUnique({
          where: { userId_lessonId_blockId: { userId: demo.id, lessonId, blockId: quizBlock.id } },
        });
        if (wrongResult.status !== 200 || wrongResult.body?.data?.correct !== false || wrongSaved?.correct !== false) failures.push("quiz:伪造 correct=true 未被服务端重算为 false");

        const rightResult = await lp.evaluate(async ({ lessonId, blockId, answerIndex }) => {
          const res = await fetch(`/api/lessons/${lessonId}/quiz-result`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ blockId, answerIndex, correct: false }),
          });
          return { status: res.status, body: await res.json() };
        }, { lessonId, blockId: quizBlock.id, answerIndex: quizBlock.answerIndex });
        const rightSaved = await prisma.lessonQuizResult.findUnique({
          where: { userId_lessonId_blockId: { userId: demo.id, lessonId, blockId: quizBlock.id } },
        });
        if (rightResult.status !== 200 || rightResult.body?.data?.correct !== true || rightSaved?.correct !== true) failures.push("quiz:伪造 correct=false 未被服务端重算为 true");

        // 尤其锁死 fillblank/dragwords/hotspot：它们可有 iframe 内即时反馈，
        // 但没有 quiz.answerIndex 的服务端真值，绝不得借口“correct”写入掌握度。
        for (const block of [nonQuizBlock, ...localPracticeBlocks]) {
          const nonQuizResult = await lp.evaluate(async ({ lessonId, blockId }) => {
            const res = await fetch(`/api/lessons/${lessonId}/quiz-result`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ blockId, answerIndex: 0 }),
            });
            return { status: res.status, body: await res.json() };
          }, { lessonId, blockId: block.id });
          const nonQuizSaved = await prisma.lessonQuizResult.count({ where: { userId: demo.id, lessonId, blockId: block.id } });
          if (nonQuizResult.status !== 400 || nonQuizResult.body?.ok !== false || nonQuizSaved !== 0) {
            failures.push(`quiz:${block.type} 非 quiz 块未被 fail closed 或污染 DB`);
          }
        }
      }

      // —— 移动续读握手：恢复第 2 页不重复写 DB，恢复完后用户第一次点击必须真正到第 3 页。
      await prisma.learningProgress.update({
        where: { userId_lessonId: { userId: demo.id, lessonId } },
        data: { lastSlideIndex: 2, completedAt: null },
      });
      const mobile = await ctx.newPage();
      await mobile.setViewportSize({ width: 390, height: 844 });
      await mobile.goto(`${BASE}/courses/${fixture.slug}/learn/${lessonId}`, { waitUntil: "domcontentloaded" });
      const mobileFrame = mobile.frameLocator('iframe[title="AI 课件"]');
      await mobileFrame.locator(".ct-count").filter({ hasText: "2 /" }).waitFor({ state: "visible", timeout: 15_000 }).catch(() => failures.push("resume:移动端未恢复到第 2 页"));
      const afterHandshake = await prisma.learningProgress.findUnique({ where: { userId_lessonId: { userId: demo.id, lessonId } } });
      if (afterHandshake?.lastSlideIndex !== 2) failures.push("resume:续读握手将已持久化页序重写/回退");
      const firstTapResponse = mobile.waitForResponse((r) => {
        if (!r.url().includes("/api/progress") || r.request().method() !== "POST") return false;
        try {
          const data = JSON.parse(r.request().postData() || "{}") as { lessonId?: string; progressSec?: number; completed?: boolean };
          return data.lessonId === lessonId && data.progressSec === 3 && data.completed === false;
        } catch {
          return false;
        }
      // 失败必须在“下一节”3 秒自动跳转前收敛，否则 iframe 被卸载会掩盖真正的首击语义。
      }, { timeout: 2_500 }).catch(() => null);
      await mobileFrame.locator(".ct-pager button").last().click({ timeout: 10_000 }).catch(() => failures.push("resume:移动端续读后首击不可用"));
      const firstTap = await firstTapResponse;
      const afterFirstTap = await prisma.learningProgress.findUnique({ where: { userId_lessonId: { userId: demo.id, lessonId } } });
      const mobileCount = await mobileFrame.locator(".ct-count").textContent().catch(() => "");
      if (!firstTap?.ok() || afterFirstTap?.lastSlideIndex !== 3 || !mobileCount?.includes("3 /")) failures.push("resume:续读竞态吞掉移动端首击（response/DB/UI 未同步到第 3 页）");

      // 来自正确 contentWindow 的异常协议帧也必须被宿主拒绝：NaN/负数/总页不匹配/伪完成均不改 UI/DB。
      let invalidProtocolRequests = 0;
      const countInvalidRequest = (request: import("playwright").Request) => {
        if (!request.url().includes("/api/progress") || request.method() !== "POST") return;
        try {
          const data = JSON.parse(request.postData() || "{}") as { lessonId?: string };
          if (data.lessonId === lessonId) invalidProtocolRequests++;
        } catch {
          /* 非 JSON 不是此协议的上报 */
        }
      };
      mobile.on("request", countInvalidRequest);
      const protocolFrame = mobileFrame.locator("html");
      const protocolReady = await protocolFrame.count().catch(() => 0);
      if (protocolReady !== 1) {
        failures.push(`protocol:移动续读后 iframe 意外卸载(url=${mobile.url()},count=${mobileCount || "unknown"},response=${firstTap?.status() ?? "none"})`);
      } else await protocolFrame.evaluate(() => {
        parent.postMessage({ type: "ct-page", index: Number.NaN, total: 5 }, "*");
        parent.postMessage({ type: "ct-page", index: -1, total: 5 }, "*");
        parent.postMessage({ type: "ct-page", index: 3, total: 999 }, "*");
        parent.postMessage({ type: "ct-complete", index: 0, total: 1, contract: 2 }, "*");
        parent.postMessage({ type: "ct-height", height: Number.NaN }, "*");
      });
      await mobile.waitForTimeout(500);
      mobile.off("request", countInvalidRequest);
      const afterProtocolFuzz = await prisma.learningProgress.findUnique({ where: { userId_lessonId: { userId: demo.id, lessonId } } });
      const countAfterFuzz = await mobileFrame.locator(".ct-count").textContent().catch(() => "");
      if (invalidProtocolRequests !== 0 || afterProtocolFuzz?.lastSlideIndex !== 3 || afterProtocolFuzz.completedAt || !countAfterFuzz?.includes("3 /")) failures.push("protocol:同 iframe 异常 postMessage 污染了请求/UI/DB");
      await mobile.close();

      // —— 4:contract-2 翻页→滚动真值 —— 仅切换不完课；宿主量化进度；抵达底部才幂等完课。
      await prisma.learningProgress.deleteMany({ where: { userId: demo.id, lessonId } });
      const localPracticeIds = blocks
        .filter((block) => block.type === "fillblank" || block.type === "dragwords" || block.type === "hotspot")
        .map((block) => block.id);
      await prisma.lessonQuizResult.deleteMany({ where: { userId: demo.id, lessonId, blockId: { in: localPracticeIds } } });
      const deterministic = await ctx.newPage();
      const deterministicCompleted: string[] = [];
      const localQuizRequests: string[] = [];
      const localPracticeRequests: string[] = [];
      const localPracticeResponses = new Map<string, { status: number; tracked: boolean }>();
      // Beacon 的响应对页面 JS 不可见，Chromium 也不保证向 Playwright 发 response 事件。
      // 在测试路由中用 route.fetch() 真实访问 App API，记录响应后原样回填给浏览器。
      await deterministic.route("**/api/analytics", async (route) => {
        const request = route.request();
        let practiceBlockId: string | null = null;
        try {
          const data = JSON.parse(request.postData() || "{}") as { eventName?: string; properties?: { block_id?: string } };
          if (data.eventName === "courseware_local_practice" && data.properties?.block_id) practiceBlockId = data.properties.block_id;
        } catch {
          /* 非 JSON 请求仍交给真实 API */
        }
        const response = await route.fetch();
        if (practiceBlockId) {
          const body = await response.json().catch(() => null) as { ok?: boolean; data?: { tracked?: boolean } } | null;
          localPracticeResponses.set(practiceBlockId, {
            status: response.status(),
            tracked: body?.ok === true && body.data?.tracked === true,
          });
        }
        await route.fulfill({ response });
      });
      deterministic.on("request", (request) => {
        if (request.method() !== "POST") return;
        if (request.url().includes(`/api/lessons/${lessonId}/quiz-result`)) localQuizRequests.push(request.postData() || "");
        if (!request.url().includes("/api/analytics")) return;
        try {
          const data = JSON.parse(request.postData() || "{}") as { eventName?: string; properties?: { block_id?: string } };
          if (data.eventName === "courseware_local_practice" && data.properties?.block_id) {
            localPracticeRequests.push(data.properties.block_id);
          }
        } catch {
          /* 非 JSON 不是本协议事件 */
        }
      });
      deterministic.on("request", (request) => {
        if (!request.url().includes("/api/progress") || request.method() !== "POST") return;
        try {
          const data = JSON.parse(request.postData() || "{}") as { lessonId?: string; completed?: boolean };
          if (data.lessonId === lessonId && data.completed === true) deterministicCompleted.push(request.postData() || "");
        } catch {
          /* 由服务端拒绝非 JSON */
        }
      });
      await deterministic.goto(`${BASE}/courses/${fixture.slug}/learn/${lessonId}`, { waitUntil: "domcontentloaded" });
      await deterministic.getByRole("tab", { name: "滚动" }).click({ timeout: 15_000 }).catch(() => failures.push("contract-2:无法切到滚动视图"));
      await deterministic.waitForFunction(() => {
        const frame = document.querySelector('iframe[title="AI 课件"]') as HTMLIFrameElement | null;
        return Boolean(frame && Number.parseFloat(frame.style.height || "0") > 900);
      }, null, { timeout: 15_000 }).catch(() => failures.push("contract-2:滚动视图未完成 ct-height 布局握手"));
      await deterministic.waitForTimeout(900);
      const afterModeOnly = await prisma.learningProgress.findUnique({ where: { userId_lessonId: { userId: demo.id, lessonId } } });
      if (deterministicCompleted.length !== 0 || afterModeOnly?.completedAt) failures.push("contract-2:仅切到滚动视图就误上报完课");

      const quantizedResponse = deterministic.waitForResponse((response) => {
        if (!response.url().includes("/api/progress") || response.request().method() !== "POST") return false;
        try {
          const data = JSON.parse(response.request().postData() || "{}") as { lessonId?: string; progressSec?: number; completed?: boolean; kind?: string };
          return data.lessonId === lessonId && data.kind === "slide" && data.completed === false && typeof data.progressSec === "number" && data.progressSec > 1;
        } catch {
          return false;
        }
      // 失败必须在 3 秒自动跳转前返回诊断，否则会把“中段误完课”伪装成下一节缺 DOM。
      }, { timeout: 2_500 }).catch(() => null);
      await deterministic.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight * 0.38, behavior: "auto" }));
      const quantized = await quantizedResponse;
      const quantizedSaved = await prisma.learningProgress.findUnique({ where: { userId_lessonId: { userId: demo.id, lessonId } } });
      if (!quantized?.ok() || (quantizedSaved?.lastSlideIndex ?? 0) <= 1 || quantizedSaved?.completedAt) {
        failures.push("contract-2:滚动中段未产生成功响应 + DB 量化进度，或提前完课");
      }
      const stayOnLesson = deterministic.getByRole("button", { name: "留在本节" });
      if (await stayOnLesson.isVisible().catch(() => false)) {
        failures.push("contract-2:滚动中段提前触发下一节倒计时");
        await stayOnLesson.click();
      }

      // fillblank/dragwords/hotspot 只允许形成性 ct-practice 埋点；测验 API 请求数必须始终为 0。
      const fillBlock = blocks.find((block) => block.type === "fillblank");
      const dragBlock = blocks.find((block) => block.type === "dragwords");
      const scoredHotspot = blocks.find((block) => block.type === "hotspot" && block.spots.some((spot) => spot.correct === true));
      const exploratoryHotspot = blocks.find((block) => block.type === "hotspot" && !block.spots.some((spot) => spot.correct === true));
      if (!fillBlock || fillBlock.type !== "fillblank" || !dragBlock || dragBlock.type !== "dragwords" || !scoredHotspot || scoredHotspot.type !== "hotspot" || !exploratoryHotspot || exploratoryHotspot.type !== "hotspot") {
        failures.push("practice:形成性练习夹具不完整");
      } else {
        const dframe = deterministic.frameLocator('iframe[title="AI 课件"]');
        const waitPracticeResponse = async (blockId: string) => {
          const deadline = Date.now() + 10_000;
          while (Date.now() < deadline) {
            const result = localPracticeResponses.get(blockId);
            if (result) return result;
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          return null;
        };

        const availableBids = await dframe.locator("[data-bid]").evaluateAll((nodes) =>
          [...new Set(nodes.map((node) => node.getAttribute("data-bid")).filter(Boolean))],
        ).catch(() => [] as string[]);
        const fillInput = dframe.locator(`[data-bid="${fillBlock.id}"] .fb-in`);
        if (await fillInput.count().catch(() => 0) !== 1) {
          failures.push(`practice:滚动课件缺少形成性 DOM(url=${deterministic.url()},expected=${fillBlock.id},available=${availableBids.join(",") || "none"})`);
        } else {
        const fillResponse = waitPracticeResponse(fillBlock.id);
        await fillInput.fill("固定");
        await dframe.locator(`[data-bid="${fillBlock.id}"] .ia-check`).click();
        const fillResult = await fillResponse;
        if (fillResult?.status !== 200 || !fillResult.tracked) failures.push("practice:fillblank ct-practice 响应未成功");

        const dragResponse = waitPracticeResponse(dragBlock.id);
        await dframe.locator(`[data-bid="${dragBlock.id}"] .dw-word`, { hasText: "分类" }).click();
        await dframe.locator(`[data-bid="${dragBlock.id}"] .dw-word`, { hasText: "计算" }).click();
        await dframe.locator(`[data-bid="${dragBlock.id}"] .ia-check`).click();
        const dragResult = await dragResponse;
        if (dragResult?.status !== 200 || !dragResult.tracked) failures.push("practice:dragwords ct-practice 响应未成功");

        const scoredResponse = waitPracticeResponse(scoredHotspot.id);
        const scoredButton = dframe.locator(`[data-bid="${scoredHotspot.id}"][aria-label="成本记录区"]`);
        await scoredButton.click();
        const scoredResult = await scoredResponse;
        if (scoredResult?.status !== 200 || !scoredResult.tracked || await scoredButton.getAttribute("aria-pressed") !== "true" || !(await scoredButton.getAttribute("class"))?.includes("ct-hotspot-correct")) {
          failures.push("practice:hotspot 正确点的 ct-practice/本地 UI 反馈不一致");
        }

        const beforeExploreEvents = localPracticeRequests.length;
        const exploratoryButton = dframe.locator(`[data-bid="${exploratoryHotspot.id}"][aria-label="磨豆区"]`);
        await exploratoryButton.click();
        await deterministic.waitForTimeout(650);
        const exploratoryFeedback = await exploratoryButton.locator("xpath=ancestor::div[contains(@class,'ct-hotspot-card')]").locator(".ct-route-feedback").textContent().catch(() => "");
        if (localPracticeRequests.length !== beforeExploreEvents || await exploratoryButton.getAttribute("aria-pressed") !== "true" || !exploratoryFeedback?.includes("负责研磨")) {
          failures.push("practice:无正确键 hotspot 未做到“只探索反馈、不发判分”");
        }

        await deterministic.waitForTimeout(350);
        const localQuizRows = await prisma.lessonQuizResult.count({ where: { userId: demo.id, lessonId, blockId: { in: localPracticeIds } } });
        const practiceRows = await prisma.analyticsEvent.findMany({
          where: { userId: demo.id, eventName: "courseware_local_practice", createdAt: { gte: runStartedAt } },
          select: { propertiesJson: true },
        });
        const practiceByBlock = new Map<string, boolean>();
        for (const row of practiceRows) {
          try {
            const data = JSON.parse(row.propertiesJson) as { lesson_id?: string; block_id?: string; locally_correct?: boolean };
            if (data.lesson_id === lessonId && data.block_id) practiceByBlock.set(data.block_id, data.locally_correct === true);
          } catch {
            /* 损坏埋点由其它安全审计处理 */
          }
        }
        if (localQuizRequests.length !== 0 || localQuizRows !== 0) failures.push("practice:形成性块触发了 quiz-result 请求或 DB 写入");
        if (practiceByBlock.get(fillBlock.id) !== true || practiceByBlock.get(dragBlock.id) !== true || practiceByBlock.get(scoredHotspot.id) !== true || practiceByBlock.has(exploratoryHotspot.id)) {
          failures.push("practice:ct-practice 的响应与 AnalyticsEvent DB 真值不一致");
        }
        }
      }

      const deterministicCompleteResponse = deterministic.waitForResponse((response) => {
        if (!response.url().includes("/api/progress") || response.request().method() !== "POST") return false;
        try {
          const data = JSON.parse(response.request().postData() || "{}") as { lessonId?: string; completed?: boolean; kind?: string };
          return data.lessonId === lessonId && data.completed === true && data.kind === "slide";
        } catch {
          return false;
        }
      }, { timeout: 12_000 }).catch(() => null);
      await deterministic.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "auto" }));
      const deterministicComplete = await deterministicCompleteResponse;
      const deterministicSaved = await prisma.learningProgress.findUnique({ where: { userId_lessonId: { userId: demo.id, lessonId } } });
      if (!deterministicComplete?.ok() || !deterministicSaved?.completedAt || (deterministicSaved.lastSlideIndex ?? 0) <= 1) {
        failures.push("contract-2:抵达底部后响应/DB 未幂等完课或丢失量化进度");
      }
      await deterministic.evaluate(() => { window.scrollTo(0, 0); window.scrollTo(0, document.documentElement.scrollHeight); });
      await deterministic.waitForTimeout(650);
      if (deterministicCompleted.length !== 1) failures.push(`contract-2:重复抵达底部上报完课 ${deterministicCompleted.length} 次（应为 1）`);
      await deterministic.close();

      // 新会话保留上次 scroll 偏好；切回 paged 不得自动完课，到末页后仍需再点“完成本节”。
      await prisma.learningProgress.deleteMany({ where: { userId: demo.id, lessonId } });
      const backToPaged = await ctx.newPage();
      const pagedCompleted: string[] = [];
      backToPaged.on("request", (request) => {
        if (!request.url().includes("/api/progress") || request.method() !== "POST") return;
        try {
          const data = JSON.parse(request.postData() || "{}") as { lessonId?: string; completed?: boolean };
          if (data.lessonId === lessonId && data.completed === true) pagedCompleted.push(request.postData() || "");
        } catch {}
      });
      await backToPaged.goto(`${BASE}/courses/${fixture.slug}/learn/${lessonId}`, { waitUntil: "domcontentloaded" });
      await backToPaged.getByRole("tab", { name: "翻页" }).click({ timeout: 15_000 }).catch(() => failures.push("contract-2:无法从保留的 scroll 偏好切回 paged"));
      await backToPaged.waitForTimeout(700);
      if (pagedCompleted.length !== 0 || await prisma.learningProgress.findFirst({ where: { userId: demo.id, lessonId, completedAt: { not: null } } })) failures.push("contract-2:仅切回 paged 就误完课");
      const pagedFrame = backToPaged.frameLocator('iframe[title="AI 课件"]');
      const pagedNext = pagedFrame.locator(".ct-pager button").last();
      let pagedClicks = 0;
      const pagedReady = await pagedNext.count().catch(() => 0);
      if (pagedReady !== 1) {
        failures.push(`contract-2:切回 paged 后 iframe/pager 消失(url=${backToPaged.url()},completed=${pagedCompleted.length})`);
      }
      while (pagedReady === 1 && !((await pagedNext.textContent({ timeout: 2_000 }).catch(() => "")) || "").includes("完成本节") && pagedClicks < 40) {
        await pagedNext.click();
        pagedClicks++;
      }
      await backToPaged.waitForTimeout(250);
      if (pagedReady === 1 && !((await pagedNext.textContent({ timeout: 2_000 }).catch(() => "")) || "").includes("完成本节") || pagedCompleted.length !== 0) failures.push("contract-2:paged 末页未保留显式完成动作");
      const pagedCompleteResponse = backToPaged.waitForResponse((response) => {
        if (!response.url().includes("/api/progress") || response.request().method() !== "POST") return false;
        try {
          const data = JSON.parse(response.request().postData() || "{}") as { lessonId?: string; completed?: boolean };
          return data.lessonId === lessonId && data.completed === true;
        } catch { return false; }
      }, { timeout: 10_000 }).catch(() => null);
      if (pagedReady === 1) await pagedNext.click();
      const pagedComplete = await pagedCompleteResponse;
      const pagedSaved = await prisma.learningProgress.findUnique({ where: { userId_lessonId: { userId: demo.id, lessonId } } });
      if (!pagedComplete?.ok() || !pagedSaved?.completedAt || pagedCompleted.length !== 1) failures.push("contract-2:切回 paged 后显式完成的响应/DB/幂等性不一致");
      await backToPaged.close();

      // —— 5:软导航进入(2026-07-20 空白根因的用户真实路径,必测!)——
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
      const scrollSaved = await prisma.learningProgress.findUnique({ where: { userId_lessonId: { userId: demo.id, lessonId: scrollLessonId } } });
      if (!scrollSaved?.completedAt || (scrollSaved.lastSlideIndex ?? 0) <= 1) failures.push("bespoke:DB 未完课或完课将已有页序回退为 1");
      await bp.close();

      // —— 6:单页 + fragment —— 首载不完课，揭完所有步骤仍不完课，再显式点“完成本节”才写 DB。
      await prisma.learningProgress.deleteMany({ where: { userId: demo.id, lessonId: singleLessonId } });
      const single = await ctx.newPage();
      const singleCompleted: string[] = [];
      single.on("request", (request) => {
        if (!request.url().includes("/api/progress") || request.method() !== "POST") return;
        const data = JSON.parse(request.postData() || "{}") as { lessonId?: string; completed?: boolean };
        if (data.lessonId === singleLessonId && data.completed === true) singleCompleted.push(request.postData() || "");
      });
      await single.goto(`${BASE}/courses/${fixture.slug}/learn/${singleLessonId}`, { waitUntil: "domcontentloaded" });
      const singleFrame = single.frameLocator('iframe[title="AI 课件"]');
      const nextAction = singleFrame.locator(".ct-pager button").last();
      await nextAction.waitFor({ state: "visible", timeout: 15_000 }).catch(() => failures.push("single:单页完成控件不可见"));
      await single.waitForTimeout(900);
      if (singleCompleted.length || await prisma.learningProgress.findFirst({ where: { userId: demo.id, lessonId: singleLessonId, completedAt: { not: null } } })) failures.push("single:单页首载零操作提前完课");
      let revealClicks = 0;
      while (!((await nextAction.textContent()) || "").includes("完成本节") && revealClicks < 16) {
        await nextAction.click();
        revealClicks++;
        if (singleCompleted.length) failures.push("single:仅揭示末页 fragment 就提前完课");
      }
      await single.waitForTimeout(350);
      if (!((await nextAction.textContent()) || "").includes("完成本节")) failures.push("single:fragment 全部揭示后未进入显式完成状态");
      const explicitComplete = single.waitForResponse((r) => {
        if (!r.url().includes("/api/progress") || r.request().method() !== "POST") return false;
        try {
          const data = JSON.parse(r.request().postData() || "{}") as { lessonId?: string; completed?: boolean };
          return data.lessonId === singleLessonId && data.completed === true;
        } catch {
          return false;
        }
      }, { timeout: 10_000 }).catch(() => null);
      await nextAction.click();
      const explicitResponse = await explicitComplete;
      const singleSaved = await prisma.learningProgress.findUnique({ where: { userId_lessonId: { userId: demo.id, lessonId: singleLessonId } } });
      if (!explicitResponse?.ok() || !singleSaved?.completedAt || singleCompleted.length !== 1) {
        failures.push(`single:显式完成后 response/DB/幂等语义不一致(response=${explicitResponse?.status() ?? "none"},completedAt=${singleSaved?.completedAt?.toISOString() ?? "null"},requests=${singleCompleted.length},button=${await nextAction.textContent().catch(() => "missing")})`);
      }
      await single.close();

      // —— 7:历史恶意 LLM fixture —— 读时脚本被清空，不会自发 ct-page/ct-complete/ct-quiz。
      await prisma.learningProgress.deleteMany({ where: { userId: demo.id, lessonId: hostileLessonId } });
      await prisma.lessonQuizResult.deleteMany({ where: { userId: demo.id, lessonId: hostileLessonId } });
      const hostile = await ctx.newPage();
      await hostile.goto(`${BASE}/courses/${fixture.slug}/learn/${hostileLessonId}`, { waitUntil: "domcontentloaded" });
      const hostileDocumentResponse = await ctx.request.get(`${BASE}/api/lessons/${hostileLessonId}/courseware`);
      const hostileCsp = hostileDocumentResponse.headers()["content-security-policy"] || "";
      const hostileFrame = hostile.frameLocator('iframe[title="AI 课件"]');
      await hostileFrame.locator(".historical-title").waitFor({ state: "visible", timeout: 15_000 }).catch(() => failures.push("hostile:净化后静态内容不可见"));
      const hostileState = await hostileFrame.locator("html").evaluate((html) => ({
        evil: Boolean((window as Window & { __historicalEvil?: boolean }).__historicalEvil),
        scripts: document.scripts.length,
        adapters: document.querySelectorAll("script[data-ct-bespoke-adapter]").length,
        adapterNonce: (document.querySelector("script[data-ct-bespoke-adapter]") as HTMLScriptElement | null)?.nonce || null,
        onload: document.body.getAttribute("onload"),
        source: html.innerHTML,
      }));
      await hostile.waitForTimeout(900);
      const hostileProgress = await prisma.learningProgress.findUnique({ where: { userId_lessonId: { userId: demo.id, lessonId: hostileLessonId } } });
      const hostileQuiz = await prisma.lessonQuizResult.count({ where: { userId: demo.id, lessonId: hostileLessonId } });
      if (hostileState.evil || hostileState.scripts !== 1 || hostileState.adapters !== 1 || hostileState.onload || hostileState.source.includes("ct-page")) failures.push("hostile:历史模型脚本未被唯一 adapter 完整替换");
      if (!hostileState.adapterNonce || !/script-src 'nonce-[^']+'/.test(hostileCsp) || /script-src[^;]*'unsafe-inline'/.test(hostileCsp)) failures.push("hostile:LLM 课件未用随机 nonce CSP 将执行权限锁定到平台 adapter");
      if (hostileProgress?.completedAt || hostileQuiz !== 0) failures.push("hostile:模型自发协议污染了进度或测验 DB");
      await hostile.close();

      // —— 8:reduce-motion —— 长滚动块课首载静态显示，但零滚动绝不完课。
      await prisma.learningProgress.deleteMany({ where: { userId: demo.id, lessonId: reducedLessonId } });
      const reduceContext = await browser.newContext({ reducedMotion: "reduce" });
      await reduceContext.addCookies([{ name: "tide_session", value: token, url: BASE }]);
      const reducePage = await reduceContext.newPage();
      await reducePage.goto(`${BASE}/courses/${fixture.slug}/learn/${reducedLessonId}`, { waitUntil: "domcontentloaded" });
      await reducePage.getByRole("button", { name: "滚动" }).click({ timeout: 15_000 }).catch(() => failures.push("reduce:无法切换块课滚动模式"));
      await reducePage.waitForTimeout(1200);
      const reducedSaved = await prisma.learningProgress.findUnique({ where: { userId_lessonId: { userId: demo.id, lessonId: reducedLessonId } } });
      if (await reducePage.evaluate(() => window.scrollY) !== 0 || reducedSaved?.completedAt) failures.push("reduce:reduce-motion 零滚动提前完课");
      await reducePage.close();
      await reduceContext.close();
      await ctx.close();
    }
  } finally {
    await browser?.close();
    const fixtureLessonIds = new Set(fixture.lessons.map((lesson) => lesson.id));
    const practiceEvents = await prisma.analyticsEvent.findMany({
      where: { userId: demo.id, eventName: "courseware_local_practice", createdAt: { gte: runStartedAt } },
      select: { id: true, propertiesJson: true },
    }).catch(() => []);
    const fixtureEventIds = practiceEvents.flatMap((event) => {
      try {
        const data = JSON.parse(event.propertiesJson) as { lesson_id?: string };
        return data.lesson_id && fixtureLessonIds.has(data.lesson_id) ? [event.id] : [];
      } catch {
        return [];
      }
    });
    if (fixtureEventIds.length > 0) await prisma.analyticsEvent.deleteMany({ where: { id: { in: fixtureEventIds } } }).catch(() => {});
    await prisma.reviewCard.deleteMany({ where: { userId: demo.id, courseId: fixture.id } }).catch(() => {});
    // delete() 会读回 Course 全行，当本地验收库落后当前 Prisma schema 时反而会让清理失败。
    // deleteMany() 仅做范围受控的删除，不依赖读回新列，确保失败路径也能回收随机 slug 夹具。
    await prisma.course.deleteMany({ where: { slug } }).catch(() => {});
    await prisma.$disconnect();
  }

  if (failures.length) {
    console.error(`嵌入层 E2E:${failures.length} 项失败`);
    for (const f of failures) console.error("  ✗ " + f);
    process.exit(1);
  }
  console.log("嵌入层 E2E:13/13 通过(握手/可见性/页进度/严格数值+单调性/测验真值/移动续读首击/contract-2 滚动真值/形成性练习隔离/软导航/bespoke 滚动完课/单页显式完成/历史 LLM 净化/reduce-motion)");
}

main();
