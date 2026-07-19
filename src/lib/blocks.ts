/**
 * 块协议 —— AI 生成课/导入课的结构化课件单元（纯函数，无副作用，无 IO）。
 *
 * 设计要点：
 *   - 白名单类型：只认 BLOCK_TYPES 里的 14 种块（concept/code/quiz/keypoint/callout/
 *     objectives/scene/dialog/steps/compare/example/flashcard/summary/image），其余一律丢弃。
 *   - 永不抛错：validateBlocks 无论输入多脏，都返回合法数组（哪怕空数组）——
 *     LLM 输出不可信，校验层是最后一道防线，绝不把非法结构写进库。
 *   - 稳定 id：每块生成可复现前缀 + 随机后缀，供伴侣锚点 / 笔记 anchorRef 引用。
 *   - 字段截断：超长 markdown/code 截断，避免异常 payload 撑爆存储与渲染。
 */

// —— 块类型定义（v3.1 扩展为 13 种：v3 的 12 种 + image 课件图解）——
export type Block =
  // 基础 5 种（v2 保留，前向兼容旧课）
  | { type: "concept"; title: string; markdown: string }
  | { type: "code"; lang: string; code: string; explanation?: string }
  | { type: "quiz"; question: string; options: string[]; answerIndex: number; explain: string }
  | { type: "keypoint"; points: string[] }
  | { type: "callout"; tone: "info" | "warn"; markdown: string }
  // v3 新增 7 种（叙事结构 + 交互）
  | { type: "objectives"; items: string[] } // 节首学习目标：本节你将学会
  | { type: "scene"; title: string; markdown: string } // 场景引入/钩子：为什么学
  | { type: "dialog"; turns: { speaker: string; text: string; note?: string }[] } // 对话示例（口语课刚需）
  | { type: "steps"; steps: { title: string; detail?: string }[] } // 步骤教程
  | { type: "compare"; title?: string; left: { heading: string; items: string[] }; right: { heading: string; items: string[] } } // 对比（误区 vs 正确）
  | { type: "example"; markdown: string } // 例子/案例
  | { type: "flashcard"; front: string; back: string } // 内联翻转卡，可存复习
  | { type: "summary"; markdown: string; next?: string } // 节尾小结 + 下节预告钩子
  | { type: "image"; src: string; caption?: string; alt?: string } // 课件图解：站内图 + 可选说明/替代文本
  // v4.3 公式块（吸收 KaTeX）：latex 源，服务端渲染为自包含 HTML；display=独立居中/inline=行内。
  | { type: "formula"; latex: string; display?: boolean; caption?: string }
  // v4.3 交互块（吸收 H5P 交互设计，自研确定性渲染 + 判分回传 ct-quiz 进错题闭环）：
  //  - fillblank 填空：blanks 由学员键入，每空 answers 多写法都算对；
  //  - dragwords 拖词：blanks 从打乱的词库（正解 + 干扰词）点选填入（移动友好，不用 HTML5 拖拽）。
  | { type: "fillblank"; prompt?: string; segments: string[]; blanks: string[][] }
  | { type: "dragwords"; prompt?: string; segments: string[]; blanks: string[]; distractors?: string[] }
  // v4.3 语义图示（leohtml 图示纪律:结构取自关系、节点必须有完整标签与明确方向,拒绝装饰性无标签图形）
  | {
      type: "diagram";
      /** 关系→结构:flow=顺序流程 cycle=循环运转 hub=中心与参与者 layers=层级(自顶向下) funnel=筛选/转化 */
      kind: "flow" | "cycle" | "hub" | "layers" | "funnel";
      title?: string;
      /** 节点标签取自内容本身;flow/funnel 末项=结果,hub 首项=中心。 */
      items: { label: string; detail?: string }[];
      /** 一句话点明图示要说明的结论(渲染在图下方)。 */
      note?: string;
    };

// —— 约束常量 ——
const MAX_MARKDOWN = 4000;
const MAX_CODE = 6000;
const MAX_OPTIONS = 8; // quiz 选项上限，避免异常长列表
const MAX_POINTS = 12; // keypoint 条目上限
const MAX_TURNS = 20; // dialog 轮次上限
const MAX_STEPS = 12; // steps 步骤上限
const BLOCK_TYPES = new Set([
  "concept", "code", "quiz", "keypoint", "callout",
  "objectives", "scene", "dialog", "steps", "compare", "example", "flashcard", "summary", "image", "diagram", "formula",
  "fillblank", "dragwords",
]);

