import { classifyTopic, type TopicType } from "@/lib/ai/topic-taxonomy";

export interface SourcePolicy {
  topicType: TopicType | null;
  requiresSource: boolean;
  requiresAsOfDate: boolean;
  asOfDate: string | null;
  reason: string | null;
}

export interface FinalCourseOutlineSourcePolicy extends SourcePolicy {
  /** 仅从显式可信文本、已持久化截止日期或实际来源中提取的日期。 */
  effectiveAsOfDate: string | null;
  missingSource: boolean;
  missingAsOfDate: boolean;
}

export interface FinalLessonDraftSourcePolicy extends SourcePolicy {
  missingSource: boolean;
  missingAsOfDate: boolean;
}

// 「当前作用域 / 实时系统」是稳定技术概念，不能因单个时间形容词误拦；
// 当前/实时只在指向会变的事实对象时作强信号，价格/政策等另有 INHERENTLY_VOLATILE_RE 兜底。
const TIME_SIGNAL_RE = /(最新|现行|截至|今天|本周|近期|最新进展|在任|现任|发布会|新闻|(?:当前|实时)(?:的)?(?:价格|费率|收费|排名|行情|市场份额|政策|法规|规定|税率|利率|汇率|版本|进展|局势|现状|数据|状态|在售|可用性|总统|领导人|ceo)|\b(?:latest|today|this\s+week|recent\s+news|breaking\s+news|as\s+of|incumbent)\b|\b(?:current|real[-\s]?time)\b[\s\S]{0,48}\b(?:price|pricing|fee|fees|rate|rates|ranking|rankings|market\s+share|policy|policies|law|laws|regulation|regulations|tax|interest|exchange|version|status|availability|president|leader|ceo|data)\b)/u;
// 这些事实即使用户没写“最新”，答案也会随时间变化；版本控制等稳定概念不能被“版本”二字误伤。
const INHERENTLY_VOLATILE_RE = /(价格|费率|收费|排名|市场份额|接口变更|政策|法规|监管规定|税率|利率|汇率|版本(?!控制)|\b(?:price|prices|pricing|fee|fees|ranking|rankings|market\s+share|api\s+changes?|policy|policies|regulation|regulations|tax\s+rates?|interest\s+rates?|exchange\s+rates?|version(?!\s+control))\b)/u;
const HIGH_STAKES_RE = /(诊断|治疗|用药|药物|疾病|医疗建议|法律意见|法条|法规|判例|合同效力|投资建议|股票|基金|税务|保险理赔|\b(?:medical(?:\s+(?:advice|diagnosis|treatment))?|diagnosis|drug|drugs|medication|medications|dosage|legal(?:\s+advice)?|statute|statutes|case\s+law|contract\s+enforceability|investment(?:\s+advice)?|stock|stocks|mutual\s+funds?|tax|taxation|insurance\s+claims?)\b)/u;
const DATE_RE = /\b(20\d{2})[-年/.](0?[1-9]|1[0-2])[-月/.](0?[1-9]|[12]\d|3[01])日?\b/u;

