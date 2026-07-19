/**
 * 课件即视频（蓝图 E1，零模型依赖）—— 把一节 HTML 课件逐页渲染导出 MP4。
 *
 * 定位：视频形态的**确定性兜底**——真视频模型(E3)缺位时，每门课也永远有可分享的视频产出
 * （上新预告/朋友圈物料/集市商品视频位）。工艺：playwright 逐页截图 → ffmpeg concat 幻灯化
 * （每页停留按该页文字量估读速），1280×720，H.264 + faststart，微信/浏览器直接可播。
 *
 * 用法：
 *   DATABASE_URL=file:$PWD/prisma/dev.db npx tsx scripts/export-courseware-video.mts <lessonId|latest> [每页秒数]
 * 产物：report/courseware-videos/<lessonId>.mp4
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { prisma } from "../src/lib/db";

const OUT_DIR = join(process.cwd(), "report", "courseware-videos");

async function main() {
  const arg = process.argv[2] || "latest";
  const fixedSec = Number(process.argv[3]) || 0;

  const lesson = await prisma.lesson.findFirst({
    where: arg === "latest" ? { htmlJson: { not: null } } : { id: arg, htmlJson: { not: null } },
    orderBy: arg === "latest" ? { createdAt: "desc" } : undefined,
    select: { id: true, title: true, htmlJson: true, course: { select: { title: true } } },
  });
  if (!lesson?.htmlJson) {
    console.error("找不到带 HTML 课件的节:", arg);
    process.exit(2);
  }
  const html = (JSON.parse(lesson.htmlJson) as { html?: string }).html ?? "";
  if (!html) {
    console.error("htmlJson 契约损坏");
    process.exit(2);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const tmp = join(OUT_DIR, `_frames-${lesson.id}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const htmlFile = join(tmp, "lesson.html");
  writeFileSync(htmlFile, html);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
  await page.goto(`file://${htmlFile}`, { waitUntil: "load" });
  await page.waitForTimeout(400);

  // 逐页截图 + 按可见文字量估停留时长（240 字/分钟阅读速，3.2s 起步 8s 封顶）。
  const durations: number[] = [];
  let frame = 0;
  for (let guard = 0; guard < 40; guard++) {
    await page.waitForTimeout(260);
    const shot = join(tmp, `f${String(frame).padStart(3, "0")}.png`);
    await page.screenshot({ path: shot });
    const visibleLen = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, "").length);
    durations.push(fixedSec > 0 ? fixedSec : Math.min(8, Math.max(3.2, visibleLen / 4)));
    frame++;
    const before = await page.evaluate(() => document.querySelector(".ct-count")?.textContent ?? null);
    await page.evaluate(() => window.postMessage({ type: "ct-nav", dir: 1 }, "*"));
    await page.waitForTimeout(220);
    const after = await page.evaluate(() => document.querySelector(".ct-count")?.textContent ?? null);
    if (before === null || after === before) break; // 无翻页运行时或已到末页
  }
  await browser.close();

  // ffmpeg concat 清单（幻灯：每页一帧 + 时长；末帧重复一次收尾）。
  const listFile = join(tmp, "list.txt");
  const lines: string[] = [];
  for (let i = 0; i < frame; i++) {
    lines.push(`file 'f${String(i).padStart(3, "0")}.png'`);
    lines.push(`duration ${durations[i].toFixed(2)}`);
  }
  lines.push(`file 'f${String(frame - 1).padStart(3, "0")}.png'`);
  writeFileSync(listFile, lines.join("\n"));

  const outFile = join(OUT_DIR, `${lesson.id}.mp4`);
  execFileSync("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", listFile,
    "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
    "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-movflags", "+faststart",
    outFile,
  ], { stdio: "pipe" });

  rmSync(tmp, { recursive: true, force: true });
  await prisma.$disconnect();
  const totalSec = durations.reduce((a, b) => a + b, 0).toFixed(1);
  console.log(`导出完成:${lesson.course.title} · ${lesson.title}`);
  console.log(`${frame} 页 / ${totalSec}s → ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
