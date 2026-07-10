/**
 * 重生成已有 HTML 课件（Lesson.htmlJson）—— 运行时/渲染器升级后跑一次，让存量课件拿到新能力。
 *
 * 只重渲确定性引擎（零 LLM、零 key、可重复跑）；不动 contentType / blocksJson。
 * 用法：DATABASE_URL="file:./dev.db" npx tsx scripts/regen-courseware-html.ts
 */
import { PrismaClient } from "@prisma/client";
import { validateBlocks } from "../src/lib/blocks";
import { resolveCourseDesign } from "../src/lib/ai/courseware-design";
import { resolveLessonVariance } from "../src/lib/ai/courseware-variance";
import { resolveCoursewareMode } from "../src/lib/ai/courseware-catalog";
import { renderCoursewareHtml, buildContract } from "../src/lib/ai/courseware-html";

const prisma = new PrismaClient();

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const courseArg = process.argv.find((a) => a.startsWith("--course="))?.slice("--course=".length);
  const lessons = await prisma.lesson.findMany({
    where: { blocksJson: { not: null }, ...(courseArg ? { courseId: courseArg } : {}) },
    include: { course: true },
    orderBy: [{ courseId: "asc" }, { sortOrder: "asc" }],
  });
  let ok = 0;
  let skipped = 0;
  for (const l of lessons) {
    let blocks: ReturnType<typeof validateBlocks> = [];
    try {
      const parsed = JSON.parse(l.blocksJson ?? "null") as { blocks?: unknown };
      blocks = validateBlocks(parsed?.blocks ?? parsed);
    } catch {
      /* 脏数据当无块处理 */
    }
    if (!l.course || blocks.length === 0) {
      skipped++;
      console.log(`skip  ${l.id} ${l.title}（无块或无课程）`);
      continue;
    }
    const design = resolveCourseDesign(l.course);
    const mode = resolveCoursewareMode({ title: l.course.title, template: l.course.template, artKey: design.art.key });
    const variance = resolveLessonVariance(l.course.id, l, design);
    const html = renderCoursewareHtml({ title: l.title, blocks, design, variance, mode });
    const contract = buildContract(html);
    if (!dryRun) {
      await prisma.lesson.update({ where: { id: l.id }, data: { htmlJson: JSON.stringify(contract), renderEngine: "deterministic", renderRejectReason: null } });
    }
    ok++;
    console.log(`${dryRun ? "check" : "regen"} ${l.id} ${l.title} → ${design.art.key}/${mode}, ${Math.round(html.length / 1024)}KB`);
  }
  console.log(`\n完成：重生成 ${ok} 节，跳过 ${skipped} 节。`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
