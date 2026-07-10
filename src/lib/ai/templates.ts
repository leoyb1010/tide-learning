/**
 * 课件模板注册表 —— 造课 / 导入共用。
 *
 * 每个模板 = 大纲节奏规则(outlineRules) + 每节块配方(lessonRecipe) + 质量分阈值。
 * 它编排的是已存在的 13 种块（见 src/lib/blocks.ts），不新增块类型，也不改输出契约，
 * 所以是纯 prompt 层扩展：大纲仍产 {title,subtitle,intro,outline:[...]}，逐节仍产 {blocks:[...]}。
 *
 * 模板管「结构」，赛道(TRACK_VOICE)管「口吻」，二者正交，同时注入。
 * 新增模板：往 COURSE_TEMPLATES 加一项即可，UI 卡片 / API 校验 / prompt 注入 / 落库全自动生效。
 */

export interface CourseTemplate {
  key: string; // 落库到 Course.template
  label: string; // UI 卡片标题
  tagline: string; // UI 卡片一句话
  icon: string; // phosphor 图标名（前端 ICON_MAP 映射）
  recommendedFor: string; // 适合什么内容（UI hover）
  outlineRules: string; // 注入大纲 system 的结构规则段
  lessonRecipe: string; // 注入逐节 system 的块配方段（最关键）
  minInteractive: number; // 质量分：本模板每节最少交互块（quiz+flashcard）
  minVisual: number; // 质量分：本模板每节最少视觉块（compare/steps/dialog/flashcard/callout）
  /**
   * 本模板的「签名块」机检最小数量（块 type → 至少几个）。是模板差异化的硬约束：
   * 1) 逐节 system 据此生成一条明确「必须包含」的硬性要求（templateHardRequirement），
   *    替代此前被通用规则稀释掉的隐性期待（如 story 每节要有 dialog、socratic 要有 ≥3 quiz）；
   * 2) 生成后据此机检模板遵循度（checkTemplateAdherence），把「模板没生效」变成可观测事件。
   * 空对象表示无硬性签名块（如 classic 走通用结构即可）。
   */
  mustInclude: Partial<Record<string, number>>;
  /**
   * 逐节 system 末尾的「别忘了」提醒（recency 锚点）。放在整段 system 最后，
   * 专门重申本模板最容易被通用规则冲刷掉的特征（flash 级模型对「最后看到的话」更敏感）。
   */
  signature: string;
  /** 逐节生成温度：叙事型（story/case）高一些更有表现力，应试型（exam）低一些更稳。 */
  temperature: number;
}

export const DEFAULT_TEMPLATE = "classic";

