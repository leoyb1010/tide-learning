/**
 * v6 内容验收：真实模型为同一门课连续写三节，必须保留原始需求、避免重复，并通过内容/教学双评审。
 * 临时用户、积分账户、课程与用量记录在结束时级联清理；KEEP_ACCEPTANCE_COURSE=1 可保留现场。
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { generateLessonCore } from "../src/lib/course-gen";
import { createCourseContentBrief, serializeCourseContentBrief } from "../src/lib/ai/content-brief";
import { validateBlocks } from "../src/lib/blocks";

const stamp = Date.now();
const user = await prisma.user.create({
  data: {
    email: `content-acceptance-${stamp}@local.invalid`,
    nickname: "内容质量验收",
    creditAccount: { create: { balance: 100_000, totalEarned: 100_000 } },
  },
});

const brief = createCourseContentBrief({
  request: "为有两年经验的产品经理设计一门用户访谈实战课。不要讲泛泛的用户中心理论，重点训练从含糊表达追到具体行为，再把原话整理成可证伪的产品判断。每节都要有真实访谈语句和可提交练习。",
  plan: {
    learnerOutcome: "独立完成一次 20 分钟访谈，并交付带证据等级的访谈记录",
    scope: "访谈追问、行为时间线、证据与假设分离",
    prerequisites: "做过基础需求分析，尚未系统训练访谈",
    capstone: "根据一段访谈逐字稿形成事实、解释、假设三栏记录",
    exclusions: ["问卷统计", "大样本研究", "营销话术"],
    planningRationale: "先纠正提问直觉，再练行为还原，最后完成证据判断",
  },
});

const course = await prisma.course.create({
  data: {
    slug: `v6-content-acceptance-${stamp}`,
    title: "把用户原话变成产品证据",
    description: "真实模型内容质量验收课",
    category: "ai_skill",
    level: "L2",
    status: "draft",
    origin: "ai_generated",
    authorUserId: user.id,
    ownerId: user.id,
    visibility: "private",
    genStatus: "generating",
    qualityTier: "premium",
    modelUsed: "deepseek-chat",
    contentBriefJson: serializeCourseContentBrief(brief),
  },
});

const specs = [
  {
    title: "先不问方案：从含糊抱怨找到可验证事实",
    summary: "能把一句抽象评价改写为追问真实事件的访谈路径",
  },
  {
    title: "追问不是多问：用时间线重建一次真实行为",
    summary: "能用时间、触发、动作和结果还原一段完整行为链",
  },
  {
    title: "从一句原话到产品判断：分开事实、解释与假设",
    summary: "能为访谈记录标注证据等级，并写出可证伪的下一步假设",
  },
];

const lessons = [] as { id: string; title: string }[];
for (const [sortOrder, spec] of specs.entries()) {
  lessons.push(await prisma.lesson.create({
    data: {
      courseId: course.id,
      sortOrder,
      title: spec.title,
      summary: spec.summary,
      contentType: "ai_block",
      status: "published",
      isFree: sortOrder === 0,
    },
    select: { id: true, title: true },
  }));
}
// 保持一节空课，避免最后一节触发 HTML 表现层生成；本脚本只验内容主链。
await prisma.lesson.create({
  data: {
    courseId: course.id,
    sortOrder: specs.length,
    title: "验收占位，不生成",
    summary: "仅用于阻止内容验收触发表现层",
    contentType: "ai_block",
    status: "draft",
  },
});

try {
  for (const lesson of lessons) {
    const result = await generateLessonCore(lesson.id, user.id);
    if (!result.ok) console.warn(`[accept:content] ${lesson.title} 未通过：quality=${result.qualityScore}`);
  }

  const rows = await prisma.lesson.findMany({
    where: { id: { in: lessons.map((lesson) => lesson.id) } },
    orderBy: { sortOrder: "asc" },
    select: { title: true, blocksJson: true, qualityJson: true },
  });
  const report = rows.map((row) => {
    const blocks = validateBlocks(JSON.parse(row.blocksJson || "{}")).map((block) => block.type);
    const quality = JSON.parse(row.qualityJson || "{}") as {
      passed?: boolean;
      status?: string;
      regen?: { attempts?: number };
      judge?: {
        passed?: boolean;
        judged?: boolean;
        depth?: number;
        relevance?: number;
        specificity?: number;
        teaching?: number;
        assessment?: number;
        transfer?: number;
        agents?: { content?: boolean; teaching?: boolean };
        issues?: string[];
      };
    };
    return {
      title: row.title,
      blocks,
      signature: blocks.join("→"),
      chars: row.blocksJson?.length ?? 0,
      status: quality.status,
      attempts: quality.regen?.attempts,
      judge: quality.judge,
      passed: quality.passed === true,
    };
  });
  console.log(JSON.stringify({ courseId: course.id, lessons: report }, null, 2));
  const signatures = new Set(report.map((row) => row.signature));
  const failed = report.filter((row) =>
    !row.passed ||
    row.status !== "passed" ||
    row.chars < 1400 ||
    !row.judge?.agents?.content ||
    !row.judge?.agents?.teaching,
  );
  if (failed.length || signatures.size !== report.length) {
    console.error(JSON.stringify({ failed: failed.map((row) => row.title), distinctSignatures: signatures.size }, null, 2));
    process.exitCode = 1;
  }
} finally {
  if (process.env.KEEP_ACCEPTANCE_COURSE !== "1") {
    await prisma.course.delete({ where: { id: course.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }
  await prisma.$disconnect();
}
