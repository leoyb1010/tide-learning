/**
 * 单节教学叙事策划 Agent。
 *
 * 输出的是自由的教学节拍，不是从模板枚举里选骨架。blocks 仍是内容真值协议，作者 Agent
 * 会在写作时把这些节拍映射成合适的语义块；展示层随后可完全自由重表达。
 */

import { creditingOnUsage } from "../credits";
import { chatJson } from "../llm";
import { bespokeTimeoutMs, selectBespokeModel } from "./models";

interface RawNarrativeBeat {
  purpose?: unknown;
  technique?: unknown;
  evidence?: unknown;
}

interface RawNarrativePlan {
  teachingApproach?: unknown;
  essentialQuestion?: unknown;
  rationale?: unknown;
  scopeBoundary?: unknown;
  successEvidence?: unknown;
  beats?: unknown;
  assessmentStrategy?: unknown;
  transferTask?: unknown;
  avoid?: unknown;
}

export interface LessonNarrativeBeat {
  purpose: string;
  technique: string;
  evidence: string;
}

export interface LessonNarrativePlan {
  v: 1;
  teachingApproach: string;
  essentialQuestion: string;
  rationale: string;
  scopeBoundary: string;
  successEvidence: string;
  beats: LessonNarrativeBeat[];
  assessmentStrategy: string;
  transferTask: string;
  avoid: string[];
}

function text(value: unknown, max = 180): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return cleaned.length >= 2 ? cleaned : null;
}

export function validateNarrativePlan(raw: unknown): LessonNarrativePlan | null {
  const r = (raw ?? {}) as RawNarrativePlan;
  const teachingApproach = text(r.teachingApproach);
  const essentialQuestion = text(r.essentialQuestion, 220) ?? teachingApproach;
  const rationale = text(r.rationale, 260);
  const scopeBoundary = text(r.scopeBoundary, 260) ?? "只覆盖实现本节目标所必需的内容";
  const assessmentStrategy = text(r.assessmentStrategy, 220);
  const successEvidence = text(r.successEvidence, 260) ?? assessmentStrategy;
  const transferTask = text(r.transferTask, 220);
  const beatsRaw = Array.isArray(r.beats) ? (r.beats as RawNarrativeBeat[]) : [];
  const beats = beatsRaw
    .map((beat) => ({
      purpose: text(beat?.purpose, 140),
      technique: text(beat?.technique, 180),
      evidence: text(beat?.evidence, 180),
    }))
    .filter((beat): beat is LessonNarrativeBeat => Boolean(beat.purpose && beat.technique && beat.evidence))
    .slice(0, 12);
  const avoid = (Array.isArray(r.avoid) ? r.avoid : [])
    .map((item) => text(item, 120))
    .filter((item): item is string => Boolean(item))
    .slice(0, 6);
  if (!teachingApproach || !essentialQuestion || !rationale || !assessmentStrategy || !successEvidence || !transferTask || beats.length < 3) return null;
  return { v: 1, teachingApproach, essentialQuestion, rationale, scopeBoundary, successEvidence, beats, assessmentStrategy, transferTask, avoid };
}

export function narrativePlanPrompt(plan: LessonNarrativePlan | null): string {
  if (!plan) {
    return "【教学结构】根据本节内容与受众自行设计讲法。不要套固定的钩子-目标-讲解-测验-小结顺序；每个段落必须推进理解、检验或迁移。\n";
  }
  return (
    `【本节教学导演方案】讲法：${plan.teachingApproach}。核心问题：${plan.essentialQuestion}。理由：${plan.rationale}\n` +
    `范围边界：${plan.scopeBoundary}\n达成证据：${plan.successEvidence}\n` +
    plan.beats.map((beat, index) => `${index + 1}. 目的：${beat.purpose}；手法：${beat.technique}；证据/素材：${beat.evidence}`).join("\n") +
    `\n检验策略：${plan.assessmentStrategy}\n迁移任务：${plan.transferTask}\n` +
    (plan.avoid.length ? `本节特别避免：${plan.avoid.join("；")}\n` : "") +
    "这个方案决定教学节奏，但不规定块数量与固定首尾。请把每个节拍映射到最合适的语义块，必要时合并或拆分。\n"
  );
}

export async function generateLessonNarrativePlan(input: {
  courseTitle: string;
  lessonTitle: string;
  objective?: string | null;
  category?: string | null;
  audience?: string | null;
  previousLessonTitles?: string[];
  sourceContext?: string;
  templateHint?: string | null;
  courseBrief?: string;
  courseOutline?: { title: string; objective?: string | null; position: number }[];
  lessonPosition?: number;
  priorCoverage?: string;
  userId: string;
  model?: string | null;
}): Promise<LessonNarrativePlan | null> {
  const model = selectBespokeModel(input.model);
  if (!model) return null;
  try {
    const raw = await chatJson<RawNarrativePlan>({
      system:
        "你是课程导演，只负责决定这一节最有效的讲法，不写正文。" +
        "不要从固定课件模板里选，不要默认钩子-目标-讲解-测验-小结五段式。" +
        "你可以从问题、案例、错误、任务、冲突、观察、对话、推导、作品或任何适合内容的入口开始。" +
        "每个教学节拍都必须说明它推进了什么、用什么手法、依赖什么证据或具体素材。" +
        "先确定本节要回答的核心问题、明确不越过的范围边界，以及什么学习者产出能证明真的学会。" +
        "所有练习必须在课件内自给材料并可立即完成；不得要求学习者另找录音、案例、同伴或付费工具，除非用户明确提供。" +
        "检验必须直接测量本节目标，正确答案唯一或评分标准明确，迁移任务要写清提交物与成功标准。" +
        "必须设计真实的理解检验与迁移任务，但它们可以出现在最合适的位置，不必放在结尾。" +
        "严格只输出 JSON。",
      user:
        `课程：${input.courseTitle}\n本节：${input.lessonTitle}\n` +
        (input.objective ? `目标：${input.objective}\n` : "") +
        (input.category ? `类别：${input.category}\n` : "") +
        (input.audience ? `受众：${input.audience}\n` : "") +
        (input.templateHint ? `用户选择的创作偏好：${input.templateHint}（只作灵感，不是结构约束）\n` : "") +
        (input.courseBrief ? `${input.courseBrief}\n` : "") +
        (input.courseOutline?.length
          ? `全课地图（当前为第 ${(input.lessonPosition ?? 0) + 1} 节）：\n${input.courseOutline.map((item) => `${item.position + 1}. ${item.title}${item.objective ? `：${item.objective}` : ""}`).join("\n")}\n`
          : "") +
        (input.previousLessonTitles?.length ? `前序章节：${input.previousLessonTitles.join("、")}\n` : "") +
        (input.priorCoverage ? `前序已经讲过的内容（本节不得换句话重复）：\n${input.priorCoverage.slice(0, 5000)}\n` : "") +
        (input.sourceContext ? `参考资料摘录：\n${input.sourceContext.slice(0, 4000)}\n` : "") +
        "输出 {teachingApproach,essentialQuestion,rationale,scopeBoundary,successEvidence,beats:[{purpose,technique,evidence}],assessmentStrategy,transferTask,avoid:[...]}。beats 3-12 个，数量由内容决定。",
      temperature: 0.75,
      maxTokens: 3600,
      timeoutMs: bespokeTimeoutMs(model),
      retries: 1,
      model: model.key,
      onUsage: creditingOnUsage(input.userId, "generate_lesson"),
    });
    return validateNarrativePlan(raw);
  } catch {
    return null;
  }
}
