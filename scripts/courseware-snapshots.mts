/**
 * 课件快照基线（蓝图 B7）—— 12 套 art × 代表 mode 的确定性渲染截图。
 *
 * 用途：视觉回归（改渲染器/CSS 后重跑，与上一版人工/脚本比对），防「改一处崩全局」。
 * 产物：report/courseware-snapshots/<art>--<mode>.paged.png（翻页首页）与 .scroll.png（整卷全页）。
 * 确定性：固定样例块 + 固定 courseId/lessonId 种子 → 同代码必产同图（像素级可比对）。
 *
 * 运行：npm run snap:courseware（约 1-2 分钟；需 playwright chromium，devDeps 已含）。
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { ART_DIRECTIONS, resolveCourseDesign, serializeCourseDesign } from "../src/lib/ai/courseware-design";
import { resolveLessonVariance } from "../src/lib/ai/courseware-variance";
import { resolveCoursewareMode } from "../src/lib/ai/courseware-catalog";
import { renderCoursewareHtml, validateCoursewareHtml } from "../src/lib/ai/courseware-html";
import { ensureHighlighter } from "../src/lib/ai/courseware-highlight";
import { validateBlocks } from "../src/lib/blocks";

const OUT = join(process.cwd(), "report", "courseware-snapshots");

// 全块型覆盖的固定样例（12/14 种块；image 为占位、scene/summary 首尾各一）。
const SAMPLE_BLOCKS = validateBlocks([
  { type: "scene", title: "把重复的活交给一个函数", markdown: "你已经第三次复制粘贴同一段代码了，改一处忘两处。**函数**就是把这段活关进笼子，只喂参数。" },
  { type: "objectives", items: ["能说出函数三要素", "能写出带默认参数的函数", "能解释返回值与打印的区别", "能重构一段重复代码"] },
  { type: "concept", title: "函数是带名字的一段活", markdown: "定义一次，随处调用。**参数**是原料，**返回值**是产出；名字起得好，代码自己会说话。" },
  { type: "example", markdown: "把「泡三杯不同浓度的茶」写成 `make_tea(strength)`，三次调用替代三段复制。" },
  { type: "steps", steps: [
    { title: "圈出重复段", detail: "找到复制过 2 次以上的代码" },
    { title: "提取差异为参数", detail: "变化的部分就是参数" },
    { title: "命名并替换调用", detail: "动词开头，见名知意" },
  ] },
  { type: "compare", title: "复制粘贴 vs 抽函数", left: { heading: "复制粘贴", items: ["改一处漏两处", "越攒越长", "没法测试"] }, right: { heading: "抽成函数", items: ["改一处全生效", "主流程清爽", "可单测"] } },
  { type: "dialog", turns: [
    { speaker: "小林", text: "我这三段代码就差一个数字,也要抽函数吗?" },
    { speaker: "导师", text: "差的那个数字,就是它在喊「我是参数」。", note: "差异即参数" },
    { speaker: "小林", text: "懂了,把差异喂进去,把相同留在里面。" },
  ] },
  { type: "code", lang: "python", code: "def make_tea(strength):\n    water = 200\n    leaves = 2 * strength\n    return brew(water, leaves)", explanation: "strength 是唯一的差异，其余全部收进函数体。" },
  { type: "image", src: "/illustration/auto.svg", caption: "从重复代码到函数的三步流程" },
  { type: "keypoint", points: ["函数 = 名字 + 参数 + 返回值", "差异即参数", "一个函数只做一件事", "先能跑,再变好"] },
  { type: "quiz", question: "下面哪种情况最该抽函数?", options: ["只写一次的代码", "复制过三次的代码", "永远不会改的代码"], answerIndex: 1, explain: "重复即信号:复制次数越多,抽函数的收益越大。" },
  { type: "flashcard", front: "参数是什么?", back: "调用之间会变化的那部分差异。" },
  { type: "callout", tone: "warn", markdown: "别过度抽象:只出现一次的代码不需要函数。" },
  { type: "summary", markdown: "重复三次就抽函数;差异做参数,相同进函数体。", next: "给函数配上「说明书」:文档字符串与类型标注" },
]);

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  // 与生产渲染链同源:先就位 shiki,否则 code 块落回手写高亮,快照与生产产物不一致(审计修复)。
  await ensureHighlighter().catch(() => {});

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });

  let count = 0;
  for (const art of ART_DIRECTIONS) {
    // 固定 designJson 直给 artKey，确保逐 art 全覆盖；knob 数值走 resolveCourseDesign 的确定性推导。
    const design = resolveCourseDesign({
      id: `snap-${art.key}`,
      category: null,
      template: null,
      designJson: serializeCourseDesign({ art, variance: 7, motion: 6, density: 5 }),
      title: null,
    });
    const mode = resolveCoursewareMode({ artKey: art.key });
    const variance = resolveLessonVariance(`snap-${art.key}`, { id: "L1", title: "样例节", sortOrder: 1 }, design);
    const html = renderCoursewareHtml({ title: `快照样例 · ${art.label}`, blocks: SAMPLE_BLOCKS, design, variance, mode });

    const lint = validateCoursewareHtml(html);
    if (!lint.ok) {
      console.error(`[lint-fail] ${art.key}: ${lint.issues.join("; ")}`);
      process.exitCode = 1;
    }

    const file = join(OUT, `${art.key}--${mode}.html`);
    writeFileSync(file, html);
    await page.goto(`file://${file}`, { waitUntil: "load" });
    await page.waitForTimeout(350);
    await page.screenshot({ path: join(OUT, `${art.key}--${mode}.paged.png`) });
    // 切滚动模式出整卷全页图（全块型一图尽览，最适合回归比对）。
    await page.evaluate(() => window.postMessage({ type: "ct-mode", mode: "scroll" }, "*"));
    await page.waitForTimeout(350);
    await page.screenshot({ path: join(OUT, `${art.key}--${mode}.scroll.png`), fullPage: true });
    count += 2;
    console.log(`ok  ${art.key} (${mode})`);
  }

  await browser.close();
  console.log(`\n快照完成:${count} 张 → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
