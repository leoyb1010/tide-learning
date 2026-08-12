/**
 * 主题分类学（吸收 AnythingAtlas topic-taxonomy）—— 判「这门课教的是哪一类东西」，
 * 据此调整**结构预期与举证标准**，而不是发一套章节骨架。
 *
 * 与既有两条轴正交，互不覆盖：
 *   - templates.ts        = 用户选的**创作风格**（语气与叙事倾向）
 *   - prompts.TRACK_VOICE = 平台**赛道人群**口吻（给谁讲）
 *   - 本模块              = 主题**本身是什么类型**（技能 / 史实 / 议题 / 时事 …）
 *
 * 要解决的现存问题：教 Python 与教明清史，只要同选 classic、同赛道，走的就是同一套结构预期
 * 和同一套举证标准——「最小动作起步、边做边纠」这类技能预期被硬套到编年史与争议议题上，
 * 而史料、分歧、时效这些该类主题真正的质量维度没有任何 prompt 表达。
 *
 * 铁律沿用 v6（见 templates.ts 抬头）：只表达**结构预期、举证标准与该类主题的典型写坏方式**，
 * 不规定块型、块数、章节数或固定首尾。纯函数、无 IO、无 LLM 调用——同输入必得同输出，
 * 大纲期与逐节期各自现算即天然一致，无需落库、无迁移、零额外 token 调用成本。
 */

export type TopicType =
  | "skill" // 实用技能：做得出来才算学会
  | "tech" // 快变技术：会变、要标时效
  | "academic" // 成熟学科：概念有依赖顺序
  | "history" // 历史事件：编年 + 史料 + 史学分歧
  | "person" // 人物 / 机构
  | "industry" // 行业格局
  | "social" // 社会议题：有真实分歧
  | "current"; // 时事：证据仍在演进

const TOPIC_TYPES = new Set<TopicType>([
  "skill",
  "tech",
  "academic",
  "history",
  "person",
  "industry",
  "social",
  "current",
]);

export function isTopicType(value: unknown): value is TopicType {
  return typeof value === "string" && TOPIC_TYPES.has(value as TopicType);
}

export interface TopicProfile {
  type: TopicType;
  label: string;
  /** 结构预期：这类主题的内容按什么组织才成立。 */
  structure: string;
  /** 举证标准：这类主题什么算证据、要不要出处与时效。 */
  evidence: string;
  /** 典型写坏方式：这类主题最常见的失败长相。 */
  avoid: string;
}

export const TOPIC_PROFILES: Record<TopicType, TopicProfile> = {
  skill: {
    type: "skill",
    label: "实用技能",
    structure: "按「学习者能独立做出什么」推进：尽早给一个最小但完整、当场能做完的真实动作，再逐步加复杂度与判断力。",
    evidence: "证据是可复现的操作、真实工具链与可观察结果；每个判断都要说清在什么条件下成立。",
    avoid: "把理论讲完再统一给练习；练习依赖学习者自备素材、同伴或付费工具；只给正确示范不给常见错法与纠正。",
  },
  tech: {
    type: "tech",
    label: "快变技术",
    structure: "先给能跑起来的最小可用路径，再讲机制与取舍；把「稳定的原理」与「会变的写法」分开讲。",
    evidence: "证据是官方文档、真实可运行示例与版本明确的行为；凡涉及版本、接口、价格、生态现状，必须标明所依据的时间或版本，并提示可能已变。",
    avoid: "把某个版本的写法当永恒真理；罗列工具名却不给选择依据；用过时接口写示例还宣称当前可用。",
  },
  academic: {
    type: "academic",
    label: "成熟学科",
    structure: "按概念依赖顺序推进：后一个概念要用到的前置，必须先建立起来；先讲清定义与适用范围，再进入推导与应用。",
    evidence: "证据是学界公认的定义、经典框架与标准推导；引用要准确到概念本身，不要模糊化处理。",
    avoid: "跳过前置直接讲应用；把某一学派观点当作全学科共识；用比喻替代定义之后就再也不回到严格表述。",
  },
  history: {
    type: "history",
    label: "历史事件",
    structure: "按时间与因果组织，不按难度分级：先立清晰的时间线与关键节点，再进入成因、影响与不同解释。",
    evidence: "证据是一手史料、当事记录与可核查的时间地点人物；史学界存在分歧的地方要并陈，并说明分歧来自证据不足还是立场不同。",
    avoid: "把「入门/进阶/深入」的技能分级硬套到史实上；把小说化的场景描写当史实；只给一种解释而不说明它是一种解释。",
  },
  person: {
    type: "person",
    label: "人物机构",
    structure: "按生平阶段或组织演变阶段组织，围绕代表作、关键决策与其所处的具体条件展开。",
    evidence: "证据是一手访谈、原始文件、作品本身与可核查的公开记录；转述二手轶事时要标明它是流传说法。",
    avoid: "神化或污名化；把励志轶事当事实；只讲成就不讲当时的条件、局限与争议。",
  },
  industry: {
    type: "industry",
    label: "行业格局",
    structure: "从结构入手：有哪些细分、各自的代表玩家与真实产品、靠什么赚钱、关键指标是什么、受什么监管约束。",
    evidence: "证据是具体的公司、产品、量级与指标口径；给数字必须说明口径与时间，说不准时给区间或明确说不确定。",
    avoid: "只讲抽象概念不落到真实玩家与数量级；用「巨大市场/前景广阔」这类无信息量的表述；把某家公司的说法当行业事实。",
  },
  social: {
    type: "social",
    label: "社会议题",
    structure: "先把概念与争论焦点界定清楚，再给证据、相关方各自的处境与主张，最后才是可行选项与取舍。",
    evidence: "证据是官方数据、系统性研究与政策文件；可靠来源之间存在分歧时必须并陈分歧本身，不得为了讲得干净而制造虚假共识。",
    avoid: "把一方立场包装成中立结论；用个案代替总体；把「大家都知道」当证据。",
  },
  current: {
    type: "current",
    label: "时事进展",
    structure: "先给已核实的事实时间线，再区分「已确认」「各方说法」「尚未有定论」三层，最后才谈影响。",
    evidence: "证据是一手声明、公开记录与可靠报道；每条关键事实要带时间点，明确说明本课内容截至何时、之后可能已有新进展。",
    avoid: "把传闻与已核实事实混在一句里；用确定语气写仍在演进的事；不给时间点就下判断。",
  },
};

