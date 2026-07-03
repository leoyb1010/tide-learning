/**
 * 块协议 —— AI 生成课/导入课的结构化课件单元（纯函数，无副作用，无 IO）。
 *
 * 设计要点：
 *   - 白名单类型：只认 concept/code/quiz/keypoint/callout 五种块，其余一律丢弃。
 *   - 永不抛错：validateBlocks 无论输入多脏，都返回合法数组（哪怕空数组）——
 *     LLM 输出不可信，校验层是最后一道防线，绝不把非法结构写进库。
 *   - 稳定 id：每块生成可复现前缀 + 随机后缀，供伴侣锚点 / 笔记 anchorRef 引用。
 *   - 字段截断：超长 markdown/code 截断，避免异常 payload 撑爆存储与渲染。
 */

// —— 块类型定义 ——
export type Block =
  | { type: "concept"; title: string; markdown: string }
  | { type: "code"; lang: string; code: string; explanation?: string }
  | { type: "quiz"; question: string; options: string[]; answerIndex: number; explain: string }
  | { type: "keypoint"; points: string[] }
  | { type: "callout"; tone: "info" | "warn"; markdown: string };

export interface CourseBlocks {
  version: 1;
  blocks: (Block & { id: string })[];
}

// —— 约束常量 ——
const MAX_MARKDOWN = 4000;
const MAX_CODE = 6000;
const MAX_OPTIONS = 8; // quiz 选项上限，避免异常长列表
const MAX_POINTS = 12; // keypoint 条目上限
const BLOCK_TYPES = new Set(["concept", "code", "quiz", "keypoint", "callout"]);

/** 截断字符串到 max 长度（非字符串归空串）。 */
function clampStr(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.length > max ? v.slice(0, max) : v;
}

/** 生成稳定块 id：blk_ + 序号 + 随机后缀。 */
function makeId(index: number): string {
  return `blk_${index}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 校验并规范化原始块数组。
 * - 丢弃非白名单 type 的块 / 结构不合法的块。
 * - quiz 的 answerIndex 越界（<0 或 >=options.length）归 0。
 * - 超长 markdown(>4000)/code(>6000) 截断。
 * - 每块生成稳定 id。
 * 永远返回合法数组（哪怕空）。
 */
export function validateBlocks(raw: unknown): (Block & { id: string })[] {
  // 兼容两种入参：直接的块数组，或 {blocks:[...]} 包装
  let arr: unknown[] = [];
  if (Array.isArray(raw)) {
    arr = raw;
  } else if (raw && typeof raw === "object" && Array.isArray((raw as { blocks?: unknown }).blocks)) {
    arr = (raw as { blocks: unknown[] }).blocks;
  } else {
    return [];
  }

  const out: (Block & { id: string })[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const b = item as Record<string, unknown>;
    const type = b.type;
    if (typeof type !== "string" || !BLOCK_TYPES.has(type)) continue;

    const id = makeId(out.length);

    switch (type) {
      case "concept": {
        const title = clampStr(b.title, 200);
        const markdown = clampStr(b.markdown, MAX_MARKDOWN);
        if (!title && !markdown) continue; // 空块无意义，丢弃
        out.push({ id, type: "concept", title, markdown });
        break;
      }
      case "code": {
        const lang = clampStr(b.lang, 40) || "text";
        const code = clampStr(b.code, MAX_CODE);
        if (!code) continue;
        const explanationRaw = clampStr(b.explanation, MAX_MARKDOWN);
        const block: Block & { id: string } = { id, type: "code", lang, code };
        if (explanationRaw) block.explanation = explanationRaw;
        out.push(block);
        break;
      }
      case "quiz": {
        const question = clampStr(b.question, 500);
        const rawOptions = Array.isArray(b.options) ? b.options : [];
        const options = rawOptions
          .filter((o) => typeof o === "string")
          .map((o) => clampStr(o, 300))
          .slice(0, MAX_OPTIONS);
        if (!question || options.length < 2) continue; // 无题干或选项不足，丢弃
        let answerIndex = typeof b.answerIndex === "number" && Number.isInteger(b.answerIndex) ? b.answerIndex : 0;
        // 越界归 0（安全默认，永不指向不存在的选项）
        if (answerIndex < 0 || answerIndex >= options.length) answerIndex = 0;
        const explain = clampStr(b.explain, MAX_MARKDOWN);
        out.push({ id, type: "quiz", question, options, answerIndex, explain });
        break;
      }
      case "keypoint": {
        const rawPoints = Array.isArray(b.points) ? b.points : [];
        const points = rawPoints
          .filter((p) => typeof p === "string" && p.trim())
          .map((p) => clampStr(p, 500))
          .slice(0, MAX_POINTS);
        if (points.length === 0) continue;
        out.push({ id, type: "keypoint", points });
        break;
      }
      case "callout": {
        const tone: "info" | "warn" = b.tone === "warn" ? "warn" : "info";
        const markdown = clampStr(b.markdown, MAX_MARKDOWN);
        if (!markdown) continue;
        out.push({ id, type: "callout", tone, markdown });
        break;
      }
    }
  }
  return out;
}

/**
 * 把块拼成纯文本（供伴侣上下文 / 搜索索引 / 摘要用）。
 * 只取可读文本，去掉结构噪音；quiz 展开题干 + 选项 + 解析。
 */
export function blocksToPlainText(blocks: (Block & { id: string })[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "concept":
        if (b.title) parts.push(b.title);
        if (b.markdown) parts.push(b.markdown);
        break;
      case "code":
        if (b.explanation) parts.push(b.explanation);
        parts.push(`[${b.lang}]\n${b.code}`);
        break;
      case "quiz": {
        const opts = b.options.map((o, i) => `${i + 1}. ${o}`).join("\n");
        parts.push(`${b.question}\n${opts}`);
        if (b.explain) parts.push(b.explain);
        break;
      }
      case "keypoint":
        parts.push(b.points.map((p) => `- ${p}`).join("\n"));
        break;
      case "callout":
        parts.push(b.markdown);
        break;
    }
  }
  return parts.join("\n\n").trim();
}
