/**
 * HTML 课件生成编排（v3.4）—— blocks 是内容真值，HTML 是可重建表现层。
 * premium 先试强模型 bespoke，任何预算/超时/安全/多样性失败都回落确定性渲染。
 */

import { createHash } from "node:crypto";
import { prisma } from "../db";
import { validateBlocks, type Block } from "../blocks";
import { chat, isLLMConfigured } from "../llm";
import { creditingOnUsage } from "../credits";
import { track } from "../analytics";
import { selectBespokeModel } from "./models";
import { resolveCourseDesign, serializeCourseDesign, type CourseDesign } from "./courseware-design";
import { resolveLessonVariance } from "./courseware-variance";
import { llmStyleBrief, resolveCoursewareMode, type CoursewareMode } from "./courseware-catalog";
import { goldenExemplar, exemplarNoteFor } from "./courseware-exemplars";
import {
  renderCoursewareHtml,
  buildContract,
  validateCoursewareHtml,
  enforceTrustedCsp,
  assessCoursewareDiversity,
  type CoursewareContract,
} from "./courseware-html";

const HTML_RENDER_VERSION = "v3.4.1";
const HTML_CLAIM_TTL_MS = 10 * 60_000;
const DEFAULT_PREMIUM_LESSON_BUDGET = 6;
const BESPOKE_TIMEOUT_MS = 45_000;

export interface CoursewareBudget {
  remaining: number;
}

export function createCoursewareBudget(maxLessons = Number(process.env.COURSEWARE_PREMIUM_MAX_LESSONS) || DEFAULT_PREMIUM_LESSON_BUDGET): CoursewareBudget {
  return { remaining: Math.max(0, Math.floor(maxLessons)) };
}

export interface HtmlGenResult {
  ok: boolean;
  contract: CoursewareContract | null;
  engine: "llm" | "deterministic" | "none";
  lintIssues?: string[];
  cacheHit?: boolean;
  sourceHash?: string;
  durationMs?: number;
}

interface StoreOptions {
  enhance?: boolean;
  userId?: string | null;
  model?: string | null;
  budget?: CoursewareBudget;
  force?: boolean;
}

function parseBlocks(blocksJson: string | null | undefined): (Block & { id: string })[] {
  if (!blocksJson) return [];
  try {
    const parsed = JSON.parse(blocksJson) as { blocks?: unknown };
    return validateBlocks(parsed?.blocks ?? parsed);
  } catch {
    return [];
  }
}

function renderSourceHash(input: { blocksJson: string | null; design: CourseDesign; mode?: CoursewareMode }): string {
  return createHash("sha256")
    .update(JSON.stringify({ version: HTML_RENDER_VERSION, blocks: input.blocksJson, design: serializeCourseDesign(input.design), mode: input.mode ?? "scroll-lesson" }))
    .digest("hex");
}

async function synthesizeViaLLM(
  design: CourseDesign,
  blocks: (Block & { id: string })[],
  title: string,
  userId: string,
  model: string,
): Promise<string | null> {
  if (!isLLMConfigured()) return null;
  const a = design.art;
  const mode = resolveCoursewareMode({ title, artKey: design.art.key });
  const system =
    "你是获奖级前端设计工程师，为一节自学课件产出一整页自包含 HTML（内联 CSS + 可选内联 JS）。\n" +
    "【硬性安全约束，违反即废弃】\n" +
    "- 输出必须是完整 HTML 文档，head 第一个元素必须是严格 CSP。\n" +
    "- 绝不引用外链资源；不得 fetch/XMLHttpRequest/WebSocket；图片只用内联 SVG 或 CSS。\n" +
    "- 必须含 prefers-reduced-motion；动画只动 transform/opacity；禁用 scroll 监听。\n" +
    "- 禁 Inter/Roboto/Arial、纯黑纯白背景、硬黑投影、占位垃圾与夸张营销词。\n" +
    `【视觉规格】艺术方向：${a.label}（${a.mood}）。底色 ${a.bg}，卡面 ${a.surface}，正文 ${a.ink}，强调 ${a.accent}。\n` +
    `标题字族：${a.fontDisplay}；正文：${a.fontBody}；圆角 ${a.radius}px；动效 ${design.motion}/10；密度 ${design.density}/10。\n` +
    llmStyleBrief(design, title) +
    exemplarNoteFor(mode) +
    "\n" + goldenExemplar(design) +
    "\n只输出 HTML，不要解释或代码围栏。";
  const user = `课件标题：《${title}》\n内容块 JSON：\n${JSON.stringify(blocks).slice(0, 12000)}\n请忠于内容，重排为多构图、高级、自包含 HTML。`;
  try {
    const raw = await chat({
      system,
      user,
      temperature: 0.7,
      maxTokens: 16000,
      timeoutMs: BESPOKE_TIMEOUT_MS,
      retries: 0,
      model,
      onUsage: creditingOnUsage(userId, "generate_lesson_html"),
    });
    const fence = raw.match(/```(?:html)?\s*([\s\S]*?)\s*```/i);
    const html = (fence ? fence[1] : raw).trim();
    return /^<!doctype html/i.test(html) || /^<html/i.test(html) ? html : null;
  } catch {
    return null;
  }
}

