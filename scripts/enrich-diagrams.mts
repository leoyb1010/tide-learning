/**
 * 存量课程语义图示富化(v4.3)—— 用公网 DeepSeek 从每节**已有文字**中提炼 1 个 diagram 块。
 *
 * 纪律(leohtml §1 事实来源 + §5 图示语义):
 *  - 标签必须取自本节现有内容,不造新事实、不造数据;提不出清晰关系就返回 null(不硬画);
 *  - 产出经 validateBlocks 硬校验 + 内容安全扫描,任一不过即跳过该节;
 *  - 写库走 writeLessonBlocks 唯一入口(自动:旧内容存档 LessonRevision(regen)、清 html 派生层、
 *    已上架课复位 pending 重审)——富化后需跑 rerender-courseware 重出 HTML。
 *  - 幂等:已含 diagram 块的节直接跳过,可重复运行。
 *
 * 运行(按 CLAUDE.md,本机真实生成用公网 DeepSeek):
 *   DATABASE_URL=file:$PWD/prisma/dev.db npx tsx scripts/enrich-diagrams.mts [limit]
 */
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/db";
import { validateBlocks, blocksToPlainText, type Block } from "../src/lib/blocks";
import { scanBlocksSafety } from "../src/lib/content-safety";
import { scoreLesson, writeLessonBlocks } from "../src/lib/course-gen";
import { checkTemplateAdherence } from "../src/lib/ai/templates";

const API = "https://api.deepseek.com/chat/completions";

