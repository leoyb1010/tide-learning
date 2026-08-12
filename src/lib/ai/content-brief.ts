import { classifyTopic, isTopicType, type TopicType } from "@/lib/ai/topic-taxonomy";

/**
 * 课程内容总纲。
 *
 * 大纲不是用户意图的替代品。这个对象把最初需求和课程规划长期保存在 Course 上，
 * 逐节导演、作者和评审都读取同一份真值，避免生成到第三节后只剩标题可猜。
 */

export interface CourseContentBrief {
  v: 1;
  request: string;
  /**
   * 缺省表示新版入口直接收到的用户需求。旧课只能从 job/title 回填时必须显式标记，
   * 避免把模型或历史运行文本中的日期洗成“用户确认的截至日期”。
   */
  requestProvenance?: "legacy_job" | "course_title";
  learnerOutcome?: string;
  scope?: string;
  prerequisites?: string;
  capstone?: string;
  exclusions?: string[];
  planningRationale?: string;
  sourceBased?: boolean;
  topicType?: TopicType;
  sourceAsOf?: string;
  /** 用户在检查点最终确认的执行大纲；与早期自动规划冲突时以此为准。 */
  confirmedOutline?: { title: string; objective?: string; assessmentNeed?: AssessmentNeed }[];
}

export type AssessmentNeed = "none" | "check" | "practice" | "transfer" | "adaptive";
const ASSESSMENT_NEEDS = new Set<AssessmentNeed>(["none", "check", "practice", "transfer", "adaptive"]);

export function normalizeAssessmentNeed(value: unknown): AssessmentNeed {
  return typeof value === "string" && ASSESSMENT_NEEDS.has(value as AssessmentNeed) ? value as AssessmentNeed : "adaptive";
}

type RawBrief = Partial<Record<keyof CourseContentBrief, unknown>>;

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return text || undefined;
}

