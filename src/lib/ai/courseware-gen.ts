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
import { selectBespokeModel, bespokeTimeoutMs, maxOutputOf, type LlmModelEntry } from "./models";
import { resolveCourseDesign, serializeCourseDesign, type CourseDesign } from "./courseware-design";
import { resolveLessonVariance } from "./courseware-variance";
import { llmStyleBrief, resolveCoursewareMode, type CoursewareMode } from "./courseware-catalog";
import { goldenExemplar, exemplarNoteFor } from "./courseware-exemplars";
import {
  renderCoursewareHtml,
  buildContract,
  splitCoursewareLint,
  normalizeCoursewareStyle,
  injectBespokeAdapter,
  enforceTrustedCsp,
  assessCoursewareDiversity,
  scoreCoursewareVisual,
  type CoursewareContract,
} from "./courseware-html";
import { ensureHighlighter } from "./courseware-highlight";

const HTML_RENDER_VERSION = "v4.3.0"; // v4.3 吸收：shiki 代码高亮 + heti CJK 排版 + KaTeX 公式 + diagram 语义图示 + 交互块
const HTML_CLAIM_TTL_MS = 10 * 60_000;
const DEFAULT_PREMIUM_LESSON_BUDGET = 6;

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
  model: LlmModelEntry,
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
    // 蓝图 A5：宿主协议由平台注入，模型不必自造；测验/记忆卡走约定结构，平台适配层才能判分回传。
    "【平台协议（不要自己实现）】翻页、高度上报、与宿主页面的通信由平台注入的运行时负责，你不需要写任何 postMessage。\n" +
    "选择题请用结构：<div class=\"quiz\" data-answer=\"正确项下标\" data-bid=\"该题在内容块 JSON 里的 id\"><button class=\"opt\">…</button>…</div>（样式随你设计）；" +
    "记忆卡外层用 class=\"fc\" data-bid=\"对应块 id\"。data-bid 必须原样抄内容块 JSON 的 id 字段，平台靠它把作答结果记入学员的错题本。\n" +
    `【视觉规格】艺术方向：${a.label}（${a.mood}）。底色 ${a.bg}，卡面 ${a.surface}，正文 ${a.ink}，强调 ${a.accent}。\n` +
    `标题字族：${a.fontDisplay}；正文：${a.fontBody}；圆角 ${a.radius}px；动效 ${design.motion}/10；密度 ${design.density}/10。\n` +
    llmStyleBrief(design, title) +
    exemplarNoteFor(mode) +
    "\n" + goldenExemplar(design) +
    "\n只输出 HTML，不要解释或代码围栏。";
  // 蓝图 A7：输入截断随模型产出预算放大——大杯模型给全量块（此前 12000 一刀切会截掉长课的后半内容）。
  const inputCap = maxOutputOf(model) >= 32000 ? 24000 : 12000;
  const user = `课件标题：《${title}》\n内容块 JSON：\n${JSON.stringify(blocks).slice(0, inputCap)}\n请忠于内容，重排为多构图、高级、自包含 HTML。`;
  try {
    const raw = await chat({
      system,
      user,
      temperature: 0.7,
      // 蓝图 A1/A7：产出与超时随模型元数据，retries 1（此前 45s+0 重试把慢而强的模型全部反向淘汰）。
      maxTokens: Math.min(maxOutputOf(model), 24000),
      timeoutMs: bespokeTimeoutMs(model),
      retries: 1,
      model: model.key,
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
  // shiki 单例：同步渲染前 ensure 一次（幂等），之后 renderBlock 的 code 块可同步取 token 着色。
  // 失败不阻断（highlightLinesSync 会返回 null，回落手写高亮）。
  await ensureHighlighter().catch(() => {});
  const deterministic = renderCoursewareHtml({ title: lesson.title, blocks, design, variance, mode });
  let html = deterministic;
  let engine: HtmlGenResult["engine"] = "deterministic";
  let lintIssues: string[] | undefined;
  let rejectReason: string | null = null;

  // 单次预取（审计修复 D4/B5 合并）：旧质量档案供 merge、旧 renderEngine 供 bespoke 复用判定。
  const prior = await prisma.lesson.findUnique({
    where: { id: lesson.id },
    select: { qualityJson: true, renderEngine: true },
  });

  try {
    if (opts.enhance) {
      // 审计修复 B5：渲染版本翻代/设计微调导致的缓存失效，不应把已花钱产出的 bespoke HTML
      // 重烧一遍 LLM——旧产物本身是 LLM 精修结果，重新过「CSP→自愈→分级 lint→注壳」管线即可升级，
      // 零 LLM 成本、零二次扣费。管线不过（如旧产物含新硬门违规）再走正常精修/回落。
      if (prior?.renderEngine === "llm" && lesson.htmlJson) {
        try {
          const oldHtml = (JSON.parse(lesson.htmlJson) as { html?: string }).html ?? "";
          if (oldHtml) {
            const healedOld = normalizeCoursewareStyle(enforceTrustedCsp(oldHtml));
            const lintOld = splitCoursewareLint(healedOld.html);
            const divOld = assessCoursewareDiversity(healedOld.html);
            if (lintOld.security.length === 0 && divOld.ok) {
              html = injectBespokeAdapter(healedOld.html);
              engine = "llm";
              lintIssues = healedOld.fixes.length > 0 ? healedOld.fixes.map((f) => `复用旧精修+自愈:${f}`) : undefined;
            }
          }
        } catch {
          // 旧契约损坏 → 走正常精修
        }
      }
    }
    if (opts.enhance && engine !== "llm") {
      if (!opts.userId) {
        rejectReason = "missing_user";
      } else if (opts.budget && opts.budget.remaining <= 0) {
        rejectReason = "course_budget_exhausted";
      } else {
        // 蓝图 A2：opts.model（用户选的生成模型）只是偏好——在白名单且可用就沿用，
        // 否则回落白名单首个可用强模型；不再让 premium 因模型不在白名单而拿确定性兜底。
        const strongModel = selectBespokeModel(opts.model);
        if (!strongModel) {
          rejectReason = "strong_model_unavailable";
        } else {
          if (opts.budget) opts.budget.remaining -= 1;
          const llm = await synthesizeViaLLM(design, blocks, lesson.title, opts.userId, strongModel);
          if (!llm) {
            rejectReason = "llm_timeout_or_invalid";
          } else {
            // 蓝图 A4 自愈流：先注 CSP → 风格软违规机械修正 → 分级 lint。
            // security 违规仍一票拒收回落确定性；style 残留只记录观测，不再白扔整节产出。
            const safe = enforceTrustedCsp(llm);
            const healed = normalizeCoursewareStyle(safe);
            const lint = splitCoursewareLint(healed.html);
            const diversity = assessCoursewareDiversity(healed.html);
            if (lint.security.length === 0 && diversity.ok) {
              // 蓝图 A5：注入协议壳（高度上报/握手/判分回传），bespoke 从「孤岛页」变「合约课件」。
              html = injectBespokeAdapter(healed.html);
              engine = "llm";
              if (healed.fixes.length > 0 || lint.style.length > 0) {
                lintIssues = [...healed.fixes.map((f) => `已自愈:${f}`), ...lint.style];
              }
            } else {
              lintIssues = [...lint.security, ...lint.style, ...diversity.reasons];
              rejectReason = [...lint.security, ...diversity.reasons].join("；").slice(0, 500);
            }
          }
        }
      }
    }

    const contract = buildContract(html);
    const durationMs = Date.now() - startedAt;

    // —— 蓝图 S1：轻版本化——覆盖旧课件前存档（保留最近 3 版），重渲染有「后悔药」。
    if (lesson.htmlJson) {
      try {
        await prisma.lessonRevision.create({
          data: { lessonId: lesson.id, htmlJson: lesson.htmlJson, blocksJson: null, reason: "rerender" },
        });
        const keep = await prisma.lessonRevision.findMany({
          where: { lessonId: lesson.id },
          orderBy: { createdAt: "desc" },
          take: 3,
          select: { id: true },
        });
        await prisma.lessonRevision.deleteMany({
          where: { lessonId: lesson.id, id: { notIn: keep.map((r) => r.id) } },
        });
      } catch {
        // 存档失败不阻塞渲染主链
      }
    }

    // —— 蓝图 C2：视觉高级分入档（与内容层质量分并存于 qualityJson.visual；prior 已在上方单次预取）——
    const visual = scoreCoursewareVisual(html);
    let mergedQualityJson: string | undefined;
    try {
      const parsedQ = prior?.qualityJson ? (JSON.parse(prior.qualityJson) as Record<string, unknown>) : {};
      mergedQualityJson = JSON.stringify({ ...parsedQ, visual: { ...visual, engine } });
    } catch {
      mergedQualityJson = JSON.stringify({ visual: { ...visual, engine } });
    }

    await prisma.lesson.update({
      where: { id: lesson.id },
      data: {
        htmlJson: JSON.stringify(contract),
        htmlGenClaimedAt: null,
        renderEngine: engine,
        renderRejectReason: rejectReason,
        renderSourceHash: sourceHash,
        renderDurationMs: durationMs,
        ...(mergedQualityJson ? { qualityJson: mergedQualityJson } : {}),
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
