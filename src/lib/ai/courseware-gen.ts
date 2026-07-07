/**
 * HTML 课件生成编排（v3.3）—— 服务端。把「内容层 blocks」升级为「表现层 HTML 课件」。
 *
 * 流水线（见计划 §8）：解析课级设计系统 → Variance 抽签 → 确定性渲染（可靠引擎）→
 * 可选 LLM 增强（bespoke HTML，需模型可用）→ 安全/反slop 校验 → 不过则回落确定性渲染 → 打契约 → 落库。
 * 铁律：任何失败都回落，绝不让课件"空/崩"；内容层 blocksJson 始终保留作兜底与搜索。
 */

import { prisma } from "../db";
import { validateBlocks, type Block } from "../blocks";
import { chat, isLLMConfigured } from "../llm";
import { creditingOnUsage } from "../credits";
import { track } from "../analytics";
import { resolveCourseDesign, serializeCourseDesign, type CourseDesign } from "./courseware-design";
import { resolveLessonVariance } from "./courseware-variance";
import { llmStyleBrief, resolveCoursewareMode } from "./courseware-catalog";
import { goldenExemplar, exemplarNoteFor } from "./courseware-exemplars";
import {
  renderCoursewareHtml,
  buildContract,
  validateCoursewareHtml,
  enforceTrustedCsp,
  assessCoursewareDiversity,
  type CoursewareContract,
} from "./courseware-html";

export interface HtmlGenResult {
  ok: boolean;
  contract: CoursewareContract | null;
  /** 本次是走了 LLM bespoke 还是确定性渲染（回落）。 */
  engine: "llm" | "deterministic" | "none";
  /** 校验未过被拒时的问题列表（仅 LLM 路径）。 */
  lintIssues?: string[];
}

/**
 * 内部：给一节渲染确定性 HTML 课件并写 htmlJson（无鉴权、best-effort，供后台造课流水调用）。
 * 已有块才渲染；无块跳过。不动 contentType。任何异常由调用方 try/catch 吞掉，绝不打断块生成。
 * 返回是否写入。
 */
export async function renderAndStoreLessonHtml(
  courseId: string,
  lesson: { id: string; title: string; sortOrder?: number | null; blocksJson: string | null },
  design: CourseDesign,
): Promise<boolean> {
  const blocks = parseBlocks(lesson.blocksJson);
  if (blocks.length === 0) return false;
  const variance = resolveLessonVariance(courseId, lesson, design);
  const html = renderCoursewareHtml({ title: lesson.title, blocks, design, variance });
  const contract = buildContract(html);
  await prisma.lesson.update({ where: { id: lesson.id }, data: { htmlJson: JSON.stringify(contract) } });
  return true;
}

/** 从 blocksJson 取回内容块（脏数据经 validateBlocks 过滤，空则返回 []）。 */
function parseBlocks(blocksJson: string | null | undefined): (Block & { id: string })[] {
  if (!blocksJson) return [];
  try {
    const parsed = JSON.parse(blocksJson) as { blocks?: unknown };
    return validateBlocks(parsed?.blocks ?? parsed);
  } catch {
    return [];
  }
}

/**
 * LLM 增强：让模型产出 bespoke 的自包含 HTML（在确定性渲染的基础上追求上限）。
 * 强约束契约（CSP/内联/无外链/reduce-motion/GPU 安全），产物必须过 validateCoursewareHtml，否则丢弃。
 * 未配置模型 → 返回 null（走确定性回落）。
 */
async function synthesizeViaLLM(
  design: CourseDesign,
  blocks: (Block & { id: string })[],
  title: string,
  userId: string,
  model?: string | null,
): Promise<string | null> {
  if (!isLLMConfigured()) return null;
  const a = design.art;
  const system =
    "你是获奖级前端设计工程师，为一节自学课件产出**一整页自包含 HTML**（内联 CSS + 可选内联 JS）。\n" +
    "【硬性安全约束，违反即废弃】\n" +
    "- 输出必须是完整 HTML 文档，<head> 第一个元素必须是这条 CSP：\n" +
    `  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">\n` +
    "- 绝不引用任何外链资源（无 http/https 的 src/href/url()）；不得出现 fetch/XMLHttpRequest/WebSocket；图片只用内联 SVG 或 CSS。\n" +
    "- 必须含 @media (prefers-reduced-motion: reduce) 分支；动画只动 transform / opacity（禁动 top/left/width/height）；禁用 scroll 事件监听，滚动入场用 IntersectionObserver。\n" +
    "- 禁用字体 Inter/Roboto/Arial；禁纯黑纯白背景；禁硬黑投影 rgba(0,0,0,0.1+)；禁占位垃圾与夸张营销词。\n" +
    "【视觉规格（本课设计系统，严格遵守，冲突时以此为准）】\n" +
    `- 艺术方向：${a.label}（${a.mood}）。底色 ${a.bg}，卡面 ${a.surface}，正文 ${a.ink}，强调 ${a.accent}。\n` +
    `- 标题字族：${a.fontDisplay}；正文：${a.fontBody}；圆角基准 ${a.radius}px；缓动 ${a.ease}。\n` +
    `- 动效强度 ${design.motion}/10，视觉密度 ${design.density}/10（密度低=更大留白）。\n` +
    "- 要有编辑级排版层级、macro 留白、入场动效、交互（quiz 判分/记忆卡翻转），高级不廉价。\n" +
    // 吸收 20 源模板侦察：按内容类型 mode 注入呈现风格指令，让 bespoke HTML 贴合内容而非千篇一律。
    llmStyleBrief(design, title) +
    exemplarNoteFor(resolveCoursewareMode({ title, artKey: design.art.key })) +
    // few-shot：给一个自包含+页型分化+内联SVG+终端+reduce-motion 都齐全的黄金骨架，对标其完备度（风格按本课方向重做）。
    "\n" +
    goldenExemplar(design) +
    "\n只输出 HTML，不要任何解释文字或代码围栏。";
  const user =
    `课件标题：《${title}》\n本节内容块（JSON，作为你的内容素材，忠于其信息，可重排版式但不虚构）：\n` +
    JSON.stringify(blocks).slice(0, 12000) +
    `\n请据此产出一页多样、有动效、高级的自包含 HTML 课件。`;
  try {
    const raw = await chat({
      system,
      user,
      temperature: 0.7,
      maxTokens: 16000,
      model: model ?? undefined,
      onUsage: creditingOnUsage(userId, "generate_lesson_html"),
    });
    // 抽取 HTML（容忍模型偶尔包代码围栏）。
    const fence = raw.match(/```(?:html)?\s*([\s\S]*?)\s*```/i);
    const html = (fence ? fence[1] : raw).trim();
    if (!/^<!doctype html/i.test(html) && !/^<html/i.test(html)) return null;
    return html;
  } catch {
    return null;
  }
}

