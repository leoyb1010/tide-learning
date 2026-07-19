/**
 * 内容安全层（蓝图 C4 / 审查 P1-5）—— AI 产出的独立机检，不再只靠 prompt 合规段。
 *
 * 分级门（与蓝图「私有课低门槛、集市分享高门槛」对齐）：
 *  - block：违法/极端内容硬命中 → 生成侧直接弃用该节产出（换安全占位块），集市侧直接拒。
 *  - review：敏感/夸大/诱导类命中 → 私有课仅记录观测（qualityJson.safety + 埋点）；
 *            集市分享强制人工审核（不走 LLM 自动过审）。
 *
 * 纯函数、零 IO；词表可用 env 扩充（逗号分隔）：SAFETY_EXTRA_BLOCK / SAFETY_EXTRA_REVIEW。
 * 说明：词表机检是保底层不是完备方案，配合集市人工审核与举报通道使用；命中判定大小写不敏感。
 */

export type SafetyLevel = "ok" | "review" | "block";

export interface SafetyHit {
  word: string;
  level: Exclude<SafetyLevel, "ok">;
}

export interface SafetyResult {
  level: SafetyLevel;
  hits: SafetyHit[];
}

// 硬门：违法/极端（教唆制作武器毒品、儿童色情等）。命中即弃用产出。
const BLOCK_WORDS = [
  "制作炸药", "自制炸弹", "制造枪支", "自制枪", "冰毒制作", "制毒配方", "毒品合成",
  "儿童色情", "幼女", "人口贩卖",
];

// 软门：敏感/低俗/赌诈/违规承诺。私有课记录观测，集市分享转人工。
const REVIEW_WORDS = [
  // 赌博/诈骗诱导
  "网赌", "赌博平台", "博彩网站", "刷单兼职", "跑分", "洗钱", "内部彩票",
  // 违规承诺（财务/医疗，呼应 COMPLIANCE_GUARDRAIL 的 prompt 底线，这里做产出侧复核）
  "稳赚不赔", "保本高收益", "包赚", "月入十万", "躺赚",
  "包治", "根治癌症", "替代药物", "停药",
  // 色情低俗
  "色情", "裸聊", "约炮",
  // 极端内容泛词
  "自杀方法", "自残教程",
];

function extraWords(envName: string): string[] {
  return (process.env[envName] || "")
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);
}

/** 扫描一段文本。返回命中列表与整体等级（block > review > ok）。 */
export function scanContentSafety(text: string): SafetyResult {
  const t = (text || "").toLowerCase();
  const hits: SafetyHit[] = [];
  for (const w of [...BLOCK_WORDS, ...extraWords("SAFETY_EXTRA_BLOCK")]) {
    if (w && t.includes(w.toLowerCase())) hits.push({ word: w, level: "block" });
  }
  for (const w of [...REVIEW_WORDS, ...extraWords("SAFETY_EXTRA_REVIEW")]) {
    if (w && t.includes(w.toLowerCase())) hits.push({ word: w, level: "review" });
  }
  const level: SafetyLevel = hits.some((h) => h.level === "block") ? "block" : hits.length > 0 ? "review" : "ok";
  return { level, hits };
}

/** 把块数组的全部文字字段拼成一段供扫描（JSON 字符串足够：值都在其中，键名不会误伤词表）。 */
export function scanBlocksSafety(blocks: unknown): SafetyResult {
  try {
    return scanContentSafety(JSON.stringify(blocks ?? ""));
  } catch {
    return { level: "ok", hits: [] };
  }
}