/** 公式 latex 长度上限（防超长 latex 撑爆渲染/存储）。 */
const MAX_LATEX = 1200;
/** 交互块：空数上限（防异常长），词库干扰词上限。 */
const MAX_BLANKS = 8;
const MAX_DISTRACTORS = 8;

/** diagram 块 kind 白名单与节点数窗口(cycle/hub 至少 3 个节点才成形)。 */
const DIAGRAM_KINDS = new Set(["flow", "cycle", "hub", "layers", "funnel"]);
const DIAGRAM_MIN: Record<string, number> = { flow: 2, cycle: 3, hub: 3, layers: 2, funnel: 2 };
const MAX_DIAGRAM_ITEMS = 6;

/**
 * 图片块 src 白名单前缀：只认站内绝对路径（/ 开头，指向 public/ 下真实资产）。
 * 防注入：拒绝 http(s):// 外链、data:/javascript:/blob: 伪协议、协议相对 //host、以及路径穿越 ../。
 * 课件图解目前只引用 public/ 下已就位的图（covers/courseware/lesson-stills/note-captures 等）。
 */
function sanitizeImageSrc(v: unknown): string {
  if (typeof v !== "string") return "";
  const s = v.trim();
  if (!s) return "";
  // 必须是单斜杠开头的站内根路径；排除协议相对 //host 与含协议的绝对 URL。
  if (!s.startsWith("/")) return "";
  if (s.startsWith("//")) return "";
  // 显式拒绝任何伪协议 / 反斜杠 / 路径穿越片段。
  const lowered = s.toLowerCase();
  if (lowered.includes(":") || lowered.includes("\\") || s.includes("..")) return "";
  return clampStr(s, 512);
}

/** 从未知值取字符串数组，逐项截断、过滤空、限量。 */
function clampStrArray(v: unknown, maxLen: number, maxCount: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => typeof x === "string" && x.trim())
    .map((x) => clampStr(x, maxLen))
    .slice(0, maxCount);
}

/** 截断字符串到 max 长度（非字符串归空串）。 */
function clampStr(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.length > max ? v.slice(0, max) : v;
}

/**
 * 块 id（审计修复 2026-07-18）：必须**确定性且跨解析稳定**——课件 HTML 的 data-bid、
 * LessonQuizResult 幂等键、错题转复习卡的块匹配都以它为锚。原实现带 Math.random 后缀，
 * 同一 blocksJson 每次 validate 得到不同 id，导致答题回传的 bid 永远匹配不上（D2 闭环断裂）。
 * 现规则：入参块自带合法 id 则原样保留（存量 blocksJson 已含持久化 id），否则用纯序号 id。
 */
function makeId(index: number): string {
  return `blk_${index}`;
}

