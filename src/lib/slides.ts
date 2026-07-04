/**
 * 幻灯片分页协议 —— 把线性块数组切成「翻页课件」的一页页幕（纯函数，无副作用，无 IO，无 "use client"）。
 *
 * 背景：ai_block 课件原是一条长滚动流（BlockRenderer 纵向堆叠 12 种块）。翻页课件要求
 * 「单屏内、像黑板播放一样一页页翻」，所以需要把块按语义分组成若干「幕（Slide）」，每幕内
 * 是单屏能舒适容纳的一小组块。
 *
 * 设计原则：
 *   - 纯函数：只读块数组，产出 Slide[]，可在 server / client 复用（无 "use client"，遵守架构铁律）。
 *   - 语义优先：scene（开场）/objectives（学习目标）/summary（收束）各自独占一页，做转场停顿；
 *     quiz / flashcard 交互块也各自独立一页（避免一屏两道题挤压、给答题专注空间）。
 *   - 容量兜底：concept / example / callout / steps 等「叙述块」按内容重量累加进同一页，
 *     超过单屏舒适容量就换页，避免一页塞太长又退化成滚动。
 *   - 稳定 id：每页有可复现 id（页序 + 主块类型），供翻页动画 key / 进度锚点引用。
 *   - 永不丢块：任何块都会落到某一页；空输入返回空数组。
 */

import type { Block } from "./blocks";

export type BlockWithId = Block & { id: string };

export interface Slide {
  /** 稳定页 id：slide_<页序>_<主块类型>，供翻页 key / 进度锚点。 */
  id: string;
  /** 本页包含的块（按原顺序）。 */
  blocks: BlockWithId[];
  /** 本页语义种类，驱动黑板底纹选择与页眉标签。 */
  kind: SlideKind;
}

/** 页的语义种类：决定视觉基调（深色黑板 / 纸面 / 交互）与页眉标签文案。 */
export type SlideKind =
  | "scene" // 深色黑板开场（为什么学）
  | "objectives" // 学习目标页
  | "content" // 常规讲述页（concept/example/callout/code/steps/compare/dialog/keypoint 组合）
  | "quiz" // 测验页（独立，专注答题）
  | "flashcard" // 记忆卡页（独立，翻面）
  | "summary"; // 收束页

/**
 * 单屏「舒适容量」预算：每页块按各自「重量」累加，超预算即换页。
 * 重量是相对经验值，不追求像素精确 —— 目的是避免一页过长退化成滚动，同时不至于一块一页太碎。
 */
const PAGE_BUDGET = 100;

/** 触发「本块太重，宜独占一页」的阈值：超过此重量的单块，若当前页已有内容则先另起一页。 */
const HEAVY_BLOCK = 78;

/** 每页最多容纳的「叙述块」数量硬上限（即便都很短，也不把太多块塞进一屏）。 */
const MAX_BLOCKS_PER_PAGE = 3;

/** 独占整页的块类型：这些块要么是章节节点（场景/目标/小结），要么是需要专注的交互块。 */
const SOLO_TYPES = new Set<Block["type"]>(["scene", "objectives", "summary", "quiz", "flashcard"]);

/**
 * 估算单块的「屏幕重量」（0-100 尺度，越大越占屏）。
 * 只看文本体量与结构条目数的粗略叠加，够用即可，不做精确排版度量。
 */
export function blockWeight(b: BlockWithId): number {
  switch (b.type) {
    case "concept":
      return 22 + textWeight(b.markdown) + (b.title ? 6 : 0);
    case "code":
      // 代码块自带滚动区，按行数折算，封顶避免超长代码把预算算爆
      return 30 + Math.min(50, lineCount(b.code) * 3) + (b.explanation ? textWeight(b.explanation) : 0);
    case "quiz":
      return 40 + b.options.length * 8; // 独占页，权重仅用于极端拆分判断
    case "keypoint":
      return 18 + b.points.length * 9;
    case "callout":
      return 16 + textWeight(b.markdown);
    case "objectives":
      return 30 + b.items.length * 9;
    case "scene":
      return 60 + textWeight(b.markdown); // 开场页，视觉重
    case "dialog":
      return 24 + b.turns.length * 11;
    case "steps":
      return 22 + b.steps.length * 14;
    case "compare":
      return 34 + Math.max(b.left.items.length, b.right.items.length) * 8;
    case "example":
      return 20 + textWeight(b.markdown);
    case "flashcard":
      return 60; // 独占页
    case "summary":
      return 40 + textWeight(b.markdown) + (b.next ? 8 : 0);
    case "image":
      // 图占屏可观（默认 16:9 级），偏重块；有说明再加一点。翻页时倾向让图解少挤同页。
      return 56 + (b.caption ? textWeight(b.caption) : 0);
    default:
      return 24;
  }
}