export function createCourseContentBrief(input: {
  request: string;
  requestProvenance?: unknown;
  plan?: {
    learnerOutcome?: unknown;
    scope?: unknown;
    prerequisites?: unknown;
    capstone?: unknown;
    exclusions?: unknown;
    planningRationale?: unknown;
  } | null;
  sourceBased?: boolean;
  confirmedOutline?: unknown;
  topicType?: unknown;
  sourceAsOf?: unknown;
}): CourseContentBrief {
  const plan = input.plan ?? {};
  const exclusions = (Array.isArray(plan.exclusions) ? plan.exclusions : [])
    .map((item) => cleanText(item, 180))
    .filter((item): item is string => Boolean(item))
    .slice(0, 8);
  const confirmedOutline = (Array.isArray(input.confirmedOutline) ? input.confirmedOutline : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .flatMap((item): { title: string; objective?: string; assessmentNeed?: AssessmentNeed }[] => {
      const title = cleanText(item.title, 120);
      if (!title) return [];
      const objective = cleanText(item.objective, 300);
      const rawAssessmentNeed = typeof item.assessmentNeed === "string" ? item.assessmentNeed : null;
      return [{
        title,
        ...(objective ? { objective } : {}),
        ...(rawAssessmentNeed && ASSESSMENT_NEEDS.has(rawAssessmentNeed as AssessmentNeed)
          ? { assessmentNeed: rawAssessmentNeed as AssessmentNeed }
          : {}),
      }];
    })
    .slice(0, 100);
  return {
    v: 1,
    request: cleanText(input.request, 2000) ?? "完成这门课程的学习目标",
    requestProvenance: input.requestProvenance === "legacy_job" || input.requestProvenance === "course_title"
      ? input.requestProvenance
      : undefined,
    learnerOutcome: cleanText(plan.learnerOutcome, 500),
    scope: cleanText(plan.scope, 800),
    prerequisites: cleanText(plan.prerequisites, 500),
    capstone: cleanText(plan.capstone, 500),
    exclusions: exclusions.length ? exclusions : undefined,
    planningRationale: cleanText(plan.planningRationale, 800),
    sourceBased: Boolean(input.sourceBased),
    topicType: isTopicType(input.topicType)
      ? input.topicType
      : classifyTopic(input.request)?.type,
    sourceAsOf: cleanText(input.sourceAsOf, 20),
    confirmedOutline: confirmedOutline.length ? confirmedOutline : undefined,
  };
}

export function readCourseContentBrief(value: string | null | undefined): CourseContentBrief | null {
  if (!value) return null;
  try {
    const raw = JSON.parse(value) as RawBrief;
    if (!raw || typeof raw !== "object") return null;
    return createCourseContentBrief({
      request: typeof raw.request === "string" ? raw.request : "",
      requestProvenance: raw.requestProvenance,
      plan: raw,
      sourceBased: raw.sourceBased === true,
      confirmedOutline: raw.confirmedOutline,
      topicType: raw.topicType,
      sourceAsOf: raw.sourceAsOf,
    });
  } catch {
    return null;
  }
}

export function serializeCourseContentBrief(brief: CourseContentBrief): string {
  return JSON.stringify(brief);
}

export function withConfirmedCourseOutline(
  brief: CourseContentBrief,
  lessons: { title: string; summary?: string | null }[],
): CourseContentBrief {
  const existing = brief.confirmedOutline ?? [];
  return createCourseContentBrief({
    request: brief.request,
    requestProvenance: brief.requestProvenance,
    plan: brief,
    sourceBased: brief.sourceBased,
    topicType: brief.topicType,
    sourceAsOf: brief.sourceAsOf,
    confirmedOutline: lessons.map((lesson, index) => {
      const prior = existing.find((item) => item.title === lesson.title) ?? existing[index];
      return {
        title: lesson.title,
        objective: lesson.summary ?? undefined,
        assessmentNeed: prior?.assessmentNeed ?? "adaptive",
      };
    }),
  });
}

export function assessmentNeedForLesson(
  brief: CourseContentBrief | null,
  lesson: { title: string; index: number },
): AssessmentNeed {
  const outline = brief?.confirmedOutline ?? [];
  return (outline.find((item) => item.title === lesson.title) ?? outline[lesson.index])?.assessmentNeed ?? "adaptive";
}

export function contentBriefPrompt(brief: CourseContentBrief | null): string {
  if (!brief) return "";
  const lines = [
    `用户最初需求：${brief.request}`,
    brief.confirmedOutline?.length
      ? `用户确认的执行大纲：${brief.confirmedOutline.map((item, index) => `${index + 1}. ${item.title}${item.objective ? `（${item.objective}）` : ""}${item.assessmentNeed ? ` [检验=${item.assessmentNeed}]` : ""}`).join("；")}`
      : null,
    brief.confirmedOutline?.length ? "执行规则：若早期自动规划与用户确认大纲冲突，以用户确认大纲为准。" : null,
    brief.learnerOutcome ? `整课最终成果：${brief.learnerOutcome}` : null,
    brief.scope ? `课程范围：${brief.scope}` : null,
    brief.prerequisites ? `前置基础：${brief.prerequisites}` : null,
    brief.capstone ? `综合成果任务：${brief.capstone}` : null,
    brief.exclusions?.length ? `明确不讲：${brief.exclusions.join("；")}` : null,
    brief.planningRationale ? `课程规划理由：${brief.planningRationale}` : null,
    brief.sourceBased ? "本课以用户导入资料为事实边界；不得补写资料之外的事实性内容。" : null,
    brief.topicType ? `持久主题类型：${brief.topicType}；后续阶段不得因课程标题改写而换类。` : null,
    brief.sourceAsOf ? `来源截至日期：${brief.sourceAsOf}；晚于此日的变化不得写成已核实事实。` : null,
  ].filter((line): line is string => Boolean(line));
  return `【课程内容总纲】\n${lines.map((line) => `- ${line}`).join("\n")}\n`;
}
