/**
 * 渲染烟囱测试（蓝图 C3）—— 对库内最近 N 节课件做 headless 机检，异常清单落 report/render-check.json。
 *
 * 检查项（DOM 级，确定性、零像素依赖）：
 *  - overflowX：页面横向溢出（scrollWidth > clientWidth+2）—— 硬伤，计为 fail；
 *  - blankRatio：翻页模式前 3 页的「可见文本覆盖率」，一页 < 1.5% 记空白页；≥2 页计为 fail。
 *    阈值按真实语料校准：健康的纯文字页（objectives/对话首步）覆盖率约 2-5%，大标题页 8%+；
 *    低于 1.5% 意味着页面近乎无可见内容（渲染断裂/全被隐藏），此为「真空白」判据；
 *  - contrast：正文与背景的相对亮度比 < 3.5 计为 fail（可读性底线）；
 *  - textLen：全文可见文字 < 200 字提示（观察项，不 fail）。
 *
 * 运行：npm run check:render [-- N]（默认 20 节）。退出码非 0 = 有 fail 项。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { prisma } from "../src/lib/db";

const OUT_DIR = join(process.cwd(), "report");
const TMP = join(OUT_DIR, "render-check-tmp");

interface CheckResult {
  lessonId: string;
  course: string;
  lesson: string;
  engine: string | null;
  overflowX: boolean;
  blankPages: number;
  pagesChecked: number;
  contrastRatio: number;
  textLen: number;
  fail: boolean;
  notes: string[];
}

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function parseRgb(s: string): [number, number, number] | null {
  const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

async function checkPageCoverage(page: Page): Promise<number> {
  // 视口内含可见文本的元素矩形覆盖率（粗但确定）：太低 = 大面积空白页。
  return page.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const seen: Array<[number, number, number, number]> = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let area = 0;
    while (walker.nextNode()) {
      const t = walker.currentNode as Text;
      if (!t.textContent || !t.textContent.trim()) continue;
      const el = t.parentElement;
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || Number(cs.opacity) < 0.1) continue;
      const r = el.getBoundingClientRect();
      const x0 = Math.max(0, r.left), y0 = Math.max(0, r.top);
      const x1 = Math.min(vw, r.right), y1 = Math.min(vh, r.bottom);
      if (x1 <= x0 || y1 <= y0) continue;
      const key: [number, number, number, number] = [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)];
      if (seen.some((k) => k.join() === key.join())) continue;
      seen.push(key);
      area += (x1 - x0) * (y1 - y0);
    }
    return Math.min(1, area / (vw * vh));
  });
}

async function main() {
  const n = Number(process.argv[2]) || 20;
  mkdirSync(TMP, { recursive: true });

  const lessons = await prisma.lesson.findMany({
    where: { htmlJson: { not: null } },
    select: { id: true, title: true, htmlJson: true, renderEngine: true, course: { select: { title: true } } },
    orderBy: { createdAt: "desc" },
    take: n,
  });
  if (lessons.length === 0) {
    console.log("库内无 HTML 课件，跳过。");
    return;
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const results: CheckResult[] = [];

  for (const l of lessons) {
    let html = "";
    try {
      html = (JSON.parse(l.htmlJson!) as { html?: string }).html ?? "";
    } catch {
      /* 契约损坏按空处理 */
    }
    const notes: string[] = [];
    if (!html) {
      results.push({ lessonId: l.id, course: l.course.title, lesson: l.title, engine: l.renderEngine, overflowX: false, blankPages: 0, pagesChecked: 0, contrastRatio: 21, textLen: 0, fail: true, notes: ["htmlJson 契约损坏"] });
      continue;
    }
    const file = join(TMP, `${l.id}.html`);
    writeFileSync(file, html);
    await page.goto(`file://${file}`, { waitUntil: "load" });
    await page.waitForTimeout(300);

    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    // textContent 而非 innerText：翻页模式下非当前页 display:none，innerText 只剩单页字数会误报「过短」。
    const textLen = await page.evaluate(() => (document.querySelector("main.deck")?.textContent || document.body.textContent || "").replace(/\s+/g, "").length);
    const colors = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      return { fg: cs.color, bg: cs.backgroundColor };
    });
    const fg = parseRgb(colors.fg), bg = parseRgb(colors.bg);
    let contrastRatio = 21;
    if (fg && bg) {
      const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
      contrastRatio = (l1 + 0.05) / (l2 + 0.05);
    }

    // 翻页模式前 3 页覆盖率（无翻页运行时的 bespoke 按滚动首屏 1 页计）。
    let blankPages = 0;
    let pagesChecked = 0;
    for (let p = 0; p < 3; p++) {
      const cov = await checkPageCoverage(page);
      pagesChecked++;
      if (cov < 0.015) blankPages++;
      const advanced = await page.evaluate(() => {
        const before = document.querySelector(".ct-count")?.textContent;
        window.postMessage({ type: "ct-nav", dir: 1 }, "*");
        return before;
      });
      await page.waitForTimeout(220);
      const after = await page.evaluate(() => document.querySelector(".ct-count")?.textContent);
      if (!after || after === advanced) break; // 无翻页运行时或已到末页
    }

    if (overflowX) notes.push("横向溢出");
    if (blankPages >= 2) notes.push(`空白页×${blankPages}`);
    if (contrastRatio < 3.5) notes.push(`对比度 ${contrastRatio.toFixed(1)}`);
    if (textLen < 200) notes.push(`全文过短 ${textLen} 字`);
    const fail = overflowX || blankPages >= 2 || contrastRatio < 3.5;

    results.push({ lessonId: l.id, course: l.course.title, lesson: l.title, engine: l.renderEngine, overflowX, blankPages, pagesChecked, contrastRatio: Math.round(contrastRatio * 10) / 10, textLen, fail, notes });
    console.log(`${fail ? "FAIL" : "ok  "} ${l.course.title} · ${l.title}${notes.length ? `  [${notes.join(" / ")}]` : ""}`);
  }

  await browser.close();
  await prisma.$disconnect();

  const failed = results.filter((r) => r.fail);
  writeFileSync(join(OUT_DIR, "render-check.json"), JSON.stringify({ at: new Date().toISOString(), total: results.length, failed: failed.length, results }, null, 2));
  console.log(`\n渲染烟囱:${results.length} 节,${failed.length} 节异常 → report/render-check.json`);
  if (failed.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