/**
 * 为一节生成 HTML 课件并落库。
 *
 * 契约：
 * - 越权铁律：按 lessonId 重拉，校验 course.authorUserId === userId。
 * - 需要内容：本节 blocksJson 必须已有块（HTML 是 blocks 的表现层）；无块直接返回 ok:false（调用方先造块）。
 * - engine：默认确定性渲染（可靠、免费、可复现）；opts.enhance 且模型可用时先试 LLM bespoke，过校验才用，否则回落。
 * - 落库：只写 Lesson.htmlJson（渲染契约），**不动 contentType**（保持 ai_block 让 iOS 继续原生渲染 blocks，
 *   Web 凭 htmlJson 渲染 HTML 课件）；持久化 Course.designJson（若缺）。
 */
export async function generateLessonHtml(
  lessonId: string,
  userId: string,
  opts: { enhance?: boolean; model?: string | null } = {},
): Promise<HtmlGenResult> {
  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, include: { course: true } });
  if (!lesson || !lesson.course) throw new Error("章节不存在");
  const course = lesson.course;
  if (course.authorUserId !== userId) throw new Error("无权操作该课程");

  const blocks = parseBlocks(lesson.blocksJson);
  if (blocks.length === 0) return { ok: false, contract: null, engine: "none" };

  // 课级设计系统（确定性；无 designJson 的课也能解析），并持久化以便之后稳定不漂移。
  const design = resolveCourseDesign(course);
  if (!course.designJson) {
    await prisma.course.update({ where: { id: course.id }, data: { designJson: serializeCourseDesign(design) } }).catch(() => {});
  }
  const variance = resolveLessonVariance(course.id, lesson, design);

  // —— 确定性渲染（永远先得到一个可靠可用的 HTML）——
  const deterministic = renderCoursewareHtml({ title: lesson.title, blocks, design, variance });

  let html = deterministic;
  let engine: HtmlGenResult["engine"] = "deterministic";
  let lintIssues: string[] | undefined;

  // —— 可选 LLM 增强：过安全/反slop 校验才采用，否则回落确定性 ——
  if (opts.enhance) {
    const llm = await synthesizeViaLLM(design, blocks, lesson.title, userId, opts.model ?? course.modelUsed);
    if (llm) {
      // 安全铁律：绝不信任模型自带 CSP —— 强制注入我方可信 CSP（剥离模型的），再过双闸门才采用。
      const safe = enforceTrustedCsp(llm);
      const lint = validateCoursewareHtml(safe); // ① 安全/反slop
      const diversity = assessCoursewareDiversity(safe); // ② 多样性（防纯文字墙/同底色堆叠）
      if (lint.ok && diversity.ok) {
        html = safe;
        engine = "llm";
      } else {
        // 任一闸门不过 → 回落确定性渲染器（它天生分化）；记录被拒原因供排障。
        lintIssues = [...lint.issues, ...diversity.reasons];
      }
    }
  }

  const contract = buildContract(html);
  // 只写 htmlJson，不动 contentType：保持 ai_block 让 iOS 继续原生渲染 blocks，Web 凭 htmlJson 渲染 HTML 课件。
  await prisma.lesson.update({
    where: { id: lesson.id },
    data: { htmlJson: JSON.stringify(contract) },
  });

  await track({
    eventName: "ai_gen_lesson_html",
    userId,
    properties: {
      courseId: course.id,
      lessonId: lesson.id,
      engine,
      artDirection: design.art.key,
      bytes: html.length,
      lintRejected: Boolean(lintIssues),
    },
  });

  return { ok: true, contract, engine, lintIssues };
}