/** 后台主链入口：支持缓存、原子 claim、预算、强模型 bespoke 与确定性回落。 */
export async function renderAndStoreLessonHtml(
  courseId: string,
  lesson: {
    id: string;
    title: string;
    sortOrder?: number | null;
    blocksJson: string | null;
    htmlJson?: string | null;
    renderSourceHash?: string | null;
  },
  design: CourseDesign,
  mode?: CoursewareMode,
  opts: StoreOptions = {},
): Promise<HtmlGenResult> {
  const startedAt = Date.now();
  const blocks = parseBlocks(lesson.blocksJson);
  if (blocks.length === 0) return { ok: false, contract: null, engine: "none" };

  const sourceHash = renderSourceHash({ blocksJson: lesson.blocksJson, design, mode });
  if (!opts.force && lesson.htmlJson && lesson.renderSourceHash === sourceHash) {
    try {
      return { ok: true, contract: JSON.parse(lesson.htmlJson) as CoursewareContract, engine: "deterministic", cacheHit: true, sourceHash, durationMs: 0 };
    } catch {
      // 脏缓存继续重建。
    }
  }

  const staleBefore = new Date(Date.now() - HTML_CLAIM_TTL_MS);
  const claim = await prisma.lesson.updateMany({
    where: { id: lesson.id, OR: [{ htmlGenClaimedAt: null }, { htmlGenClaimedAt: { lt: staleBefore } }] },
    data: { htmlGenClaimedAt: new Date() },
  });
  if (claim.count === 0) return { ok: true, contract: null, engine: "none", sourceHash };

  const variance = resolveLessonVariance(courseId, lesson, design);
  const deterministic = renderCoursewareHtml({ title: lesson.title, blocks, design, variance, mode });
  let html = deterministic;
  let engine: HtmlGenResult["engine"] = "deterministic";
  let lintIssues: string[] | undefined;
  let rejectReason: string | null = null;

  try {
    if (opts.enhance) {
      if (!opts.userId) {
        rejectReason = "missing_user";
      } else if (opts.budget && opts.budget.remaining <= 0) {
        rejectReason = "course_budget_exhausted";
      } else {
        const strongModel = selectBespokeModel(opts.model);
        if (!strongModel) {
          rejectReason = "strong_model_unavailable";
        } else {
          if (opts.budget) opts.budget.remaining -= 1;
          const llm = await synthesizeViaLLM(design, blocks, lesson.title, opts.userId, strongModel.key);
          if (!llm) {
            rejectReason = "llm_timeout_or_invalid";
          } else {
            const safe = enforceTrustedCsp(llm);
            const lint = validateCoursewareHtml(safe);
            const diversity = assessCoursewareDiversity(safe);
            if (lint.ok && diversity.ok) {
              html = safe;
              engine = "llm";
            } else {
              lintIssues = [...lint.issues, ...diversity.reasons];
              rejectReason = lintIssues.join("；").slice(0, 500);
            }
          }
        }
      }
    }

    const contract = buildContract(html);
    const durationMs = Date.now() - startedAt;
    await prisma.lesson.update({
      where: { id: lesson.id },
      data: {
        htmlJson: JSON.stringify(contract),
        htmlGenClaimedAt: null,
        renderEngine: engine,
        renderRejectReason: rejectReason,
        renderSourceHash: sourceHash,
        renderDurationMs: durationMs,
      },
    });
    await track({
      eventName: "ai_gen_lesson_html",
      userId: opts.userId ?? undefined,
      properties: { courseId, lessonId: lesson.id, engine, artDirection: design.art.key, bytes: html.length, rejectReason, cacheHit: false, durationMs },
    });
    return { ok: true, contract, engine, lintIssues, cacheHit: false, sourceHash, durationMs };
  } catch (error) {
    await prisma.lesson.updateMany({ where: { id: lesson.id }, data: { htmlGenClaimedAt: null } }).catch(() => {});
    throw error;
  }
}

/** 鉴权按需入口，与后台主链复用同一个编排。 */
export async function generateLessonHtml(
  lessonId: string,
  userId: string,
  opts: { enhance?: boolean; model?: string | null; force?: boolean } = {},
): Promise<HtmlGenResult> {
  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, include: { course: true } });
  if (!lesson || !lesson.course) throw new Error("章节不存在");
  const course = lesson.course;
  if (course.authorUserId !== userId) throw new Error("无权操作该课程");

  const design = resolveCourseDesign(course);
  if (!course.designJson) {
    await prisma.course.update({ where: { id: course.id }, data: { designJson: serializeCourseDesign(design) } }).catch(() => {});
  }
  const mode = resolveCoursewareMode({ title: course.title, template: course.template, artKey: design.art.key });
  return renderAndStoreLessonHtml(course.id, lesson, design, mode, {
    enhance: Boolean(opts.enhance),
    userId,
    model: opts.model,
    budget: createCoursewareBudget(1),
    force: opts.force,
  });
}
