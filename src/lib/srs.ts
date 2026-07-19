/**
 * SRS（间隔重复）调度 —— FSRS-6（吸收 open-spaced-repetition/ts-fsrs，MIT）。
 *
 * v4.4 起唯一调度算法：**FSRS-6**（Anki 新一代默认，基于 DSR 记忆模型的 difficulty/stability/
 * retrievability 三变量，实证同等留存下复习次数更少）。ts-fsrs 纯 TS 零运行时依赖，
 * 全在服务端算几个公式，用户端零增重。
 *
 * 历史：此前为「简化 SM-2」（ease/intervalDays 机械翻倍），已于 2026-07-19 换代删除
 * （无任何生产回退路径，git 历史可查）。ReviewCard 的 ease/intervalDays 列保留作展示遗产。
 *
 * 兼容：老客户端的两键「记得/忘了」经 rememberedToGrade 映射为 Good/Again。
 * 存量卡冷启动：无 FSRS 状态（stability/difficulty NULL）→ 视为「新卡」，首评按默认参数
 * 初始化，之后自然收敛。
 */

import { fsrs, generatorParameters, createEmptyCard, State, type Card as FsrsCard, type Grade as FsrsGrade } from "ts-fsrs";

/** 一天的毫秒数（review-card route / 测试共用）。 */
export const DAY_MS = 86_400_000;

/** 复习四档评分（对齐 FSRS Rating；数值与 ts-fsrs 一致，可直接落库/传参）。 */
export const Grade = { Again: 1, Hard: 2, Good: 3, Easy: 4 } as const;
export type GradeValue = (typeof Grade)[keyof typeof Grade];

/** 合法评分校验（路由入参防脏）。 */
export function isGrade(n: unknown): n is GradeValue {
  return n === 1 || n === 2 || n === 3 || n === 4;
}

/** 两键「记得/忘了」→ 四档映射（老客户端兼容：记得=Good、忘了=Again）。 */
export function rememberedToGrade(remembered: boolean): GradeValue {
  return remembered ? Grade.Good : Grade.Again;
}

/** 单例调度器（默认参数 + 关闭模糊化，保证同输入确定可复现，利于测试与幂等）。 */
const scheduler = fsrs(generatorParameters({ enable_fuzz: false }));

/** DB 里与 FSRS 调度相关的列（ReviewCard 的子集，供从任意来源构造）。 */
export interface FsrsColumns {
  stability?: number | null;
  difficulty?: number | null;
  state?: number | null;
  reps?: number | null;
  lapses?: number | null;
  elapsedDays?: number | null;
  scheduledDays?: number | null;
  learningSteps?: number | null;
  lastReview?: Date | null;
  dueAt: Date;
}

/** FSRS 调度产物：回写 ReviewCard 的列 + 便于展示的 intervalDays。 */
export interface FsrsResult {
  dueAt: Date;
  stability: number;
  difficulty: number;
  state: number;
  reps: number;
  lapses: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  lastReview: Date;
  /** 展示用：本次排程的间隔天数（=scheduled_days，回填遗产列，UI 直接可用）。 */
  intervalDays: number;
}

/** 从 DB 列重建一张 ts-fsrs Card。stability/difficulty 为空（存量老卡）→ 视为新卡冷启动。 */
function reconstructCard(c: FsrsColumns): FsrsCard {
  // 老卡无 FSRS 状态：以「新卡」初始化，due 用其现有 dueAt（不打断既有到期节奏）。
  if (c.stability == null || c.difficulty == null || !c.state) {
    const empty = createEmptyCard(c.lastReview ?? new Date());
    return { ...empty, due: c.dueAt };
  }
  return {
    due: c.dueAt,
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsedDays ?? 0,
    scheduled_days: c.scheduledDays ?? 0,
    reps: c.reps ?? 0,
    lapses: c.lapses ?? 0,
    learning_steps: c.learningSteps ?? 0,
    state: c.state as State,
    last_review: c.lastReview ?? undefined,
  };
}

/**
 * FSRS-6 调度：给定卡当前状态与本次评分，算出下一轮全部状态列。
 * @param card  DB 列快照。
 * @param grade 四档评分（1-4）。
 * @param now   当前时刻（默认 Date.now()，注入以便测试确定化）。
 */
export function scheduleFsrs(card: FsrsColumns, grade: GradeValue, now: number = Date.now()): FsrsResult {
  const nowDate = new Date(now);
  const prev = reconstructCard(card);
  // grade 值 1-4 与 ts-fsrs 的 Grade(Rating 去掉 Manual)数值一致，安全窄化。
  const { card: next } = scheduler.next(prev, nowDate, grade as unknown as FsrsGrade);
  return {
    dueAt: next.due,
    stability: next.stability,
    difficulty: next.difficulty,
    state: next.state,
    reps: next.reps,
    lapses: next.lapses,
    elapsedDays: next.elapsed_days,
    scheduledDays: next.scheduled_days,
    learningSteps: next.learning_steps,
    lastReview: next.last_review ?? nowDate,
    intervalDays: next.scheduled_days,
  };
}
