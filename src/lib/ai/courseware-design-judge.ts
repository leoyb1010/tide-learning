/** LLM 设计评审：只评审内容适配、层级、可读性与原创性，不拿固定模板当标准。 */

import { creditingOnUsage } from "../credits";
import { chatJson } from "../llm";
import type { LessonCreativeDesign } from "./courseware-creative-design";
import { bespokeTimeoutMs, type LlmModelEntry } from "./models";

export interface CoursewareDesignVerdict {
  passed: boolean;
  readability: number;
  hierarchy: number;
  contentFit: number;
  originality: number;
  issues: string[];
  judged: boolean;
}

interface RawVerdict {
  readability?: unknown;
  hierarchy?: unknown;
  contentFit?: unknown;
  originality?: unknown;
  issues?: unknown;
}

const UNAVAILABLE: CoursewareDesignVerdict = {
  passed: false,
  readability: 0,
  hierarchy: 0,
  contentFit: 0,
  originality: 0,
  issues: ["设计评审暂不可用，不能把未审作品冒充已通过"],
  judged: false,
};

function score(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(5, Math.round(n))) : 0;
}

export async function judgeCoursewareDesign(input: {
  title: string;
  html: string;
  design: LessonCreativeDesign;
  userId: string;
  model: LlmModelEntry;
}): Promise<CoursewareDesignVerdict> {
  const source = input.html
    .replace(/<script[\s\S]*?<\/script>/gi, "<!-- script omitted -->")
    .slice(0, 18000);
  try {
    const raw = await chatJson<RawVerdict>({
      system:
        "你是课程体验设计评审，只评审、不改代码。" +
        "不要用固定模板、卡片数量、某种品牌皮肤或个人审美当标准。" +
        "判断设计是否服务这一节的内容、信息层级是否清楚、正文是否可读、页面轮廓是否有原创决策。" +
        "视觉可以极简、密集、叙事、实验或工具化，只要与教学目标相符。" +
        "发现问题要指出具体元素和改法，不能说“再高级一点”。严格只输出 JSON。",
      user:
        `本节：${input.title}\n` +
        `设计方向：${input.design.direction}\n构图：${input.design.layoutStrategy}\n母题：${input.design.motif}\n` +
        "从 0-5 评分：readability（字号/行距/对比与长文可读）、hierarchy（主次和学习路径）、" +
        "contentFit（视觉/交互是否服务本节内容）、originality（是否明显套用常见课件或 AI 卡片模板）。" +
        "3=合格，4=好，5=示范级。任一轴低于 3 必须在 issues 给出可执行原因。\n" +
        `HTML/CSS：\n${source}\n\n` +
        '输出 {"readability":N,"hierarchy":N,"contentFit":N,"originality":N,"issues":["..."]}。',
      temperature: 0.2,
      maxTokens: 1600,
      timeoutMs: bespokeTimeoutMs(input.model),
      retries: 1,
      model: input.model.key,
      onUsage: creditingOnUsage(input.userId, "generate_lesson_html"),
    });
    const readability = score(raw.readability);
    const hierarchy = score(raw.hierarchy);
    const contentFit = score(raw.contentFit);
    const originality = score(raw.originality);
    const issues = (Array.isArray(raw.issues) ? raw.issues : [])
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim().slice(0, 180))
      .slice(0, 8);
    return {
      passed: readability >= 4 && hierarchy >= 4 && contentFit >= 4 && originality >= 4,
      readability,
      hierarchy,
      contentFit,
      originality,
      issues,
      judged: true,
    };
  } catch {
    return UNAVAILABLE;
  }
}