export const COURSE_TEMPLATES: CourseTemplate[] = [
  {
    key: "classic",
    label: "经典教学",
    tagline: "循序渐进，稳扎稳打",
    icon: "GraduationCap",
    recommendedFor: "通用内容、系统性知识、不确定选哪个时的稳妥默认",
    minInteractive: 1,
    minVisual: 1,
    mustInclude: { example: 1 },
    signature: "经典教学：每个 concept 之后紧跟 example 落地，全节至少 1 个 compare（误区 vs 正确）或 steps。",
    temperature: 0.5,
    outlineRules:
      "【结构模板：经典教学】章节按“入门体验→核心概念→动手应用→进阶避坑→综合收束”推进，首节必须轻（15 分钟内可完成的体验式内容），倒数第二节安排综合练习，末节收束+下一步指引。",
    lessonRecipe: `【本节块配方：经典教学】严格按以下顺序与数量产出 8-12 个块：
1. objectives（1 个）：3-4 条本节目标，动词开头（能说出/能操作/能判断）。
2. scene（1 个）：80-150 字真实场景钩子，回答“不学这节会在哪吃亏”。
3. concept（2-3 个）：每个只讲一个概念，markdown 用小标题+短段落+列表，单块 300-600 字。
4. example（1-2 个）：紧跟对应 concept，给带具体数字/对话/文件名的实例，不许抽象举例。
5. compare 或 steps（1 个）：概念易混淆用 compare（左“常见误区”右“正确做法”，各 3-5 条）；偏操作用 steps（4-7 步，每步 title 动词开头 + detail 一句话）。
6. quiz（1-2 个）：考察本节最核心判断，四选一，explain 必须解释“为什么其他选项不对”。
7. flashcard（1 个）：front 是本节最值得反复回忆的一问，back ≤120 字。
8. summary（1 个）：3 行以内小结 + next 一句话预告下一节。
禁止：连续 2 个以上 concept 不插 example；全节无 compare/steps/dialog。`,
  },
  {
    key: "case_driven",
    label: "案例拆解",
    tagline: "每章一个真实案例，边破案边学",
    icon: "MagnifyingGlass",
    recommendedFor: "职场技能、商业分析、决策判断、复盘型内容",
    minInteractive: 2,
    minVisual: 2,
    mustInclude: { compare: 1, quiz: 2 },
    signature: "案例拆解：全节围绕同一个真实案例展开，compare 的条目必须取自本案例（错误做法及代价 vs 正确做法及收益），不许写通用套话；quiz 第 1 题考本案例判断。",
    temperature: 0.6,
    outlineRules:
      "【结构模板：案例拆解】每一章围绕一个“真实案例”组织，章节标题写成“案例：{具体情境}”或“{情境}翻车/成功复盘”。全课案例难度递进：小案例→复合案例→末章学员自己的案例套用。objective 里写清本章案例覆盖哪 1-2 个原理点。",
    lessonRecipe: `【本节块配方：案例拆解】8-12 个块，叙事顺序=侦探破案：
1. scene（1 个）：120-200 字抛出完整案例现场（谁/在什么场景/遇到什么具体麻烦，带数字与细节），结尾抛悬念问句。
2. callout(info)（1 个）：“先想 30 秒：如果是你会怎么做？”给 2-3 个思考方向。
3. concept（1-2 个）：只讲解开本案例所需的最小原理，不铺开讲全集。
4. steps（1 个）：把案例的正确解法拆成 4-6 步复盘。
5. compare（1 个）：左列“案例里的错误做法及其代价”，右列“正确做法及其收益”，各 3-5 条，条目必须来自本案例，不许写通用套话。
6. example（1 个）：给一个“换壳案例”——同原理换一个场景，验证迁移。
7. quiz（2 个）：第 1 题考案例判断（给新情境选做法），第 2 题考原理本身。
8. flashcard（1 个）：front=“遇到{此类情境}第一反应是什么？”
9. summary（1 个）：一句话提炼“本案例教会我们的一条原则”。`,
  },
  {
    key: "story",
    label: "故事沉浸",
    tagline: "跟着主角连载，剧情里学会",
    icon: "BookOpen",
    recommendedFor: "口语/沟通、软技能、青少年或银发学员、需要代入感的内容",
    minInteractive: 1,
    minVisual: 2,
    mustInclude: { dialog: 1 },
    signature: "故事沉浸：本节必须有至少 1 个 dialog 块推进剧情（主角与配角对话，关键处用 note 标注画外音）；人名与场景延续 outline 设定，绝不每节换主角；summary 的 next 写成「下集预告」。",
    temperature: 0.7,
    outlineRules:
      "【结构模板：故事沉浸】全课是一部连载：设定一位与目标学员画像一致的主角（给名字与处境），每章是主角故事的一集，章节标题写成剧集感（如“第3集 · 小林第一次给老板汇报就砸了”）。章节间剧情连续（上一章的坑是下一章的起点），intro 里用 2 句话介绍主角设定。",
    lessonRecipe: `【本节块配方：故事沉浸】8-12 个块，是“剧集+知识点解说”双线：
1. scene（1 个）：150-250 字本集剧情开场，承接上集结尾，把主角推入本节要解决的困境。
2. dialog（1-2 个）：主角与配角（同事/家人/客户）的 4-8 轮对话推进剧情，在犯错或转机处用 turn.note 标注画外音（“注意：这句话就是踩坑点”）。
3. concept（1-2 个）：以“解说员暂停剧情”的口吻讲原理，开头一句固定为“按下暂停——刚才发生了什么？”，单块 ≤500 字。
4. compare 或 steps（1 个）：主角的旧做法 vs 新做法对比，或主角接下来照做的步骤清单。
5. quiz（1-2 个）：题干延续剧情（“如果小林此时说___，结果会怎样？”）。
6. flashcard（1 个）：front 用剧情提问，back 用原理回答。
7. summary（1 个）：本集剧情收尾 + next 写成“下集预告”（吊胃口一句话）。
全节人名、场景必须与 outline 设定一致，禁止每节换主角。`,
  },
  {
    key: "socratic",
    label: "问答思辨",
    tagline: "不灌结论，带你想通",
    icon: "Question",
    recommendedFor: "思维方法、易有误区的概念、需要“先破再立”的内容",
    minInteractive: 3,
    minVisual: 1,
    mustInclude: { quiz: 3 },
    signature: "问答思辨：quiz 总数必须 ≥3，且第一个 quiz 前置在讲解之前（先考后教，explain 写「往下看你会重新理解这道题」）；concept 先呈现常见错误答案再逐个检验，不要一上来给结论。",
    temperature: 0.5,
    outlineRules:
      "【结构模板：问答思辨】每章标题直接是一个好问题（如“为什么你记住的单词总是用不出来？”），章节顺序=问题链，前一章答案自然引出后一章新问题。intro 声明本课风格：“不灌结论，带你想通”。",
    lessonRecipe: `【本节块配方：问答思辨】9-12 个块，问-猜-证-用 四拍循环：
1. scene（1 个）：把本章问题落到一个具体情境（≤120 字），结尾重复该问题。
2. quiz（1 个，前置！）：先考后教——在讲解前就出一道直觉题，explain 里说“无论对错，往下看你会重新理解这道题”。
3. concept（1 个）：不直接给答案，先呈现 2-3 个常见回答并逐个检验（“你可能会想 A……但注意”）。
4. callout(info)（1-2 个）：追问块，每个只有一句更深的追问 + 两行提示。
5. concept（1 个）：给出经得起检验的答案与推理链。
6. compare（1 个）：左“直觉答案（为什么诱人）” 右“正确答案（为什么反直觉）”。
7. quiz（2 个）：变式检验，选项设计成四个“都像对的”，explain 必须逐项拆。
8. flashcard（1-2 个）：front=本章问题原文。
9. summary（1 个）：用一句话回答本章标题问题 + next 抛出下一章问题。
本模板 quiz 总数必须 ≥3，这是硬性要求。`,
  },
  {
    key: "workshop",
    label: "实战工坊",
    tagline: "边做边学，学完手上有作品",
    icon: "Wrench",
    recommendedFor: "工具操作、写作/设计、编程、任何“动手才会”的技能",
    minInteractive: 1,
    minVisual: 2,
    mustInclude: { steps: 1 },
    signature: "实战工坊：steps 是本节核心块，粒度细到「照着敲/照着说」（具体到按钮名/句式/文件名）；concept 放在 steps 之后（先做后懂）；本节要让学员手上多一个看得见的成品。",
    temperature: 0.5,
    outlineRules:
      "【结构模板：实战工坊】全课=完成一个真实作品/任务（在 intro 明确最终交付物，如“学完你手上会有一份可直接发出的英文自我介绍视频脚本”）。每章是工序的一站，章节标题写成“动手：{本站产出物}”，objective 写清本章结束时学员手上多了什么。",
    lessonRecipe: `【本节块配方：实战工坊】8-12 个块，动手为骨、讲解为辅：
1. objectives（1 个）：第一条永远是“做出：{本节产出物}”。
2. scene（1 个）：≤100 字说明本节产出物在最终作品里的位置。
3. steps（1-2 个）：核心块！4-7 步操作卡，每步 title=动词短语，detail 给到“照着敲/照着说”的粒度（具体到按钮名、句式、文件名）。
4. concept（1 个）：只讲“为什么这么做”，≤400 字，放在 steps 之后（先做后懂）。
5. callout(warn)（1 个）：翻车预警——本步骤 2-3 个最常见失败现象与自救办法。
6. compare（1 个）：左“新手成品的样子” 右“合格成品的样子”，让学员能自检。
7. quiz（1 个）：考操作判断（“下一步该点哪个/该说哪句”）。
8. flashcard（1 个）：front=“做{本节任务}的口诀”。
9. summary（1 个）：核对清单式小结（“此刻你应该已有：…”）+ next。`,
  },
  {
    key: "exam_sprint",
    label: "考点冲刺",
    tagline: "高频考点+连打测验，直击拿分",
    icon: "Target",
    recommendedFor: "备考、证书、面试题、任何有明确测评目标的内容",
    minInteractive: 3,
    minVisual: 2,
    mustInclude: { keypoint: 1, quiz: 3 },
    signature: "考点冲刺：keypoint 考点墙 6-10 条纯记忆点（禁写解释性长句），quiz 连打 ≥3 且难度递增，每题 explain 给「秒杀判据」。",
    temperature: 0.4,
    outlineRules:
      "【结构模板：考点冲刺】按考试/测评的知识板块组织章节，标题写成“考点{n}：{板块}·{高频陷阱}”。intro 写清适用考试与目标分数段。章节顺序按“分值权重×易错度”降序。",
    lessonRecipe: `【本节块配方：考点冲刺】10-14 个块，高密度记忆-检测循环：
1. objectives（1 个）：写成“本考点拿分要求”。
2. keypoint（1-2 个）：考点墙，6-10 条，每条=一个可直接得分的记忆点（公式/句型/规则），禁止写解释性长句。
3. concept（1 个）：只讲最容易失分的 1 个难点，≤400 字。
4. example（1 个）：一道完整真题式例题+逐步解析。
5. compare（1 个）：左“出题人陷阱选项长这样” 右“正确特征”。
6. quiz（3-4 个）：连打！难度递增，最后一题是综合题；每题 explain 给“秒杀判据”。
7. flashcard（2 个）：正反各一张（一张记规则，一张记例外）。
8. callout(warn)（1 个）：本考点“考前 10 秒最后看一眼”的一句话。
9. summary（1 个）：本考点拿分口诀。`,
  },
  {
    key: "language_immersion",
    label: "语言沉浸",
    tagline: "高频对话、跟读纠错，开口即练",
    icon: "BookOpen",
    recommendedFor: "外语口语、听说训练、旅行与职场情境表达",
    minInteractive: 2,
    minVisual: 2,
    mustInclude: { dialog: 2, flashcard: 1 },
    signature: "语言沉浸：至少 2 个 dialog，先给自然对话再做替换练习；用 note 标重音/语气/易错点；flashcard 沉淀本节可直接开口的句型。",
    temperature: 0.6,
    outlineRules: "【结构模板：语言沉浸】全课按真实沟通任务推进，每章锁定一个场景与交付表达，从听懂范例、跟读替换到独立应答，末章完成连续情境挑战。",
    lessonRecipe: `【本节块配方：语言沉浸】9-12 个块：
1. scene：具体沟通场景与任务。
2. objectives：3 条可开口验证的目标。
3. dialog（2-3 个）：自然短对话、关键句替换、纠错对话，note 标注语气与发音。
4. compare：直译表达 vs 地道表达。
5. steps：跟读、替换、脱稿三步练习。
6. quiz（1-2 个）：按情境选最自然表达。
7. flashcard（1-2 个）：高频句型与应答。
8. summary：本节可直接带走的表达 + 下一场景预告。`,
  },
  {
    key: "kids_bright",
    label: "少儿明亮",
    tagline: "大图少字、即时反馈，轻快闯关",
    icon: "Sparkle",
    recommendedFor: "儿童启蒙、亲子共学、低龄知识与习惯培养",
    minInteractive: 2,
    minVisual: 3,
    mustInclude: { scene: 1, quiz: 2 },
    signature: "少儿明亮：短句、大画面、一次只讲一个动作；至少 2 个 quiz 形成即时反馈，不出现长段抽象定义或成人职场语境。",
    temperature: 0.65,
    outlineRules: "【结构模板：少儿明亮】章节像闯关地图，每章一个可观察的小目标，标题短而有动作感；难度小步递进，反复复现核心词与规则。",
    lessonRecipe: `【本节块配方：少儿明亮】8-10 个块：
1. scene：一个可想象的小故事或任务，80 字以内。
2. objectives：2-3 条儿童能复述/指出/完成的目标。
3. dialog 或 example：角色示范。
4. steps：3-5 步动手任务，每步一句话。
5. keypoint：3-5 条短句要点。
6. quiz（2-3 个）：由易到难、反馈清楚。
7. flashcard：图景式提问与短答案。
8. summary：夸奖式核对清单 + 下一关预告。`,
  },
];