function keepId(raw: unknown, index: number, seen: Set<string>): string {
  let id = makeId(index);
  if (raw && typeof raw === "object" && typeof (raw as { id?: unknown }).id === "string") {
    const explicit = (raw as { id: string }).id.trim();
    if (/^[\w-]{1,64}$/.test(explicit)) id = explicit;
  }
  // 去重（审计修复 H3）：LLM 回声/混合输入可能带重复 id——重复 bid 会让 quiz upsert 幂等键
  // 撞车(后答覆盖先答)、错题转卡 find 恒取第一个。确定性追加后缀,同输入必得同输出。
  while (seen.has(id)) id = `${id}_dup`;
  seen.add(id);
  return id;
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
  const seenIds = new Set<string>();
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const b = item as Record<string, unknown>;
    const type = b.type;
    if (typeof type !== "string" || !BLOCK_TYPES.has(type)) continue;

    const id = keepId(b, out.length, seenIds);

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
      case "objectives": {
        const items = clampStrArray(b.items, 300, MAX_POINTS);
        if (items.length === 0) continue;
        out.push({ id, type: "objectives", items });
        break;
      }
      case "scene": {
        const title = clampStr(b.title, 200);
        const markdown = clampStr(b.markdown, MAX_MARKDOWN);
        if (!title && !markdown) continue;
        out.push({ id, type: "scene", title, markdown });
        break;
      }
      case "dialog": {
        const rawTurns = Array.isArray(b.turns) ? b.turns : [];
        const turns = rawTurns
          .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === "object")
          .map((t) => {
            const speaker = clampStr(t.speaker, 60);
            const text = clampStr(t.text, 1000);
            const note = clampStr(t.note, 500);
            const turn: { speaker: string; text: string; note?: string } = { speaker, text };
            if (note) turn.note = note;
            return turn;
          })
          .filter((t) => t.text)
          .slice(0, MAX_TURNS);
        if (turns.length === 0) continue;
        out.push({ id, type: "dialog", turns });
        break;
      }
      case "steps": {
        const rawSteps = Array.isArray(b.steps) ? b.steps : [];
        const steps = rawSteps
          .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object")
          .map((s) => {
            const title = clampStr(s.title, 200);
            const detail = clampStr(s.detail, MAX_MARKDOWN);
            const step: { title: string; detail?: string } = { title };
            if (detail) step.detail = detail;
            return step;
          })
          .filter((s) => s.title)
          .slice(0, MAX_STEPS);
        if (steps.length === 0) continue;
        out.push({ id, type: "steps", steps });
        break;
      }
      case "compare": {
        const title = clampStr(b.title, 200);
        const rawLeft = (b.left && typeof b.left === "object" ? b.left : {}) as Record<string, unknown>;
        const rawRight = (b.right && typeof b.right === "object" ? b.right : {}) as Record<string, unknown>;
        const left = { heading: clampStr(rawLeft.heading, 100), items: clampStrArray(rawLeft.items, 300, MAX_POINTS) };
        const right = { heading: clampStr(rawRight.heading, 100), items: clampStrArray(rawRight.items, 300, MAX_POINTS) };
        if (left.items.length === 0 && right.items.length === 0) continue;
        const block: Block & { id: string } = { id, type: "compare", left, right };
        if (title) block.title = title;
        out.push(block);
        break;
      }
      case "example": {
        const markdown = clampStr(b.markdown, MAX_MARKDOWN);
        if (!markdown) continue;
        out.push({ id, type: "example", markdown });
        break;
      }
      case "flashcard": {
        const front = clampStr(b.front, 500);
        const back = clampStr(b.back, MAX_MARKDOWN);
        if (!front || !back) continue;
        out.push({ id, type: "flashcard", front, back });
        break;
      }
      case "summary": {
        const markdown = clampStr(b.markdown, MAX_MARKDOWN);
        if (!markdown) continue;
        const next = clampStr(b.next, 300);
        const block: Block & { id: string } = { id, type: "summary", markdown };
        if (next) block.next = next;
        out.push(block);
        break;
      }
      case "image": {
        // src 必须过白名单（站内 / 开头路径）；非法 src 直接丢弃该块，绝不渲染任意外链。
        const src = sanitizeImageSrc(b.src);
        if (!src) continue;
        const caption = clampStr(b.caption, 300);
        const alt = clampStr(b.alt, 300);
        const block: Block & { id: string } = { id, type: "image", src };
        if (caption) block.caption = caption;
        if (alt) block.alt = alt;
        out.push(block);
        break;
      }
      case "formula": {
        // 公式块：latex 必填（截断防爆）；display 缺省 true（独立居中，课件里公式一般单列展示）。
        const latex = clampStr(b.latex, MAX_LATEX);
        if (!latex) continue;
        const caption = clampStr(b.caption, 200);
        const block: Block & { id: string } = { id, type: "formula", latex, display: b.display !== false };
        if (caption) block.caption = caption;
        out.push(block);
        break;
      }
      case "fillblank": {
        // 填空：segments 文本段（N 段）与 blanks（N-1 个空，每空多写法）交替。
        // 段可为空串（空在句首/两空相邻是合法结构位），故保留空串、只截长限量。
        const segments = (Array.isArray(b.segments) ? b.segments : [])
          .filter((s): s is string => typeof s === "string")
          .map((s) => clampStr(s, 400))
          .slice(0, MAX_BLANKS + 1);
        const rawBlanks = Array.isArray(b.blanks) ? b.blanks : [];
        const blanks = rawBlanks
          .map((alt) => clampStrArray(alt, 80, 6))
          .filter((alt) => alt.length > 0)
          .slice(0, MAX_BLANKS);
        // 结构成立：至少 1 个空，且段数 = 空数 + 1（渲染按 seg,blank,seg,blank… 交替）。
        if (blanks.length === 0 || segments.length !== blanks.length + 1) continue;
        const prompt = clampStr(b.prompt, 200);
        const block: Block & { id: string } = { id, type: "fillblank", segments, blanks };
        if (prompt) block.prompt = prompt;
        out.push(block);
        break;
      }
      case "dragwords": {
        // 拖词：segments（N 段）与 blanks（N-1 个正解词）交替；distractors 干扰词入词库。
        // 段同 fillblank 允许空串（结构位）。
        const segments = (Array.isArray(b.segments) ? b.segments : [])
          .filter((s): s is string => typeof s === "string")
          .map((s) => clampStr(s, 400))
          .slice(0, MAX_BLANKS + 1);
        const blanks = clampStrArray(b.blanks, 60, MAX_BLANKS);
        if (blanks.length === 0 || segments.length !== blanks.length + 1) continue;
        const distractors = clampStrArray(b.distractors, 60, MAX_DISTRACTORS);
        const prompt = clampStr(b.prompt, 200);
        const block: Block & { id: string } = { id, type: "dragwords", segments, blanks };
        if (distractors.length) block.distractors = distractors;
        if (prompt) block.prompt = prompt;
        out.push(block);
        break;
      }
      case "diagram": {
        // 语义图示铁律（leohtml）：kind 白名单、节点须有标签、数量落在该结构成形的窗口内,否则整块丢弃。
        const kind = typeof b.kind === "string" && DIAGRAM_KINDS.has(b.kind) ? (b.kind as "flow") : null;
        if (!kind) continue;
        const rawItems = Array.isArray(b.items) ? b.items : [];
        const items = rawItems
          .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object")
          .map((s) => {
            const label = clampStr(s.label, 40);
            const detail = clampStr(s.detail, 90);
            const item: { label: string; detail?: string } = { label };
            if (detail) item.detail = detail;
            return item;
          })
          .filter((s) => s.label)
          .slice(0, MAX_DIAGRAM_ITEMS);
        if (items.length < (DIAGRAM_MIN[kind] ?? 2)) continue;
        const title = clampStr(b.title, 60);
        const note = clampStr(b.note, 140);
        const block: Block & { id: string } = { id, type: "diagram", kind, items };
        if (title) block.title = title;
        if (note) block.note = note;
        out.push(block);
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
      case "objectives":
        parts.push(b.items.map((p) => `- ${p}`).join("\n"));
        break;
      case "scene":
        if (b.title) parts.push(b.title);
        if (b.markdown) parts.push(b.markdown);
        break;
      case "dialog":
        parts.push(b.turns.map((t) => `${t.speaker}: ${t.text}`).join("\n"));
        break;
      case "steps":
        parts.push(b.steps.map((s, i) => `${i + 1}. ${s.title}${s.detail ? `\n   ${s.detail}` : ""}`).join("\n"));
        break;
      case "compare":
        if (b.title) parts.push(b.title);
        parts.push(`${b.left.heading}\n${b.left.items.map((p) => `- ${p}`).join("\n")}`);
        parts.push(`${b.right.heading}\n${b.right.items.map((p) => `- ${p}`).join("\n")}`);
        break;
      case "example":
        parts.push(b.markdown);
        break;
      case "flashcard":
        parts.push(`${b.front}\n${b.back}`);
        break;
      case "summary":
        parts.push(b.markdown);
        if (b.next) parts.push(b.next);
        break;
      case "image":
        // 图无文本可索引，取 caption / alt 作为可读文本（供搜索 / 伴侣上下文）。
        if (b.caption) parts.push(b.caption);
        else if (b.alt) parts.push(b.alt);
        break;
      case "diagram":
        if (b.title) parts.push(b.title);
        parts.push(b.items.map((s) => `${s.label}${s.detail ? `: ${s.detail}` : ""}`).join(" → "));
        if (b.note) parts.push(b.note);
        break;
      case "formula":
        // 公式无自然语言，取 caption 作可读文本（供检索/伴侣上下文）；latex 本身不入检索。
        if (b.caption) parts.push(b.caption);
        break;
      case "fillblank": {
        // 还原完整句（空处填第一个正解），供检索/伴侣上下文。
        let s = b.segments[0] ?? "";
        b.blanks.forEach((alt, i) => { s += (alt[0] ?? "____") + (b.segments[i + 1] ?? ""); });
        if (b.prompt) parts.push(b.prompt);
        parts.push(s);
        break;
      }
      case "dragwords": {
        let s = b.segments[0] ?? "";
        b.blanks.forEach((w, i) => { s += w + (b.segments[i + 1] ?? ""); });
        if (b.prompt) parts.push(b.prompt);
        parts.push(s);
        break;
      }
    }
  }
  return parts.join("\n\n").trim();
}
