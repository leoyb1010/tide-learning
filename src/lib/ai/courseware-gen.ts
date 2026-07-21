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
import { resolveCoursewareMode, type CoursewareMode } from "./courseware-catalog";
import {
  creativeDesignPrompt,
  generateLessonCreativeDesign,
  parseCreativeDesign,
  serializeCreativeDesign,
  verifyCreativeDesignUsage,
  type LessonCreativeDesign,
} from "./courseware-creative-design";
import { judgeCoursewareDesign, type CoursewareDesignVerdict } from "./courseware-design-judge";
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

const HTML_RENDER_VERSION = "v6.0.0"; // v6：逐节设计 Agent 原创 token + LLM 默认表现层；确定性引擎仅兜底
const HTML_CLAIM_TTL_MS = 10 * 60_000;

export interface CoursewareBudget {
  remaining: number;
}

/**
 * 默认不限制整课 bespoke 节数。若运维需要临时熔断，可显式设置 COURSEWARE_PREMIUM_MAX_LESSONS。
 * 0、非法值或未设置均表示不限；这是容量逃生门，不是产品质量档。
 */
export function createCoursewareBudget(maxLessons?: number): CoursewareBudget {
  const configured = maxLessons ?? Number(process.env.COURSEWARE_PREMIUM_MAX_LESSONS);
  const remaining = Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : Number.POSITIVE_INFINITY;
  return { remaining };
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
  courseTitle?: string;
  category?: string | null;
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

function renderSourceHash(input: { blocksJson: string | null; design: CourseDesign; lessonDesignJson?: string | null; mode?: CoursewareMode }): string {
  return createHash("sha256")
    .update(JSON.stringify({
      version: HTML_RENDER_VERSION,
      blocks: input.blocksJson,
      fallbackDesign: serializeCourseDesign(input.design),
      lessonDesign: input.lessonDesignJson ?? null,
      mode: input.mode ?? "scroll-lesson",
    }))
    .digest("hex");
}

async function synthesizeViaLLM(
  creativeDesign: LessonCreativeDesign,
  blocks: (Block & { id: string })[],
  title: string,
  userId: string,
  model: LlmModelEntry,
  correctionIssues: string[] = [],
): Promise<string | null> {
  if (!isLLMConfigured()) return null;
  const system =
    "你是获奖级课程体验设计师与前端工程师，为一节自学课件产出一整页原创、自包含 HTML（内联 CSS + 可选内联 JS）。\n" +
    "你不是往模板填内容。先理解内容的教学动作，再决定页面节奏、信息层级和交互；不同内容必须长出不同结构。\n" +
    "【硬性安全约束，违反即废弃】\n" +
    "- 输出必须是完整 HTML 文档，head 第一个元素必须是严格 CSP。\n" +
    "- 绝不引用外链资源；不得 fetch/XMLHttpRequest/WebSocket；图片只用内联 SVG/CSS，或原样使用内容块里的 /api/assets/<id> 站内素材路径。\n" +
    "- 必须含 prefers-reduced-motion；动画只动 transform/opacity；禁用 scroll 监听。\n" +
    "- 字体、色板和动效必须使用下方已校验的本节原创 token；不要自行换回常见 AI 紫蓝或通用卡片模板。\n" +
    // 蓝图 A5：宿主协议由平台注入，模型不必自造；测验/记忆卡走约定结构，平台适配层才能判分回传。
    "【平台协议（不要自己实现）】翻页、高度上报、与宿主页面的通信由平台注入的运行时负责，你不需要写任何 postMessage。\n" +
    "选择题请用结构：<div class=\"quiz\" data-answer=\"正确项下标\" data-bid=\"该题在内容块 JSON 里的 id\"><button class=\"opt\">…</button>…</div>（样式随你设计）；" +
    "quiz 若有 branchTargets，给对应 .opt 加 data-ct-target=目标课节 id；choice/branch/hotspot 的可点击选项必须带 data-ct-target=targetLessonId。" +
    "记忆卡外层用 class=\"fc\" data-bid=\"对应块 id\"。data-bid 必须原样抄内容块 JSON 的 id 字段，平台靠它把作答结果记入学员的错题本。\n" +
    creativeDesignPrompt(creativeDesign) +
    (correctionIssues.length > 0
      ? `\n【上一版未通过安全/协议闸门】请完整重做，不要局部打补丁：${correctionIssues.join("；").slice(0, 1000)}\n`
      : "") +
    "\n只输出 HTML，不要解释或代码围栏。";
  // 蓝图 A7：输入截断随模型产出预算放大——大杯模型给全量块（此前 12000 一刀切会截掉长课的后半内容）。
  const inputCap = maxOutputOf(model) >= 32000 ? 24000 : 12000;
  const user =
    `课件标题：《${title}》\n内容块 JSON：\n${JSON.stringify(blocks).slice(0, inputCap)}\n` +
    "blocks 是内容真值与判分锚点，不是页面骨架。请完整保留知识与 quiz/flashcard 的 data-bid 对应关系，" +
    "但可自由决定展示层章节、构图、叙事顺序和交互形式。";
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
    summary?: string | null;
    sortOrder?: number | null;
    blocksJson: string | null;
    htmlJson?: string | null;
    renderSourceHash?: string | null;
    renderEngine?: string | null;
    designJson?: string | null;
  },
  design: CourseDesign,
  mode?: CoursewareMode,
  opts: StoreOptions = {},
): Promise<HtmlGenResult> {
  const startedAt = Date.now();
  const blocks = parseBlocks(lesson.blocksJson);
  if (blocks.length === 0) return { ok: false, contract: null, engine: "none" };

  let creativeDesign = parseCreativeDesign(lesson.designJson);
  let lessonDesignJson = creativeDesign ? serializeCreativeDesign(creativeDesign) : null;
  let sourceHash = renderSourceHash({ blocksJson: lesson.blocksJson, design, lessonDesignJson, mode });
  // 确定性回落不是 enhance 请求的终态：后续重跑仍应继续尝试 LLM，不能被 fallback 缓存永久截住。
  const cacheSatisfiesRequest = !opts.enhance || lesson.renderEngine === "llm";
  if (!opts.force && cacheSatisfiesRequest && lesson.htmlJson && lesson.renderSourceHash === sourceHash) {
    try {
      return {
        ok: true,
        contract: JSON.parse(lesson.htmlJson) as CoursewareContract,
        engine: lesson.renderEngine === "llm" ? "llm" : "deterministic",
        cacheHit: true,
        sourceHash,
        durationMs: 0,
      };
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
  let strongModel: LlmModelEntry | null = null;
  let designVerdict: CoursewareDesignVerdict | null = null;

  // 单次预取（审计修复 D4/B5 合并）：旧质量档案供 merge、旧 renderEngine 供 bespoke 复用判定。
  const prior = await prisma.lesson.findUnique({
    where: { id: lesson.id },
    select: { qualityJson: true, renderEngine: true, designJson: true },
  });

  try {
    if (opts.enhance) {
      if (!opts.userId) {
        rejectReason = "missing_user";
      } else if (opts.budget && opts.budget.remaining <= 0) {
        rejectReason = "course_capacity_limit";
      } else {
        strongModel = selectBespokeModel(opts.model);
        if (!strongModel) {
          rejectReason = "strong_model_unavailable";
        } else if (!creativeDesign || opts.force) {
          if (opts.budget && Number.isFinite(opts.budget.remaining)) opts.budget.remaining -= 1;
          const previousRows = typeof lesson.sortOrder === "number"
            ? await prisma.lesson.findMany({
                where: { courseId, sortOrder: { lt: lesson.sortOrder }, designJson: { not: null } },
                orderBy: { sortOrder: "desc" },
                take: 3,
                select: { designJson: true },
              })
            : [];
          const generated = await generateLessonCreativeDesign({
            courseTitle: opts.courseTitle ?? courseId,
            category: opts.category,
            lessonTitle: lesson.title,
            objective: lesson.summary,
            blocks,
            previousDesigns: previousRows.map((row) => parseCreativeDesign(row.designJson)).filter((d): d is LessonCreativeDesign => Boolean(d)),
            userId: opts.userId,
            model: strongModel,
          });
          creativeDesign = generated.design;
          lessonDesignJson = creativeDesign ? serializeCreativeDesign(creativeDesign) : null;
          if (!creativeDesign) {
            rejectReason = `creative_design_invalid:${generated.issues.join("；").slice(0, 420)}`;
          }
        }
      }

      // 审计修复 B5：渲染版本翻代/设计微调导致的缓存失效，不应把已花钱产出的 bespoke HTML
      // 重烧一遍 LLM——旧产物本身是 LLM 精修结果，重新过「CSP→自愈→分级 lint→注壳」管线即可升级，
      // 零 LLM 成本、零二次扣费。管线不过（如旧产物含新硬门违规）再走正常精修/回落。
      // v6 仅复用已经带逐节原创 token 的产物；v5 及更早固定视觉规格产物必须重做，不能借缓存混进新架构。
      if (!opts.force && creativeDesign && prior?.renderEngine === "llm" && lesson.htmlJson) {
        try {
          const oldHtml = (JSON.parse(lesson.htmlJson) as { html?: string }).html ?? "";
          if (oldHtml) {
            const healedOld = normalizeCoursewareStyle(enforceTrustedCsp(oldHtml));
            const lintOld = splitCoursewareLint(healedOld.html);
            const tokenIssues = verifyCreativeDesignUsage(healedOld.html, creativeDesign);
            if (lintOld.security.length === 0 && tokenIssues.length === 0) {
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
    if (opts.enhance && engine !== "llm" && opts.userId && strongModel && creativeDesign) {
      let correctionIssues: string[] = [];
      for (let attempt = 0; attempt < 4 && engine !== "llm"; attempt++) {
        const llm = await synthesizeViaLLM(creativeDesign, blocks, lesson.title, opts.userId, strongModel, correctionIssues);
        if (!llm) {
          correctionIssues = ["模型未返回完整 HTML"];
          continue;
        }
        // 自愈只补可信 CSP 与 reduce-motion，不触碰模型原创的字体、配色、投影、圆角或版式。
        const safe = enforceTrustedCsp(llm);
        const healed = normalizeCoursewareStyle(safe);
        const lint = splitCoursewareLint(healed.html);
        const tokenIssues = verifyCreativeDesignUsage(healed.html, creativeDesign);
        const diversity = assessCoursewareDiversity(healed.html); // 仅观测，不再作为模板化审美硬门
        correctionIssues = [...lint.security, ...tokenIssues];
        if (correctionIssues.length === 0) {
          designVerdict = await judgeCoursewareDesign({
            title: lesson.title,
            html: healed.html,
            design: creativeDesign,
            userId: opts.userId,
            model: strongModel,
          });
          if (!designVerdict.passed) {
            correctionIssues = designVerdict.issues.length > 0
              ? designVerdict.issues.map((issue) => `设计评审:${issue}`)
              : [
                  `设计评审未通过(readability=${designVerdict.readability},hierarchy=${designVerdict.hierarchy},contentFit=${designVerdict.contentFit},originality=${designVerdict.originality})`,
                ];
            continue;
          }
          html = injectBespokeAdapter(healed.html);
          engine = "llm";
          lintIssues = [
            ...healed.fixes.map((f) => `已修安全:${f}`),
            ...lint.style,
            ...diversity.reasons.map((reason) => `视觉观察:${reason}`),
          ];
          if (lintIssues.length === 0) lintIssues = undefined;
        }
      }
      if (engine !== "llm") {
        lintIssues = correctionIssues;
        rejectReason = `llm_safety_or_protocol_rejected:${correctionIssues.join("；").slice(0, 440)}`;
      }
    }

    sourceHash = renderSourceHash({ blocksJson: lesson.blocksJson, design, lessonDesignJson, mode });

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
      mergedQualityJson = JSON.stringify({ ...parsedQ, visual: { ...visual, engine, judge: designVerdict } });
    } catch {
      mergedQualityJson = JSON.stringify({ visual: { ...visual, engine, judge: designVerdict } });
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
        designJson: lessonDesignJson,
        ...(mergedQualityJson ? { qualityJson: mergedQualityJson } : {}),
      },
    });
    await track({
      eventName: "ai_gen_lesson_html",
      userId: opts.userId ?? undefined,
      properties: {
        courseId,
        lessonId: lesson.id,
        engine,
        artDirection: engine === "llm" ? "lesson-original" : design.art.key,
        creativeDirection: creativeDesign?.direction ?? null,
        bytes: html.length,
        rejectReason,
        cacheHit: false,
        durationMs,
      },
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
  // v5：仅非 AI 课惰性固化种子皮肤；AI 课的 designJson 由 ensureDesignBrief 写 v2 brief,
  // 未生成时保持 null 以便后台补齐,不固化成固定 artKey（修 review #3）。
  if (!course.designJson && course.origin !== "ai_generated") {
    await prisma.course.update({ where: { id: course.id }, data: { designJson: serializeCourseDesign(design) } }).catch(() => {});
  }
  const mode = resolveCoursewareMode({ title: course.title, template: course.template, artKey: design.art.key, layout: design.art.layout });
  return renderAndStoreLessonHtml(course.id, lesson, design, mode, {
    enhance: opts.enhance !== false,
    userId,
    model: opts.model,
    budget: createCoursewareBudget(1),
    force: opts.force,
    courseTitle: course.title,
    category: course.category,
  });
}