/** 取模板（非法 key → classic）。 */
export function getTemplate(key?: string | null): CourseTemplate {
  return COURSE_TEMPLATES.find((t) => t.key === key) ?? COURSE_TEMPLATES[0];
}

/**
 * 内容 → 课型模板启发式（造课未显式选模板时自动匹配）。
 *
 * 根治「12/14 门课 template 为空 → 全默认 classic → 内容块千篇一律」：造课链路未传模板时据
 * prompt/category/title 的强信号自动选一个契合课型，让内容块配方也随课分化（视觉款式另由 mode 分化）。
 * 无强信号回落 classic（稳妥默认；此时视觉款式仍随 art→mode 变化，不会全同）。纯正则、零 LLM。
 */
export function pickTemplate(input: { category?: string | null; title?: string | null; prompt?: string | null }): string {
  const t = `${input.title ?? ""} ${input.prompt ?? ""}`;
  if (input.category === "exam" || /备考|考试|考点|冲刺|真题|模拟题|证书|面试题|刷题|自测|\bielts\b|雅思|托福/i.test(t)) return "exam_sprint";
  if (/编程|代码|程序|python|java(?:script)?|前端|后端|算法|开发|命令行|函数|接口|\bapi\b|\bsql\b|\bgit\b|脚本|部署|数据库|工具|操作|上手|实操|写作|设计|excel|\bppt\b|word|剪辑|做一个|做个/i.test(t)) return "workshop";
  if (/少儿|儿童|幼儿|小朋友|亲子|启蒙|小学低年级|闯关|童趣/i.test(t)) return "kids_bright";
  if (/口语|听力|跟读|发音|对话|会话|外语|英语|日语|韩语|旅行表达|职场英语|speaking|情景/i.test(t)) return "language_immersion";
  if (/沟通|表达|谈判|社交|银发|青少年|故事|职场沟通/i.test(t)) return "story";
  if (/案例|复盘|职场|商业|管理|营销|运营|决策|财务|投资|谈判/i.test(t)) return "case_driven";
  if (/思维|逻辑|误区|为什么|辨析|认知|批判|想通|方法论/i.test(t)) return "socratic";
  return DEFAULT_TEMPLATE;
}