function normalizePolicyText(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

function isoDate(text: string): string | null {
  const match = normalizePolicyText(text).match(DATE_RE);
  if (!match) return null;
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/** 只从调用方已标记为可信的文本中提取截止日期；模型输出不得调用它自证。 */
export function trustedSourceAsOfDate(...texts: Array<string | null | undefined>): string | null {
  return texts.map((text) => isoDate(text ?? "")).find(Boolean) ?? null;
}

/**
 * 模型没有外部真值时不能用“同类模型自评”冒充事实核验。对时事、快变断言和高风险主题，
 * 生成前要求用户提供参考资料；时事/最新类还必须明确截至日期。
 */
export function sourcePolicyForTopic(text: string, category?: string | null): SourcePolicy {
  const normalizedText = normalizePolicyText(text);
  const normalizedCategory = category ? normalizePolicyText(category) : category;
  const topicType = classifyTopic(normalizedText, normalizedCategory)?.type ?? null;
  const volatile = topicType === "current" || TIME_SIGNAL_RE.test(normalizedText) || INHERENTLY_VOLATILE_RE.test(normalizedText);
  const highStakes = HIGH_STAKES_RE.test(normalizedText);
  const requiresSource = volatile || highStakes;
  return {
    topicType,
    requiresSource,
    requiresAsOfDate: volatile,
    asOfDate: isoDate(normalizedText),
    reason: volatile
      ? "该主题包含时事、现行规则或快变事实"
      : highStakes
        ? "该主题属于医疗、法律或金融高风险事实"
        : null,
  };
}

/**
 * 大纲检查点允许用户改掉课名和全部章节，因此不能沿用首次造课时的主题判定。
 * 这里以「最终课名 + 原始请求 + 最终全量课节」重算来源约束。最终课名/课节可能是
 * 模型产出，因此它们只能触发风险，不能用自写日期解锁。日期只认调用方明确标记的
 * 可信文本、已持久化截止日期或实际 reference/source 文本；不从任何触发文本隐式提权。
 */
export function sourcePolicyForFinalCourseOutline(input: {
  courseTitle: string;
  originalRequest: string;
  lessons: { title: string; summary?: string | null }[];
  category?: string | null;
  sourceAvailable: boolean;
  persistedSourceAsOf?: string | null;
  /** 调用方已确认来自用户/持久化记录的日期文本，不可传模型结果。 */
  trustedDateText?: string | null;
  /** 本次实际可查证并注入的 reference/source 原文。 */
  actualSourceText?: string | null;
}): FinalCourseOutlineSourcePolicy {
  const finalText = [
    input.courseTitle,
    input.originalRequest,
    ...input.lessons.flatMap((lesson) => [lesson.title, lesson.summary ?? ""]),
  ].filter(Boolean).join("\n");
  const policy = sourcePolicyForTopic(finalText, input.category);
  const effectiveAsOfDate = trustedSourceAsOfDate(
    input.persistedSourceAsOf,
    input.trustedDateText,
    input.actualSourceText,
  );
  const hasActualSource = Boolean(input.actualSourceText?.trim());
  return {
    ...policy,
    asOfDate: effectiveAsOfDate,
    effectiveAsOfDate,
    missingSource: policy.requiresSource && !input.sourceAvailable && !hasActualSource,
    missingAsOfDate: policy.requiresAsOfDate && !effectiveAsOfDate,
  };
}

/**
 * 最终课节稿是模型输出，不能用它自己写出的“来源/日期”为自己解锁。
 * generatedText 只决定这篇稿是否触发来源门；截至日期只从已持久的 trustedText 读取，
 * 来源只认本节实际召回并注入的上下文。
 */
export function sourcePolicyForFinalLessonDraft(input: {
  /** 兼容旧调用：未提供 triggerText/trustedDateText 时同时用于触发风险与可信日期。 */
  trustedText?: string;
  /** 可包含模型标题/大纲，只能触发风险门，不能提供日期。 */
  triggerText?: string;
  /** 只允许用户原始请求/指令或已持久的 sourceAsOf。 */
  trustedDateText?: string;
  generatedText: string;
  category?: string | null;
  actualSourceText: string;
}): FinalLessonDraftSourcePolicy {
  const policy = sourcePolicyForTopic(`${input.triggerText ?? input.trustedText ?? ""}\n${input.generatedText}`, input.category);
  const trustedDate = isoDate(input.trustedDateText ?? input.trustedText ?? "") ?? isoDate(input.actualSourceText);
  return {
    ...policy,
    asOfDate: trustedDate,
    missingSource: policy.requiresSource && !input.actualSourceText.trim(),
    missingAsOfDate: policy.requiresAsOfDate && !trustedDate,
  };
}
