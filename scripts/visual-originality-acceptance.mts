/** v6 验收：同一课程 5 种教学动作必须全部走 LLM，并生成 5 套独立逐节设计。 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { validateBlocks } from "../src/lib/blocks";
import { renderCourseHtmlBestEffort } from "../src/lib/course-gen";

const stamp = Date.now();
const user = await prisma.user.create({
  data: {
    email: `visual-acceptance-${stamp}@local.invalid`,
    nickname: "视觉原创性验收",
    creditAccount: { create: { balance: 100_000, totalEarned: 100_000 } },
  },
});
const slug = `v6-visual-acceptance-${stamp}`;
const course = await prisma.course.create({
  data: {
    slug,
    title: "内容真值与自由表现：五节视觉验收",
    category: "ai_skill",
    level: "L2",
    status: "draft",
    origin: "user_created",
    authorUserId: user.id,
    ownerId: user.id,
    visibility: "private",
    genStatus: "ready",
    qualityTier: "premium",
  },
});

const specs: Array<{ title: string; summary: string; blocks: unknown[] }> = [
  {
    title: "冲突：为什么模板会吞掉内容个性",
    summary: "通过冲突叙事建立问题意识",
    blocks: [
      { type: "scene", title: "看似整齐的代价", markdown: "五门不同的课，却拥有完全相同的剪影。" },
      { type: "dialog", turns: [{ speaker: "创作者", text: "为什么改了提示词，页面还是同一张脸？" }, { speaker: "系统", text: "因为你只能往固定格子里填字。" }] },
      { type: "quiz", question: "真正的瓶颈是什么？", options: ["token 太少", "原创决策权被硬编码收走"], answerIndex: 1, explain: "视觉结构没有交给模型。" },
    ],
  },
  {
    title: "机制：内容真值与表现层如何解耦",
    summary: "用系统图理解双层架构",
    blocks: [
      { type: "concept", title: "内容真值", markdown: "blocks 保存事实、判分和复习锚点。" },
      { type: "diagram", kind: "flow", title: "双层流水", items: [{ label: "内容块", detail: "可校验" }, { label: "设计系统", detail: "逐节原创" }, { label: "HTML", detail: "可重建" }], note: "真值稳定，表达自由。" },
      { type: "fillblank", prompt: "补全原则", segments: ["内容负责", "，表现负责表达。"], blanks: [["事实", "真值"]] },
    ],
  },
  {
    title: "实战：导演一节有迁移任务的技能课",
    summary: "用操作步骤完成真实产出",
    blocks: [
      { type: "steps", steps: [{ title: "明确受众", detail: "写下已有知识和真实任务。" }, { title: "选择动作", detail: "只保留必要的解释、示范与练习。" }, { title: "设计迁移", detail: "让学员在新情境复用方法。" }] },
      { type: "example", markdown: "例：把按钮设计原则迁移到表单提交场景。" },
      { type: "dragwords", prompt: "组成闭环", segments: ["先", "，再验证，最后迁移。"], blanks: ["示范"], distractors: ["装饰", "堆叠"] },
    ],
  },
  {
    title: "诊断：读懂一次失败的设计评审",
    summary: "从对照和证据定位问题",
    blocks: [
      { type: "compare", title: "评审差异", left: { heading: "模板评分", items: ["检查固定块型", "奖励统一骨架"] }, right: { heading: "体验评审", items: ["检查可读层级", "判断设计是否服务内容"] } },
      { type: "callout", tone: "warn", markdown: "不要把个人审美伪装成安全标准。" },
      { type: "flashcard", front: "设计闸门应该拦什么？", back: "不可读、不安全与协议违规，而不是不熟悉的风格。" },
    ],
  },
  {
    title: "迁移：为下一门课程建立原创原则",
    summary: "以宣言式收束促成迁移",
    blocks: [
      { type: "keypoint", points: ["模板是地板，不是创意天花板", "同一家族可以变奏，不必同脸", "内容真值永远可重建"] },
      { type: "formula", latex: "Quality = Truth \\times Expression", display: true, caption: "质量来自可信内容与原创表达" },
      { type: "summary", markdown: "为下一门课写下一个只属于它的设计原则。", next: "从原则出发，而不是从皮肤列表出发。" },
    ],
  },
];

try {
  for (const [sortOrder, spec] of specs.entries()) {
    await prisma.lesson.create({
      data: {
        courseId: course.id,
        sortOrder,
        title: spec.title,
        summary: spec.summary,
        contentType: "ai_block",
        status: "published",
        publishedAt: new Date(),
        isFree: sortOrder === 0,
        blocksJson: JSON.stringify({ version: 1, blocks: validateBlocks(spec.blocks) }),
      },
    });
  }
  await renderCourseHtmlBestEffort(course.id);
  const lessons = await prisma.lesson.findMany({
    where: { courseId: course.id },
    orderBy: { sortOrder: "asc" },
    select: { title: true, renderEngine: true, renderRejectReason: true, designJson: true },
  });
  const result = lessons.map((lesson) => {
    const design = JSON.parse(lesson.designJson || "{}") as {
      direction?: string;
      font?: string;
      layoutStrategy?: string;
      motif?: string;
      palette?: { accent?: { hex?: string } };
    };
    return {
      title: lesson.title,
      engine: lesson.renderEngine,
      reject: lesson.renderRejectReason,
      direction: design.direction,
      font: design.font,
      layout: design.layoutStrategy,
      motif: design.motif,
      accent: design.palette?.accent?.hex,
    };
  });
  console.log(JSON.stringify({ courseId: course.id, slug, lessons: result }, null, 2));
  const creativeSignatures = new Set(result.map((lesson) =>
    [lesson.direction, lesson.layout, lesson.motif, lesson.accent].join("｜"),
  ));
  if (
    result.some((lesson) => lesson.engine !== "llm" || lesson.reject || !lesson.direction || !lesson.layout || !lesson.motif) ||
    creativeSignatures.size !== result.length
  ) process.exitCode = 1;
} finally {
  if (process.env.KEEP_ACCEPTANCE_COURSE !== "1") await prisma.course.delete({ where: { id: course.id } }).catch(() => {});
  if (process.env.KEEP_ACCEPTANCE_COURSE !== "1") await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  await prisma.$disconnect();
}