/** 文本体量 → 重量（约每 90 字 +10，封顶 60，避免超长 markdown 单块吃掉整个预算算式失真）。 */
function textWeight(s: string): number {
  if (!s) return 0;
  return Math.min(60, Math.round((s.length / 90) * 10));
}

/** 粗算代码行数（用于代码块重量）。 */
function lineCount(code: string): number {
  if (!code) return 0;
  let n = 1;
  for (let i = 0; i < code.length; i++) if (code[i] === "\n") n++;
  return n;
}

/** 给某类块推导页语义（用于该块「独占页」时的页 kind）。 */
function soloKind(type: Block["type"]): SlideKind {
  switch (type) {
    case "scene":
      return "scene";
    case "objectives":
      return "objectives";
    case "summary":
      return "summary";
    case "quiz":
      return "quiz";
    case "flashcard":
      return "flashcard";
    default:
      return "content";
  }
}

/**
 * 把块数组分组成幻灯片页序列。
 *
 * 规则（顺序敏感，保持块原始次序）：
 *   1. SOLO_TYPES（scene/objectives/summary/quiz/flashcard）各自独占一页 —— 先把当前累积的叙述页收口，
 *      再把该块单独成页。这样开场、目标、每道题、每张卡、小结都是干净的一屏。
 *   2. 其余「叙述块」累加进当前页，直到触发换页：
 *        - 达到块数硬上限 MAX_BLOCKS_PER_PAGE；或
 *        - 累加后超过单屏预算 PAGE_BUDGET；或
 *        - 遇到「重块」（weight ≥ HEAVY_BLOCK）且当前页已有内容 —— 重块另起一页，宁可它独占。
 *   3. 收尾把最后残留的叙述页 flush。
 *
 * 永远返回合法数组：空输入 → 空数组；每个块必落一页。
 */
export function groupBlocksToSlides(blocks: BlockWithId[]): Slide[] {
  if (!blocks || blocks.length === 0) return [];

  const slides: Slide[] = [];
  let bucket: BlockWithId[] = [];
  let bucketWeight = 0;

  const flush = () => {
    if (bucket.length === 0) return;
    slides.push(makeSlide(slides.length, bucket, "content"));
    bucket = [];
    bucketWeight = 0;
  };

  for (const b of blocks) {
    // 1) 独占页块：先收口当前叙述页，再单独成页
    if (SOLO_TYPES.has(b.type)) {
      flush();
      slides.push(makeSlide(slides.length, [b], soloKind(b.type)));
      continue;
    }

    // 2) 叙述块：判断是否需要在加入前先换页
    const w = blockWeight(b);
    const wouldOverflow = bucket.length > 0 && (bucketWeight + w > PAGE_BUDGET || bucket.length >= MAX_BLOCKS_PER_PAGE);
    const heavyAlone = bucket.length > 0 && w >= HEAVY_BLOCK;
    if (wouldOverflow || heavyAlone) flush();

    bucket.push(b);
    bucketWeight += w;

    // 单块就已撑满预算：直接收口，避免下一块硬挤同页
    if (bucketWeight >= PAGE_BUDGET || bucket.length >= MAX_BLOCKS_PER_PAGE) flush();
  }

  // 3) 收尾
  flush();
  return slides;
}

/** 构造一页，id 用页序 + 主块类型，保证可复现且在 DOM 中稳定。 */
function makeSlide(index: number, blocks: BlockWithId[], kind: SlideKind): Slide {
  const head = blocks[0]?.type ?? "content";
  return { id: `slide_${index}_${head}`, blocks, kind };
}

/** 页眉小标签文案（黑板顶部「粉笔标」）。纯展示映射，可在组件里复用。 */
export function slideKindLabel(kind: SlideKind): string {
  switch (kind) {
    case "scene":
      return "开场";
    case "objectives":
      return "学习目标";
    case "quiz":
      return "随堂测";
    case "flashcard":
      return "记忆卡";
    case "summary":
      return "本节小结";
    default:
      return "讲解";
  }
}
