/**
 * Variance 引擎（v3.3 · HTML 课件）—— 多样性的核心，且**在编排层显式抽签**，不让 LLM 隐式 roll。
 *
 * 见计划文档：high-end-visual-design / gpt-taste 的"多样性来自封闭原型库 × 种子抽样"，
 * 关键是把抽签放到确定性代码里（种子 = 课+节+序），保证：① 同一节稳定可复现；② 节与节之间分化
 * （用 sortOrder 掺入种子，相邻节不易撞版式）；③ 可单测、可回归。渲染器（courseware-html.ts）据此选版式。
 *
 * 纯函数、无副作用、无随机源。
 */

import { hashSeed, type CourseDesign } from "./courseware-design";

/** 从数组按种子确定性挑一个。 */
export function seededPick<T>(arr: readonly T[], seed: number): T {
  return arr[seed % arr.length];
}

/** 混入索引再哈希，得到"同种子不同维度/不同块"的独立子种子（避免各维度同步撞车）。 */
function subSeed(seed: number, salt: number): number {
  return hashSeed(`${seed}:${salt}`);
}

// —— 每种场景/块型的版式原型池（渲染器据 variant 走不同 HTML/CSS 布局）——
const OPENER_LAYOUTS = ["hero-center", "hero-left", "hero-band"] as const;
const CONCEPT_LAYOUTS = ["accent-bar", "big-lead", "split-note", "framed"] as const;
const EXAMPLE_LAYOUTS = ["quote-card", "ticket", "inline-mark"] as const;
const STEPS_LAYOUTS = ["timeline", "numbered-cards", "rail"] as const;
const COMPARE_LAYOUTS = ["duel", "stacked", "ledger"] as const;
const QUIZ_LAYOUTS = ["stage", "split"] as const;
const KEYPOINT_LAYOUTS = ["wall", "checklist"] as const;
const SUMMARY_LAYOUTS = ["band", "card"] as const;

export type MotionParadigm = "reveal-up" | "reveal-fade" | "stagger" | "scale-in";
const MOTION_POOL: MotionParadigm[] = ["reveal-up", "reveal-fade", "stagger", "scale-in"];

/** 本节的 Variance 抽签结果。渲染器按它决定每块的版式与整节动效强度。 */
export interface LessonVariance {
  seed: number;
  /** 开场版式。 */
  opener: (typeof OPENER_LAYOUTS)[number];
  /** 本节启用的动效范式集合（数量随 motion 旋钮）。 */
  motionSet: MotionParadigm[];
  /** 是否用较重的滚动/缩放动效（motion 旋钮高时）。 */
  richMotion: boolean;
  /** 内部：块级版式选择器（渲染器逐块调用）。 */
  variantForBlock: (type: string, index: number) => string;
}

/**
 * 解析本节 Variance。seed 掺入 courseId + lessonId + title + sortOrder，
 * 保证同节稳定、相邻节分化。motionSet 数量随 design.motion 旋钮。
 */
export function resolveLessonVariance(
  courseId: string,
  lesson: { id: string; title?: string | null; sortOrder?: number | null },
  design: CourseDesign,
): LessonVariance {
  const seed = hashSeed(`lv:${courseId}:${lesson.id}:${lesson.title ?? ""}:${lesson.sortOrder ?? 0}`);

  const opener = seededPick(OPENER_LAYOUTS, subSeed(seed, 1));

  // motion 旋钮 → 动效集合大小（1..4）。低动效（如银发课）只留 1 个温和入场。
  const motionCount = Math.max(1, Math.min(4, Math.round(design.motion / 2.5)));
  // 从池中取不重复的 motionCount 个（用不同子种子挑，去重）。
  const motionSet: MotionParadigm[] = [];
  for (let i = 0; i < MOTION_POOL.length && motionSet.length < motionCount; i++) {
    const m = seededPick(MOTION_POOL, subSeed(seed, 10 + i));
    if (!motionSet.includes(m)) motionSet.push(m);
  }
  if (motionSet.length === 0) motionSet.push("reveal-fade");
  const richMotion = design.motion >= 6;

  const pools: Record<string, readonly string[]> = {
    scene: OPENER_LAYOUTS,
    concept: CONCEPT_LAYOUTS,
    example: EXAMPLE_LAYOUTS,
    steps: STEPS_LAYOUTS,
    compare: COMPARE_LAYOUTS,
    quiz: QUIZ_LAYOUTS,
    keypoint: KEYPOINT_LAYOUTS,
    summary: SUMMARY_LAYOUTS,
  };

  // variance 旋钮低 → 版式选择更收敛（同型块多用同一版式）；高 → 每块按 index 掺种子更发散。
  const variantForBlock = (type: string, index: number): string => {
    const pool = pools[type];
    if (!pool || pool.length === 0) return "default";
    const idxSalt = design.variance >= 6 ? index : 0; // 低变化度：同型块统一版式；高：逐块分化
    return seededPick(pool, subSeed(seed, 100 + hashSeed(type) + idxSalt));
  };

  return { seed, opener, motionSet, richMotion, variantForBlock };
}
