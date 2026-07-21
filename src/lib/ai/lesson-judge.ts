import { blocksToPlainText, type Block } from "@/lib/blocks";
import { chatJson, type LlmUsageInfo } from "@/lib/llm";
import { bespokeTimeoutMs, resolveModel, selectBespokeModel } from "@/lib/ai/models";

/**
 * 内容评审与教学评审由两个独立 Agent 完成。
 *
 * 旧实现让一个模型一次性兼任所有角色，并在调用失败时伪造 5 分通过。这里把“未评审”与
 * “评审通过”彻底分开：任何 Agent 没有真实返回，judged=false 且 passed=false，作者流水会继续重写
 * 或把当前最佳稿标为未验证，不再把基础设施失败伪装成内容质量。
 */

export interface LessonJudgeVerdict {
  passed: boolean;
  depth: number;
  accuracy: number;
  relevance: number;
  specificity: number;
  progression: number;
  sourceFidelity: number;
  voice: number;
  teaching: number;
  assessment: number;
  feedback: number;
  transfer: number;
  cognitiveLoad: number;
  issues: string[];
  blockingIssues: string[];
  judged: boolean;
  agents: { content: boolean; teaching: boolean };
}

interface RawContentVerdict {
  publishable?: unknown;
  depth?: unknown;
  accuracy?: unknown;
  relevance?: unknown;
  specificity?: unknown;
  progression?: unknown;
  sourceFidelity?: unknown;
  voice?: unknown;
  issues?: unknown;
  blockingIssues?: unknown;
}

interface RawTeachingVerdict {
  publishable?: unknown;
  teaching?: unknown;
  assessment?: unknown;
  feedback?: unknown;
  transfer?: unknown;
  cognitiveLoad?: unknown;
  issues?: unknown;
  blockingIssues?: unknown;
}

function score(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(5, Math.round(n))) : 0;
}

function issues(value: unknown): string[] {
  return (Array.isArray(value) ? value : [])
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 220))
    .slice(0, 8);
}

function contextText(input: {
  courseBrief?: string;
  courseOutline?: string;
  narrativePlan?: string;
  sourceContext?: string;
  priorCoverage?: string;
}): string {
  return [
    input.courseBrief,
    input.courseOutline ? `【全课地图】\n${input.courseOutline}` : null,
    input.narrativePlan ? `【本节导演方案】\n${input.narrativePlan}` : null,
    input.priorCoverage ? `【前序已覆盖】\n${input.priorCoverage.slice(0, 5000)}` : null,
    input.sourceContext ? `【本节参考资料】\n${input.sourceContext.slice(0, 9000)}` : null,
  ].filter(Boolean).join("\n\n");
}

async function judgeContent(input: {
  lessonText: string;
  courseTitle: string;
  lessonTitle: string;
  objective?: string | null;
  category?: string | null;
  context: string;
  sourceBased: boolean;
  model?: string;
  onUsage?: (u: LlmUsageInfo) => void;
}): Promise<{ raw: RawContentVerdict | null; judged: boolean }> {
  const model = selectBespokeModel(input.model) ?? resolveModel(input.model);
  try {
    const raw = await chatJson<RawContentVerdict>({
      system:
        "你是严格的课程内容主编，只评审内容，不替作者写稿。" +
        "判断本节是否准确回答用户原始需求、是否在全课地图中承担清晰且不重复的职责、是否讲透机制与边界，并用具体案例或证据支持。" +
        "不要奖励固定开场、固定总结、块数量或模板长相。不要因为结构非传统而扣分。" +
        "sourceFidelity 只判断给定资料与正文是否相符；没有资料时判断是否避免无依据的精确断言。" +
        "4=可以直接发布的高质量内容，5=示范级，3=勉强可用但仍需编辑，0-2=不可发布。" +
        "blockingIssues 只列必须重写才能发布的问题，例如事实或分类错误、与课程范围冲突、关键结论无依据。存在 blockingIssues 时 publishable 必须为 false，相关维度不得给 4-5 分。" +
        "issues 列非阻断但值得改进的问题。严格只输出 JSON。",
      user:
        `课程：《${input.courseTitle}》\n本节：${input.lessonTitle}\n` +
        (input.objective ? `目标：${input.objective}\n` : "") +
        (input.category ? `类别：${input.category}\n` : "") +
        `${input.context}\n\n【待评正文】\n${input.lessonText}\n\n` +
        `从 0-5 评分并输出 {publishable,depth,accuracy,relevance,specificity,progression,sourceFidelity,voice,blockingIssues,issues}。` +
        `本课${input.sourceBased ? "以导入资料为事实边界，资料外事实应扣分" : "可使用可靠通识，但不得虚构来源、数字或案例"}。`,
      temperature: 0.1,
      maxTokens: 2200,
      timeoutMs: bespokeTimeoutMs(model),
      retries: 1,
      model: model.key,
      onUsage: input.onUsage,
    });
    return { raw, judged: true };
  } catch {
    return { raw: null, judged: false };
  }
}

