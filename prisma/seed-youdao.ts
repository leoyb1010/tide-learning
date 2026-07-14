/**
 * 有道英语产品课程库种子（据「产品梳理表格」的 9 个产品）。
 * 内容固化在 prisma/data/youdao-courses.json（可提交、可复现）；
 * 每节用 App 的确定性渲染器出精美动效 HTML。幂等：按 slug 前缀 yd- 先删后建，可重复运行。
 * 运行：DATABASE_URL="file:/abs/prisma/dev.db" npx tsx prisma/seed-youdao.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { validateBlocks } from "../src/lib/blocks";
import { resolveCourseDesign, serializeCourseDesign } from "../src/lib/ai/courseware-design";
import { resolveCoursewareMode } from "../src/lib/ai/courseware-catalog";
import { renderAndStoreLessonHtml } from "../src/lib/ai/courseware-gen";

const DATA_FILE = path.join(__dirname, "data", "youdao-courses.json");

// 产品元数据(分类/等级/封面/主讲/精选)，与撰写 workflow 的 PRODUCTS 对齐。
const META: Record<string, { name: string; category: string; level: string; cover: string; instructor: string; featured?: boolean; template?: string }> = {
  taiji:      { name: "太极英语",        category: "english_foundation", level: "L2", cover: "dawn", instructor: "祁连山",          featured: true,  template: "classic" },
  chaopin:    { name: "超频语境",        category: "english_foundation", level: "L1", cover: "tide", instructor: "梁焕臻",          featured: true,  template: "story" },
  ct1v1:      { name: "中教口语 1v1",    category: "english_oral",       level: "L1", cover: "tide", instructor: "有道中教教研组",  template: "case_driven" },
  ct1v4:      { name: "中教口语小班 1v4", category: "english_oral",       level: "L1", cover: "tide", instructor: "有道中教教研组",  template: "case_driven" },
  wj1v1:      { name: "外教口语 1v1",    category: "english_oral",       level: "L2", cover: "tide", instructor: "有道外教团队",    featured: true,  template: "case_driven" },
  tangxue:    { name: "躺学单词篇",      category: "english_foundation", level: "L1", cover: "dawn", instructor: "梁焕臻",          template: "classic" },
  oral_class: { name: "口语小班课",      category: "english_oral",       level: "L2", cover: "tide", instructor: "有道口语教研组",  template: "case_driven" },
  silver:     { name: "银发口语",        category: "silver_english",     level: "L1", cover: "dawn", instructor: "有道银发英语教研组", featured: true, template: "classic" },
  sanheyi:    { name: "三合一全能英语",  category: "english_oral",       level: "L2", cover: "tide", instructor: "有道全能英语教研组", template: "classic" },
};

function slugify(key: string): string {
  return "yd-" + key.replace(/_/g, "-");
}

function readAuthored(): Array<{ key: string; subtitle: string; intro: string; level: string; instructorName: string; lessons: any[] }> {
  const arr = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  return Array.isArray(arr) ? arr.filter((r) => r && r.key && Array.isArray(r.lessons)) : [];
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: "admin" } });
  const ownerId = admin?.id ?? null;
  const authored = readAuthored();
  console.log(`读到 ${authored.length} 门撰写结果`);
  let ok = 0, htmlOk = 0, htmlTotal = 0;

  for (const a of authored) {
    const m = META[a.key];
    if (!m) { console.log(`跳过未知 key: ${a.key}`); continue; }
    const slug = slugify(a.key);

    // 幂等清理旧的同 slug 课
    const existing = await prisma.course.findUnique({ where: { slug }, select: { id: true } });
    if (existing) {
      await prisma.learningProgress.deleteMany({ where: { courseId: existing.id } });
      await prisma.note.deleteMany({ where: { courseId: existing.id } });
      await prisma.lesson.deleteMany({ where: { courseId: existing.id } });
      await prisma.course.delete({ where: { id: existing.id } });
    }

    const design = resolveCourseDesign({ id: slug, category: m.category, template: m.template, title: m.name });
    const mode = resolveCoursewareMode({ title: m.name, template: m.template, artKey: design.art.key });

    const course = await prisma.course.create({
      data: {
        slug, title: m.name, subtitle: a.subtitle?.slice(0, 120) || null,
        description: a.intro?.slice(0, 1000) || null,
        category: m.category, level: m.level, status: "published",
        coverColor: m.cover, ownerId, origin: "official", authorUserId: null,
        visibility: "public", sharedStatus: "private",
        instructorName: a.instructorName || m.instructor,
        contributorName: "网易有道", updateCadence: "按题季更新",
        qualityTier: "standard", template: m.template ?? null,
        designJson: serializeCourseDesign(design),
        disclaimer: "本课程内容基于有道同名产品的教学方法与真实课程结构整理，供体验学习参考。",
        isFeatured: m.featured ?? false, publishedAt: new Date(), lastUpdatedAt: new Date(),
      },
    });

    let totalDuration = 0;
    const lessons = Array.isArray(a.lessons) ? a.lessons.slice(0, 8) : [];
    for (let i = 0; i < lessons.length; i++) {
      const l = lessons[i];
      const blocks = validateBlocks(Array.isArray(l.blocks) ? l.blocks : []);
      if (blocks.length === 0) continue;
      const dur = 300 + blocks.length * 30;
      totalDuration += dur;
      const lesson = await prisma.lesson.create({
        data: {
          courseId: course.id, title: (l.title || `第 ${i + 1} 讲`).slice(0, 120),
          summary: (l.summary || "").slice(0, 300) || null, sortOrder: i,
          contentType: "ai_block",
          blocksJson: JSON.stringify({ version: 1, blocks }),
          durationSec: dur, isFree: l.isFree === true || i === 0,
          status: "published", publishedAt: new Date(),
        },
        select: { id: true, title: true, sortOrder: true, blocksJson: true, htmlJson: true, renderSourceHash: true },
      });
      // 确定性精美渲染(不 enhance → 纯确定性，无 LLM、无超时)
      htmlTotal++;
      try {
        const r = await renderAndStoreLessonHtml(course.id, lesson, design, mode);
        if (r.ok && r.contract) htmlOk++;
      } catch (e) {
        console.error(`  [${a.key}] L${i} 渲染失败:`, e instanceof Error ? e.message : e);
      }
    }
    await prisma.course.update({ where: { id: course.id }, data: { totalDurationSec: totalDuration, deterministicRenderCount: htmlOk } });
    ok++;
    console.log(`✓ ${m.name} (${slug}) · ${m.category} · ${lessons.length}节 · art=${design.art.key}`);
  }
  console.log(`\n完成: ${ok} 门课入库 · HTML 渲染 ${htmlOk}/${htmlTotal} 节`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