/**
 * 主题类型识别：强信号正则按特异性排序，首个命中即用。
 * 顺序刻意把「非技能类」放在前面——平台绝大多数课本就是技能课，本模块的价值在于
 * 把史实 / 议题 / 时事 / 人物这些**被硬套技能结构**的少数派准确摘出来。
 *
 * ponytail: 纯关键词启发式（与 courseware-catalog.resolveCoursewareMode 同款），零成本零延迟。
 * 若日后实测误判率高，再升级为「大纲那次 LLM 调用顺带输出 topicType」——该调用已存在，
 * 不需要新增调用，只需扩 JSON 契约一个字段。
 */
const TYPE_HINTS: Array<{ type: TopicType; re: RegExp }> = [
  { type: "current", re: /时事|最新进展|热点事件|近期事件|本周要闻|新闻解读/ },
  { type: "history", re: /历史|[通全简正野秘外]史|史[话纲论稿]|断代|朝代|王朝|战争史|发展史|演变史|考古|文明史|近代史|古代史|明清|春秋战国|文艺复兴/ },
  { type: "person", re: /生平|传记|评传|其人|人物志|列传|创始人|企业家精神|的一生/ },
  { type: "social", re: /社会议题|公共政策|争议|伦理|不平等|公平性|舆论|治理难题|代际|性别议题|环境议题/ },
  { type: "industry", re: /行业(?!应用)|产业|赛道格局|商业模式|市场格局|竞争格局|产业链|供应链|监管与合规|行业研究/ },
  { type: "tech", re: /python|java(?:script)?|typescript|golang|rust|前端|后端|全栈|框架|\bapi\b|\bsql\b|\bgit\b|云原生|容器|部署|大模型|\bllm\b|aigc|机器学习|深度学习|神经网络|算法|数据结构|编程|代码|开发|运维|数据库/i },
  { type: "academic", re: /原理|导论|概论|理论基础|数学|物理|化学|生物|经济学|心理学|语言学|哲学|统计学|微积分|线性代数|概率论|文献综述/ },
];

/** 赛道的弱先验：正则无命中时使用。本平台赛道整体偏技能，因此兜底为 skill 是诚实的默认。 */
const CATEGORY_PRIOR: Record<string, TopicType> = {
  ai_skill: "tech",
  vocational: "skill",
  certification: "skill",
  abroad: "skill",
  parenting: "skill",
  life: "skill",
  english_oral: "skill",
  english_foundation: "skill",
  silver_english: "skill",
};

/**
 * 判定主题类型。text 传能代表主题的自然语言（大纲期传学习需求，逐节期传课程标题 + 本节标题）。
 * 返回 null 表示无把握——此时调用方不注入任何片段，行为与吸收前完全一致（不会因误判变差）。
 */
export function classifyTopic(text: string, category?: string | null): TopicProfile | null {
  const sample = (text || "").slice(0, 400);
  if (sample.trim()) {
    for (const hint of TYPE_HINTS) {
      if (hint.re.test(sample)) return TOPIC_PROFILES[hint.type];
    }
  }
  const prior = category ? CATEGORY_PRIOR[category] : undefined;
  return prior ? TOPIC_PROFILES[prior] : null;
}

/**
 * 注入 prompt 的主题片段。无把握时返回空串——空串拼进 prompt 是无操作，
 * 调用方不必分支判断（与 blueprintLessonFragment / lessonVoiceLine 同款约定）。
 */
export function topicTaxonomyFragment(text: string, category?: string | null): string {
  const p = classifyTopic(text, category);
  if (!p) return "";
  return (
    `\n【主题类型：${p.label}】它决定内容怎么组织和什么算证据，不规定块型、块数或固定首尾。\n` +
    `- 结构预期：${p.structure}\n` +
    `- 举证标准：${p.evidence}\n` +
    `- 本类主题特别避免：${p.avoid}\n`
  );
}
