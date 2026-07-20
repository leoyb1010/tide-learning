/**
 * L1 课程蓝图（专业模式）—— 把用户对课程的结构化偏好透传进大纲/逐节 prompt + grounding。
 *
 * 落库在 Course.blueprintJson，造课时由 generate-course 写入，逐节生成时 generateLessonCore 读出注入。
 * 全部字段可选、白名单枚举校验，脏值一律回落缺省（不阻断出课）。referenceText 是「参考资料」grounding：
 * 用户粘贴的真实素材注入生成，直接缓解「例子全虚构、无出处」的内容短板。
 */

export const AUDIENCES = ["beginner", "some", "advanced"] as const;
export const TONES = ["textbook", "coach", "interview"] as const;
export const LENGTHS = ["brief", "standard", "deep"] as const;
export const BLOCK_PREFS = ["quiz", "diagram", "code", "flashcard"] as const;

export type Audience = (typeof AUDIENCES)[number];
export type Tone = (typeof TONES)[number];
export type LengthPref = (typeof LENGTHS)[number];
export type BlockPref = (typeof BLOCK_PREFS)[number];

export interface Blueprint {
  audience?: Audience;
  tone?: Tone;
  length?: LengthPref;
  blockPrefs?: BlockPref[];
  /** 参考资料（grounding），最多约 6000 字注入生成。 */
  referenceText?: string;
}

const AUDIENCE_SET = new Set<string>(AUDIENCES);
const TONE_SET = new Set<string>(TONES);
const LENGTH_SET = new Set<string>(LENGTHS);
const BLOCK_PREF_SET = new Set<string>(BLOCK_PREFS);

/** 从任意输入（请求体）规范化蓝图；非法枚举丢弃，referenceText 截断。返回 null 表示无有效字段。 */
export function parseBlueprint(raw: unknown): Blueprint | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const bp: Blueprint = {};
  if (typeof r.audience === "string" && AUDIENCE_SET.has(r.audience)) bp.audience = r.audience as Audience;
  if (typeof r.tone === "string" && TONE_SET.has(r.tone)) bp.tone = r.tone as Tone;
  if (typeof r.length === "string" && LENGTH_SET.has(r.length)) bp.length = r.length as LengthPref;
  if (Array.isArray(r.blockPrefs)) {
    const prefs = r.blockPrefs.filter((p): p is BlockPref => typeof p === "string" && BLOCK_PREF_SET.has(p));
    if (prefs.length) bp.blockPrefs = [...new Set(prefs)];
  }
  if (typeof r.referenceText === "string" && r.referenceText.trim()) {
    bp.referenceText = r.referenceText.trim().slice(0, 8000);
  }
  return Object.keys(bp).length ? bp : null;
}

/** 从 Course.blueprintJson 反序列化（脏值 → null）。 */
export function readBlueprint(blueprintJson: string | null | undefined): Blueprint | null {
  if (!blueprintJson) return null;
  try {
    return parseBlueprint(JSON.parse(blueprintJson));
  } catch {
    return null;
  }
}

/** 序列化落库。 */
export function serializeBlueprint(bp: Blueprint): string {
  return JSON.stringify(bp);
}

/** length → 目标节数（大纲阶段用；缺省 standard=8）。 */
export function lessonCountForLength(length?: LengthPref): number {
  return length === "brief" ? 5 : length === "deep" ? 12 : 8;
}

const AUDIENCE_LINE: Record<Audience, string> = {
  beginner: "受众是零基础新手：多打比方、拆小步、先讲“为什么”再讲“怎么做”，术语首次出现必须用大白话解释。",
  some: "受众是有一定基础的学习者：可略过最基础铺垫，直接讲重点、易错点与进阶用法。",
  advanced: "受众是进阶学习者：聚焦深层机制、边界情况、权衡取舍与最佳实践，不必解释入门概念。",
};
const TONE_LINE: Record<Tone, string> = {
  textbook: "口吻严谨如优质教科书：定义准确、逻辑严密、例子规范，但仍要好读不枯燥。",
  coach: "口吻像一位轻松的私教：口语化、有鼓励、多用“你”，把难点讲得像朋友聊天。",
  interview: "口吻面向面试/应试冲刺：直击考点、给标准答法与加分点、点明常见坑，节奏紧凑。",
};
const BLOCK_PREF_LINE: Record<BlockPref, string> = {
  quiz: "多安排 quiz 检查理解（关键处每讲完一段就设一题，选项有迷惑性）。",
  diagram: "凡有流程/循环/结构/层级/转化关系，尽量用 diagram 图示块画出来，胜过文字。",
  code: "涉及命令或代码时多用 code 块给可运行示例并解释关键行。",
  flashcard: "多用 flashcard 沉淀需要记忆的术语/句型/公式，便于进复习。",
};

/** 逐节生成 prompt 的蓝图片段（受众/口吻/块偏好；referenceText 另走 grounding 注入）。 */
export function blueprintLessonFragment(bp: Blueprint | null): string {
  if (!bp) return "";
  const parts: string[] = [];
  if (bp.audience) parts.push(AUDIENCE_LINE[bp.audience]);
  if (bp.tone) parts.push(TONE_LINE[bp.tone]);
  if (bp.blockPrefs?.length) parts.push(bp.blockPrefs.map((p) => BLOCK_PREF_LINE[p]).join(" "));
  if (!parts.length) return "";
  return "【本课定制要求（专业模式蓝图，优先满足，但不得违反块协议与合规）】\n" + parts.map((p) => "- " + p).join("\n") + "\n";
}

/** 大纲生成 prompt 的蓝图片段（受众/口吻/篇幅影响章节规划）。 */
export function blueprintOutlineFragment(bp: Blueprint | null): string {
  if (!bp) return "";
  const parts: string[] = [];
  if (bp.audience) parts.push(AUDIENCE_LINE[bp.audience]);
  if (bp.tone) parts.push(TONE_LINE[bp.tone]);
  if (bp.length) parts.push(`本课规划 ${lessonCountForLength(bp.length)} 节左右（${bp.length === "brief" ? "速览精简" : bp.length === "deep" ? "深入系统" : "标准"}）。`);
  if (!parts.length) return "";
  return "\n【课程定制要求（专业模式）】\n" + parts.map((p) => "- " + p).join("\n") + "\n";
}