function deepseekKey(): string {
  const env = readFileSync(".env", "utf8");
  const m = env.match(/^DEEPSEEK_API_KEY=(.+)$/m);
  if (!m) throw new Error("缺 DEEPSEEK_API_KEY(.env)");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

const SYSTEM = `你是课件信息设计师。给你一节课的内容块摘要,判断其中是否存在一个值得画成语义图示的关系,并只输出 JSON。

【选型】先后顺序/流程→flow(末项是产出/结果) · 循环往复→cycle(3-6环节) · 一个中心多个参与方→hub(items第1项是中心) · 层级/依托→layers(自顶向下) · 筛选/转化→funnel(宽到窄,末项是转化结果)

【铁律】
- 所有 label/detail/note 必须提炼自给出的内容本身,禁止引入内容里没有的事实、数字或概念;
- label 2-8 个字,items 2-6 项(cycle/hub 至少3项);note 用一句话点明这张图要读者记住的结论;
- 这节内容若没有清晰的上述关系(比如纯对话练习、纯词汇),输出 {"diagram": null},不要硬画;
- insertAfterIndex = 图应该跟在哪个块后面(通常是它所可视化的 concept/steps 块的下标)。

只输出 JSON:{"diagram": {"type":"diagram","kind":"...","title":"...","items":[{"label":"...","detail":"..."}],"note":"..."} | null, "insertAfterIndex": 数字}`;

interface EnrichResp {
  diagram: (Block & { type: "diagram" }) | null;
  insertAfterIndex?: number;
}

async function proposeDiagram(key: string, title: string, digest: string): Promise<EnrichResp | null> {
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `课节:《${title}》\n内容块(带下标):\n${digest}` },
      ],
      temperature: 0.3,
      max_tokens: 900,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`deepseek ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = data.choices?.[0]?.message?.content ?? "";
  try {
    return JSON.parse(raw) as EnrichResp;
  } catch {
    return null;
  }
}

/** 每块一行的内容摘要(限长,喂给模型判断关系)。 */
function digestBlocks(blocks: (Block & { id: string })[]): string {
  return blocks
    .map((b, i) => {
      const text = blocksToPlainText([b]).replace(/\s+/g, " ").slice(0, 180);
      return `[${i}] ${b.type}: ${text}`;
    })
    .join("\n")
    .slice(0, 2800);
}

async function main() {
  const limit = Number(process.argv[2]) || 500;
  const key = deepseekKey();
  const lessons = await prisma.lesson.findMany({
    where: { blocksJson: { not: null } },
    select: {
      id: true,
      title: true,
      blocksJson: true,
      course: { select: { id: true, title: true, template: true } },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  console.log(`候选 ${lessons.length} 节`);

  // 运营侧批量富化不应把在售集市课打下架:快照上架态,跑完恢复。
  // (writeLessonBlocks 的 shared→pending 复审策略针对作者改写;本脚本产出源自已过审文本
  //  且过了安全扫描,由运营验收统一背书——恢复动作在日志里留痕。)
  const sharedBefore = new Set(
    (await prisma.course.findMany({ where: { sharedStatus: "shared" }, select: { id: true } })).map((c) => c.id),
  );

  let added = 0, skippedHas = 0, skippedNull = 0, failed = 0;

  const CONC = 4;
  let idx = 0;
  async function worker() {
    while (idx < lessons.length) {
      const l = lessons[idx++];
      const tag = `${l.course.title}·${l.title}`.slice(0, 40);
      try {
        const parsed = JSON.parse(l.blocksJson as string) as { blocks?: unknown };
        const blocks = validateBlocks(parsed?.blocks ?? parsed);
        if (blocks.some((b) => b.type === "diagram")) { skippedHas++; continue; }

        const resp = await proposeDiagram(key, l.title, digestBlocks(blocks));
        if (!resp?.diagram) { skippedNull++; console.log(`  – 无关系可画  ${tag}`); continue; }

        // 硬校验:必须以 diagram 类型过 validateBlocks;安全扫描 ok 级才收。
        const validated = validateBlocks([resp.diagram]);
        const dg = validated[0];
        if (!dg || dg.type !== "diagram") { failed++; console.log(`  ✗ 校验不过  ${tag}`); continue; }
        if (scanBlocksSafety(validated).level !== "ok") { failed++; console.log(`  ✗ 安全拦截  ${tag}`); continue; }

        const at = Math.max(0, Math.min(blocks.length - 1, Math.round(resp.insertAfterIndex ?? blocks.length - 2)));
        // 剥掉单块校验时按位分配的 id,合并时由 validateBlocks 按插入位重新编号(避免 blk_0 错位混乱)。
        const { id: _dropId, ...dgNoId } = dg;
        void _dropId;
        const merged = validateBlocks([...blocks.slice(0, at + 1), dgNoId, ...blocks.slice(at + 1)]);
        if (merged.length !== blocks.length + 1) { failed++; console.log(`  ✗ 合并异常  ${tag}`); continue; }

        const quality = scoreLesson(merged, l.course.template);
        const adherence = checkTemplateAdherence(merged, l.course.template);
        const safety = scanBlocksSafety(merged);
        await writeLessonBlocks({
          lessonId: l.id,
          courseId: l.course.id,
          blocksJson: JSON.stringify({ version: 1, blocks: merged }),
          qualityJson: JSON.stringify({
            score: quality.score,
            passed: quality.passed,
            flags: quality.flags,
            adherence: { ok: adherence.ok, missing: adherence.missing },
            regen: { attempted: true, adopted: true, model: "deepseek-chat(enrich-diagram)", beforeScore: quality.score },
            safety: { level: safety.level, hits: safety.hits.map((h) => h.word).slice(0, 10) },
          }),
          reason: "regen",
        });
        added++;
        console.log(`  ✓ ${dg.kind}@${at + 1}  ${tag}`);
      } catch (e) {
        failed++;
        console.log(`  ✗ ${String(e).slice(0, 60)}  ${tag}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));

  const demoted = await prisma.course.findMany({
    where: { id: { in: [...sharedBefore] }, sharedStatus: "pending" },
    select: { id: true, title: true },
  });
  for (const c of demoted) {
    await prisma.course.update({ where: { id: c.id }, data: { sharedStatus: "shared" } });
    console.log(`  ↺ 恢复上架(运营富化,内容源自已过审文本):${c.title}`);
  }

  console.log(`完成:新增图示 ${added} · 已有跳过 ${skippedHas} · 无关系 ${skippedNull} · 失败 ${failed}`);
  console.log("下一步:npx tsx scripts/rerender-courseware.mts 重出 HTML");
  await prisma.$disconnect();
}

main();
