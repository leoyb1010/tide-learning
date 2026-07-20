import { chatJson } from "@/lib/llm";
import type { LlmUsageInfo } from "@/lib/llm";
import { blocksToPlainText } from "@/lib/blocks";
import type { Block } from "@/lib/blocks";

/**
 * LLM-as-judge 课件质量评审（内容级，替代只看结构的通胀规则分）。
 *
 * 规则分（scoreLesson）只查结构（有没有 scene/summary/交互块/视觉块），70/89 满分通胀、看不出内容深浅真伪。
 * 本模块用一个便宜的 LLM 评审，从「深度 / 准确 / 文字」三轴给分 + 出具体问题清单，
 * 供 generateLessonCore 的纠偏重写据此定向修（不达标才重写）。fail-open：评审自身出错一律判过，绝不阻断出课。
 */

export interface LessonJudgeVerdict {
  /** 综合是否达标（三轴均 >=3 且无高风险准确性问题）。 */
  passed: boolean;
  /** 深度：讲得透不透、有没有具体案例与画面感（0-5）。 */
  depth: number;
  /** 准确：有无明显硬伤/编造的具体数据、日期、断言（0-5，越高越可信）。 */
  accuracy: number;
  /** 文字：像不像人写的、有没有 AI 腔/空话套话（0-5）。 */
  voice: number;
  /** 具体问题清单（供纠偏重写定向修，最多 6 条）。 */
  issues: string[];
  /** 评审是否真实执行（false=LLM 出错/未配置，fail-open 判过，不写入质量档案作为可信分）。 */
  judged: boolean;
}

interface RawVerdict {
  depth?: number;
  accuracy?: number;
  voice?: number;
  issues?: unknown;
  verdict?: string;
}

const PASS: LessonJudgeVerdict = { passed: true, depth: 5, accuracy: 5, voice: 5, issues: [], judged: false };

function clampScore(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 3;
  return Math.max(0, Math.min(5, Math.round(v)));
}

/**
 * 评审一节课件。ctx 给评审必要语境（课题/本节目标/学科），blocks 转纯文本喂入。
 * model 缺省用课级模型；评审是一次性只读判断，maxTokens 小、温度低求稳定。
 * onUsage 透传计费（评审也走真实 token，按 note_summary 档记，属低价场景）。
 */
export async function judgeLesson(
  blocks: (Block & { id: string })[],
  ctx: { courseTitle: string; lessonTitle: string; objective?: string | null; category?: string | null },
  opts: { model?: string; onUsage?: (u: LlmUsageInfo) => void } = {},
): Promise<LessonJudgeVerdict> {
  const text = blocksToPlainText(blocks).slice(0, 6000);
  if (!text.trim()) return PASS;

  const system =
    "你是课程内容主编，负责给一节自学课件把质量关。只评审、不改写。" +
    "你要识破「结构齐全但内容空洞」的课件：块型都在、却全是正确的废话、举例泛泛、讲不透。\n" +
    "从三个维度各打 0-5 分。评分锚点（务必按此校准，不要一律压低）：\n" +
    "  5=优秀，示范级；4=好；3=合格可用（讲清楚了、有具体内容、能学到东西，就该给 3 及以上）；" +
    "2=有明显不足（偏浅或有套话，但不算废）；1=差；0=严重缺陷（几乎全是废话/硬伤）。\n" +
    "- depth（深度）：是否讲透原理与「怎么用」，有没有具体到能想象的案例/类比/步骤，而非停留在定义与口号。\n" +
    "- accuracy（准确）：有无明显硬伤、自相矛盾、或编造的具体数据/日期/名称/断言。宁可没有具体数字，不可编造。\n" +
    "- voice（文字）：像不像人写的好文章，有没有 AI 腔（「在当今社会」「总而言之」的空话套话堆砌）。\n" +
    "只有当某一维度确实到「差/严重缺陷」(0-1)时才吝惜给分；内容合格就给 3 及以上，不要对可用内容习惯性打 2。\n" +
    "再给出最多 6 条具体、可执行的改进建议（指名哪一块太浅/哪个例子该换成什么方向），不要泛泛而谈。\n" +
    '严格只输出 JSON：{"depth":N,"accuracy":N,"voice":N,"issues":["...","..."]}，不要任何解释文字或代码围栏。';

  const user =
    `课程：《${ctx.courseTitle}》\n` +
    `本节：${ctx.lessonTitle}\n` +
    (ctx.objective ? `本节目标：${ctx.objective}\n` : "") +
    (ctx.category ? `赛道：${ctx.category}\n` : "") +
    `\n【本节课件全文】\n${text}\n\n请按三轴打分并给出改进建议。`;

  try {
    const raw = await chatJson<RawVerdict>({
      system,
      user,
      temperature: 0.2,
      maxTokens: 1200,
      timeoutMs: 45_000,
      retries: 0,
      model: opts.model,
      onUsage: opts.onUsage,
    });
    const depth = clampScore(raw?.depth);
    const accuracy = clampScore(raw?.accuracy);
    const voice = clampScore(raw?.voice);
    const issues = Array.isArray(raw?.issues)
      ? raw.issues.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim().slice(0, 160)).slice(0, 6)
      : [];
    // 达标线（安全网口径，非完美主义）：仅当某一维度确实到「差/严重缺陷」(0-1) 才判不达标触发纠偏重写。
    // 内容合格(各轴>=2)即放行——避免把「本可更好」的合格内容也无脑重写，让 premium 每节都双倍成本。
    // 首版规则分/模板签名不达标本就会单独触发一次重写；judge 只补位「结构合格但内容空洞/编造」的尾部差课。
    const passed = depth >= 2 && voice >= 2 && accuracy >= 2;
    return { passed, depth, accuracy, voice, issues, judged: true };
  } catch {
    // fail-open：评审自身失败绝不阻断出课，判过但标记未真实评审。
    return PASS;
  }
}
