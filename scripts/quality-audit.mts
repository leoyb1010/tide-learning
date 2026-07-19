/**
 * 生产课件质量审计(v4.2 精进前置)——对库内全部含 blocksJson 的节:
 *  - 内容层:scoreLesson 六项规则分 + 模板遵循度;
 *  - 表现层:scoreCoursewareVisual 视觉分及其分项指标;
 * 汇总分布(按 art / template / 分数带),打印最弱 15 节与最弱指标,供确定性渲染器精进定靶。
 * 只读,不写库。运行:DATABASE_URL=file:$PWD/prisma/dev.db npx tsx scripts/quality-audit.mts
 */
import { prisma } from "../src/lib/db";
import { validateBlocks } from "../src/lib/blocks";
import { scoreLesson } from "../src/lib/course-gen";
import { resolveCourseDesign } from "../src/lib/ai/courseware-design";
import { scoreCoursewareVisual } from "../src/lib/ai/courseware-html";

function safeParse(s: string | null): unknown {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

async function main() {
  const lessons = await prisma.lesson.findMany({
    where: { blocksJson: { not: null } },
    select: {
      id: true,
      title: true,
      blocksJson: true,
      htmlJson: true,
      renderEngine: true,
      course: { select: { id: true, title: true, category: true, template: true, designJson: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  interface Row {
    id: string;
    course: string;
    lesson: string;
    template: string;
    art: string;
    engine: string | null;
    content: number;
    passed: boolean;
    visual: number | null;
    vm: { distinctBackgrounds: number; svgCount: number; sectionCount: number; avgTextPerSection: number } | null;
  }
  const rows: Row[] = [];

  for (const l of lessons) {
    const parsed = safeParse(l.blocksJson) as { blocks?: unknown } | null;
    const blocks = validateBlocks(parsed?.blocks ?? parsed);
    const q = scoreLesson(blocks, l.course.template);
    const design = resolveCourseDesign({ ...l.course, title: l.course.title });
    const contract = safeParse(l.htmlJson) as { html?: string } | null;
    const v = contract?.html ? scoreCoursewareVisual(contract.html) : null;
    rows.push({
      id: l.id,
      course: l.course.title,
      lesson: l.title,
      template: l.course.template ?? "-",
      art: design.art.key,
      engine: l.renderEngine,
      content: q.score,
      passed: q.passed,
      visual: v?.score ?? null,
      vm: v ? v.metrics : null,
    });
  }

  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  console.log(`共 ${rows.length} 节 | 内容分均值 ${avg(rows.map((r) => r.content))} | 视觉分均值 ${avg(rows.filter((r) => r.visual !== null).map((r) => r.visual as number))}`);
  console.log(`内容不及格(passed=false): ${rows.filter((r) => !r.passed).length} 节`);

  const band = (n: number) => (n >= 85 ? "85+" : n >= 70 ? "70-84" : n >= 60 ? "60-69" : "<60");
  const dist = new Map<string, number>();
  for (const r of rows) if (r.visual !== null) dist.set(band(r.visual), (dist.get(band(r.visual)) ?? 0) + 1);
  console.log("视觉分分布:", Object.fromEntries([...dist.entries()].sort()));

  const byArt = new Map<string, number[]>();
  for (const r of rows) if (r.visual !== null) (byArt.get(r.art) ?? byArt.set(r.art, []).get(r.art)!).push(r.visual);
  console.log("\n按 art 视觉分均值:");
  for (const [k, xs] of [...byArt.entries()].sort((a, b) => avg(a[1]) - avg(b[1]))) console.log(`  ${k.padEnd(18)} ${avg(xs)}  (${xs.length} 节)`);

  console.log("\n最弱 15 节(按视觉分,含分项):");
  for (const r of rows.filter((r) => r.visual !== null).sort((a, b) => (a.visual as number) - (b.visual as number)).slice(0, 15)) {
    console.log(
      `  V${r.visual} C${r.content} ${r.art.padEnd(16)} bg=${r.vm!.distinctBackgrounds} svg=${r.vm!.svgCount} sec=${r.vm!.sectionCount} avg字=${r.vm!.avgTextPerSection}  ${r.course}·${r.lesson}`.slice(0, 150),
    );
  }

  console.log("\n内容不及格清单:");
  for (const r of rows.filter((r) => !r.passed).slice(0, 15)) console.log(`  C${r.content} [${r.template}] ${r.course}·${r.lesson}`.slice(0, 130));

  await prisma.$disconnect();
}

main();
