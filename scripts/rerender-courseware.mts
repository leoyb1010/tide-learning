/**
 * 全量重渲染课件（蓝图 Stage 1/2 收尾工具）—— 把库内已有 blocksJson 的节按当前渲染版本重出 HTML。
 *
 * 用途：HTML_RENDER_VERSION 翻代后（新开场构图/幽灵预排/密度自适应/协议壳），存量课件仍是旧版
 * HTML，只有再次触发渲染才会更新。本脚本走与主链完全相同的 renderAndStoreLessonHtml（确定性路径，
 * enhance=false 不调 LLM 不花钱），旧版自动进 LessonRevision 存档（S1），qualityJson.visual 一并补齐（C2）。
 *
 * 运行：DATABASE_URL=file:$PWD/prisma/dev.db npx tsx scripts/rerender-courseware.mts [limit]
 */
import { prisma } from "../src/lib/db";
import { resolveCourseDesign } from "../src/lib/ai/courseware-design";
import { resolveCoursewareMode } from "../src/lib/ai/courseware-catalog";
import { renderAndStoreLessonHtml } from "../src/lib/ai/courseware-gen";

async function main() {
  const limit = Number(process.argv[2]) || 500;
  const lessons = await prisma.lesson.findMany({
    where: { blocksJson: { not: null } },
    select: {
      id: true,
      title: true,
      sortOrder: true,
      blocksJson: true,
      htmlJson: true,
      renderSourceHash: true,
      course: { select: { id: true, title: true, category: true, template: true, designJson: true } },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  console.log(`待重渲染:${lessons.length} 节`);
  let ok = 0, skip = 0, fail = 0;
  for (const l of lessons) {
    const design = resolveCourseDesign({ ...l.course, title: l.course.title });
    const mode = resolveCoursewareMode({ title: l.course.title, template: l.course.template, artKey: design.art.key });
    try {
      const r = await renderAndStoreLessonHtml(l.course.id, l, design, mode, { force: true });
      if (r.ok && r.contract) {
        ok++;
      } else {
        skip++; // 被并发 claim 占用等
      }
    } catch (e) {
      fail++;
      console.error(`fail ${l.course.title} · ${l.title}:`, (e as Error).message);
    }
  }
  await prisma.$disconnect();
  console.log(`完成:ok=${ok} skip=${skip} fail=${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