async function judgeTeaching(input: {
  lessonText: string;
  courseTitle: string;
  lessonTitle: string;
  objective?: string | null;
  context: string;
  model?: string;
  onUsage?: (u: LlmUsageInfo) => void;
}): Promise<{ raw: RawTeachingVerdict | null; judged: boolean }> {
  const model = selectBespokeModel(input.model) ?? resolveModel(input.model);
  try {
    const raw = await chatJson<RawTeachingVerdict>({
      system:
        "你是学习科学与教学设计评审，只评审学习过程，不评页面美术。" +
        "检查学习者是否需要观察、判断、解释、练习或创作，而非被动读完；检验是否真正测到目标；反馈是否解释原因；迁移是否换了情境；认知负荷是否合理。" +
        "不要求 scene、objectives、quiz、summary 的固定顺序，也不要求每节都使用同一种交互。" +
        "4=可以直接发布，5=示范级，3=勉强可用但仍需编辑，0-2=不可发布。" +
        "blockingIssues 只列会让学习者无法完成、答案不唯一、反馈错误或检验不到目标的发布阻断项；存在阻断项时 publishable 必须为 false，相关维度不得给 4-5 分。" +
        "issues 列非阻断改进。严格只输出 JSON。",
      user:
        `课程：《${input.courseTitle}》\n本节：${input.lessonTitle}\n` +
        (input.objective ? `目标：${input.objective}\n` : "") +
        `${input.context}\n\n【待评正文】\n${input.lessonText}\n\n` +
        "从 0-5 评分并输出 {publishable,teaching,assessment,feedback,transfer,cognitiveLoad,blockingIssues,issues}。",
      temperature: 0.1,
      maxTokens: 1800,
      timeoutMs: bespokeTimeoutMs(model),
      retries: 1,
      model: model.key,
      onUsage: input.onUsage,
    });
    return { raw, judged: true };
  } catch {
    return { raw: null, judged: false };
  }
}

export async function judgeLesson(
  blocks: (Block & { id: string })[],
  ctx: { courseTitle: string; lessonTitle: string; objective?: string | null; category?: string | null },
  opts: {
    model?: string;
    onUsage?: (u: LlmUsageInfo) => void;
    courseBrief?: string;
    courseOutline?: string;
    narrativePlan?: string;
    sourceContext?: string;
    priorCoverage?: string;
    sourceBased?: boolean;
  } = {},
): Promise<LessonJudgeVerdict> {
  const lessonText = blocksToPlainText(blocks).slice(0, 22_000);
  if (!lessonText.trim()) {
    return {
      passed: false,
      depth: 0,
      accuracy: 0,
      relevance: 0,
      specificity: 0,
      progression: 0,
      sourceFidelity: 0,
      voice: 0,
      teaching: 0,
      assessment: 0,
      feedback: 0,
      transfer: 0,
      cognitiveLoad: 0,
      issues: ["课件没有可评审的正文"],
      blockingIssues: ["课件没有可评审的正文"],
      judged: true,
      agents: { content: true, teaching: true },
    };
  }
  const context = contextText(opts);
  const [content, teaching] = await Promise.all([
    judgeContent({ ...ctx, lessonText, context, sourceBased: Boolean(opts.sourceBased), model: opts.model, onUsage: opts.onUsage }),
    judgeTeaching({ ...ctx, lessonText, context, model: opts.model, onUsage: opts.onUsage }),
  ]);
  const c = content.raw ?? {};
  const t = teaching.raw ?? {};
  const verdict: LessonJudgeVerdict = {
    passed: false,
    depth: score(c.depth),
    accuracy: score(c.accuracy),
    relevance: score(c.relevance),
    specificity: score(c.specificity),
    progression: score(c.progression),
    sourceFidelity: score(c.sourceFidelity),
    voice: score(c.voice),
    teaching: score(t.teaching),
    assessment: score(t.assessment),
    feedback: score(t.feedback),
    transfer: score(t.transfer),
    cognitiveLoad: score(t.cognitiveLoad),
    issues: [...issues(c.issues), ...issues(t.issues)].slice(0, 12),
    blockingIssues: [...issues(c.blockingIssues), ...issues(t.blockingIssues)].slice(0, 12),
    judged: content.judged && teaching.judged,
    agents: { content: content.judged, teaching: teaching.judged },
  };
  const contentPublishable = c.publishable === true;
  const teachingPublishable = t.publishable === true;
  // 模型偶尔会一边写“分类错误/答案不唯一”，一边仍给 5 分。对这种自相矛盾做最后一道一致性校验。
  const seriousIssuePattern = /(事实错误|分类错误|标注.{0,8}错误|答案.{0,12}(不唯一|有歧义)|无法执行|前后不一致|自相矛盾|应属于|应为.{0,18}而不是|修正标注)/;
  const inferredBlocking = verdict.issues.filter((item) => seriousIssuePattern.test(item));
  if (inferredBlocking.length) {
    verdict.blockingIssues = [...new Set([...verdict.blockingIssues, ...inferredBlocking])].slice(0, 12);
  }
  verdict.passed = verdict.judged && contentPublishable && teachingPublishable && verdict.blockingIssues.length === 0 &&
    verdict.depth >= 4 &&
    verdict.accuracy >= 4 &&
    verdict.relevance >= 4 &&
    verdict.specificity >= 4 &&
    verdict.progression >= 3 &&
    verdict.sourceFidelity >= 4 &&
    verdict.voice >= 3 &&
    verdict.teaching >= 4 &&
    verdict.assessment >= 4 &&
    verdict.feedback >= 3 &&
    verdict.transfer >= 4 &&
    verdict.cognitiveLoad >= 3;
  return verdict;
}

export function lessonJudgeScore(verdict: LessonJudgeVerdict): number {
  const values = [
    verdict.depth,
    verdict.accuracy,
    verdict.relevance,
    verdict.specificity,
    verdict.progression,
    verdict.sourceFidelity,
    verdict.voice,
    verdict.teaching,
    verdict.assessment,
    verdict.feedback,
    verdict.transfer,
    verdict.cognitiveLoad,
  ];
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
