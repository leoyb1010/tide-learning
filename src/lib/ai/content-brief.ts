/**
 * 课程内容总纲。
 *
 * 大纲不是用户意图的替代品。这个对象把最初需求和课程规划长期保存在 Course 上，
 * 逐节导演、作者和评审都读取同一份真值，避免生成到第三节后只剩标题可猜。
 */

export interface CourseContentBrief {
  v: 1;
  request: string;
  learnerOutcome?: string;
  scope?: string;
  prerequisites?: string;
  capstone?: string;
  exclusions?: string[];
  planningRationale?: string;
  sourceBased?: boolean;
}

type RawBrief = Partial<Record<keyof CourseContentBrief, unknown>>;

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return text || undefined;
}

export function createCourseContentBrief(input: {
  request: string;
  plan?: {
    learnerOutcome?: unknown;
    scope?: unknown;
    prerequisites?: unknown;
    capstone?: unknown;
    exclusions?: unknown;
    planningRationale?: unknown;
  } | null;
  sourceBased?: boolean;
}): CourseContentBrief {
  const plan = input.plan ?? {};
  const exclusions = (Array.isArray(plan.exclusions) ? plan.exclusions : [])
    .map((item) => cleanText(item, 180))
    .filter((item): item is string => Boolean(item))
    .slice(0, 8);
  return {
    v: 1,
    request: cleanText(input.request, 2000) ?? "完成这门课程的学习目标",
    learnerOutcome: cleanText(plan.learnerOutcome, 500),
    scope: cleanText(plan.scope, 800),
    prerequisites: cleanText(plan.prerequisites, 500),
    capstone: cleanText(plan.capstone, 500),
    exclusions: exclusions.length ? exclusions : undefined,
    planningRationale: cleanText(plan.planningRationale, 800),
    sourceBased: Boolean(input.sourceBased),
  };
}

export function readCourseContentBrief(value: string | null | undefined): CourseContentBrief | null {
  if (!value) return null;
  try {
    const raw = JSON.parse(value) as RawBrief;
    if (!raw || typeof raw !== "object") return null;
    return createCourseContentBrief({
      request: typeof raw.request === "string" ? raw.request : "",
      plan: raw,
      sourceBased: raw.sourceBased === true,
    });
  } catch {
    return null;
  }
}

export function serializeCourseContentBrief(brief: CourseContentBrief): string {
  return JSON.stringify(brief);
}

export function contentBriefPrompt(brief: CourseContentBrief | null): string {
  if (!brief) return "";
  const lines = [
    `用户最初需求：${brief.request}`,
    brief.learnerOutcome ? `整课最终成果：${brief.learnerOutcome}` : null,
    brief.scope ? `课程范围：${brief.scope}` : null,
    brief.prerequisites ? `前置基础：${brief.prerequisites}` : null,
    brief.capstone ? `综合成果任务：${brief.capstone}` : null,
    brief.exclusions?.length ? `明确不讲：${brief.exclusions.join("；")}` : null,
    brief.planningRationale ? `课程规划理由：${brief.planningRationale}` : null,
    brief.sourceBased ? "本课以用户导入资料为事实边界；不得补写资料之外的事实性内容。" : null,
  ].filter((line): line is string => Boolean(line));
  return `【课程内容总纲】\n${lines.map((line) => `- ${line}`).join("\n")}\n`;
}