/** 校验 key 是否合法（服务端用，非法直接拒绝而非静默回落，避免脏数据落库）。 */
export function isValidTemplate(key?: string | null): boolean {
  return !key || COURSE_TEMPLATES.some((t) => t.key === key);
}

/** 块 type → 中文可读名（供硬性要求 / 遵循度报告拼人话）。 */
const BLOCK_LABEL: Record<string, string> = {
  dialog: "对话",
  quiz: "测验",
  steps: "步骤",
  keypoint: "要点墙",
  compare: "对比",
  example: "实例",
  flashcard: "记忆卡",
};

function blockLabel(type: string): string {
  return BLOCK_LABEL[type] ?? type;
}

/**
 * 渲染本模板的「签名块硬性要求」段，注入逐节 system —— 是模板差异化落地的关键。
 *
 * 把 mustInclude（如 story:{dialog:1}、socratic:{quiz:3}）翻成一条明确的「本节必须包含 N 个 X 块」，
 * 再接 signature（模板最易被稀释掉的特征提醒）。此前这些期待只散落在 lessonRecipe 的叙述里，
 * 被后面 3 倍长的通用规则冲刷，模型（尤其 flash 级）会收敛回同一套通用结构（实测 story 课 0 dialog）。
 * 空 mustInclude 且空 signature 的模板返回空串（不额外注入噪声）。
 */
