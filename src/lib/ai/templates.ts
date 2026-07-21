/**
 * 历史“模板”现已降级为可选创作方向。
 *
 * 它们只向模型表达语气、叙事倾向和适用场景，不再携带章节骨架、固定块配方、
 * 最小块数量或签名块硬门。未显式选择时 Course.template 保持 null，由课程导演自由规划。
 * 真正可保存/克隆的用户课程模板位于 Prisma Template 模型，不与这份兼容注册表混用。
 */

export interface CourseTemplate {
  key: string;
  label: string;
  tagline: string;
  icon: string;
  recommendedFor: string;
  /** 仅作为创作发散建议；主生成链不再按模板改温度。 */
  temperature: number;
}

export const DEFAULT_TEMPLATE = "classic";

export const COURSE_TEMPLATES: CourseTemplate[] = [
  { key: "classic", label: "清晰讲解", tagline: "重视概念准确与学习路径", icon: "GraduationCap", recommendedFor: "需要清楚解释与稳健递进的内容", temperature: 0.5 },
  { key: "case_driven", label: "案例观察", tagline: "从具体情境提炼方法", icon: "MagnifyingGlass", recommendedFor: "职场、商业、决策与复盘内容", temperature: 0.65 },
  { key: "story", label: "叙事沉浸", tagline: "允许人物、冲突与情节承载知识", icon: "BookOpen", recommendedFor: "沟通、软技能与需要代入感的内容", temperature: 0.75 },
  { key: "socratic", label: "问题思辨", tagline: "用问题、假设与证据推进理解", icon: "Question", recommendedFor: "概念辨析、思维方法与争议主题", temperature: 0.6 },
  { key: "workshop", label: "任务实作", tagline: "围绕真实交付物组织学习", icon: "Wrench", recommendedFor: "工具、写作、设计、编程与操作技能", temperature: 0.6 },
  { key: "exam_sprint", label: "测评聚焦", tagline: "围绕明确测评目标组织练习", icon: "Target", recommendedFor: "考试、证书、面试与能力测评", temperature: 0.45 },
  { key: "language_immersion", label: "语言情境", tagline: "让表达在真实沟通中发生", icon: "BookOpen", recommendedFor: "口语、听说与情境表达", temperature: 0.7 },
  { key: "kids_bright", label: "少儿探索", tagline: "短反馈、小步任务与具体情境", icon: "Sparkle", recommendedFor: "儿童启蒙与亲子共学", temperature: 0.7 },
];

export function getTemplate(key?: string | null): CourseTemplate {
  return COURSE_TEMPLATES.find((template) => template.key === key) ?? COURSE_TEMPLATES[0];
}

/** 兼容旧调用；新建课程不会自动选择，只有显式使用此 helper 的历史入口才会得到建议。 */
export function pickTemplate(input: { category?: string | null; title?: string | null; prompt?: string | null }): string {
  const text = `${input.title ?? ""} ${input.prompt ?? ""}`;
  if (input.category === "exam" || /备考|考试|考点|真题|证书|面试题/i.test(text)) return "exam_sprint";
  if (/编程|代码|工具|操作|实操|写作|设计|做一个|交付物/i.test(text)) return "workshop";
  if (/少儿|儿童|亲子|启蒙/i.test(text)) return "kids_bright";
  if (/口语|听力|跟读|发音|会话|外语|英语|日语|韩语/i.test(text)) return "language_immersion";
  if (/故事|沟通|表达|社交/i.test(text)) return "story";
  if (/案例|复盘|商业|管理|营销|运营|决策/i.test(text)) return "case_driven";
  if (/思维|逻辑|误区|为什么|辨析|认知/i.test(text)) return "socratic";
  return DEFAULT_TEMPLATE;
}

export function isValidTemplate(key?: string | null): boolean {
  return !key || COURSE_TEMPLATES.some((template) => template.key === key);
}

/** v6 起模板不再生成任何硬性块要求。 */
export function templateHardRequirement(_key?: string | null): string {
  return "";
}

export interface TemplateAdherence {
  ok: boolean;
  missing: string[];
}

/** v6 起不存在“像不像模板”的发布门；保留函数仅为历史质量档案兼容。 */
export function checkTemplateAdherence(_blocks: { type: string }[], _key?: string | null): TemplateAdherence {
  return { ok: true, missing: [] };
}