export function templateHardRequirement(key?: string | null): string {
  const t = getTemplate(key);
  const reqs = Object.entries(t.mustInclude)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([type, n]) => `至少 ${n} 个 ${blockLabel(type)}（${type}）块`);
  if (reqs.length === 0 && !t.signature) return "";
  return (
    `\n【本模板签名块 · 硬性要求（优先级高于下方通用规则，冲突时以此为准）】\n` +
    (reqs.length ? `本节必须包含：${reqs.join("；")}。\n` : "") +
    (t.signature ? `${t.signature}\n` : "")
  );
}

export interface TemplateAdherence {
  /** 是否满足本模板全部签名块最小数量。 */
  ok: boolean;
  /** 未达标的项（人话，供埋点/排查，如「对话(dialog) 需≥1 实得0」）。空数组即达标。 */
  missing: string[];
}

/**
 * 机检一节 blocks 是否遵循本模板的签名块要求（纯函数，零 LLM）。
 * 与 scoreLesson（通用六项质量分）正交：那个查「好不好」，这个查「像不像本模板」。
 * 供 generateLessonCore 生成后埋点，把「选了模板却没生效」变成可查事件（此前完全无法发现）。
 */
export function checkTemplateAdherence(blocks: { type: string }[], key?: string | null): TemplateAdherence {
  const t = getTemplate(key);
  const counts = new Map<string, number>();
  for (const b of blocks) counts.set(b.type, (counts.get(b.type) ?? 0) + 1);
  const missing: string[] = [];
  for (const [type, need] of Object.entries(t.mustInclude)) {
    const got = counts.get(type) ?? 0;
    if (got < (need ?? 0)) missing.push(`${blockLabel(type)}(${type}) 需≥${need} 实得${got}`);
  }
  return { ok: missing.length === 0, missing };
}
