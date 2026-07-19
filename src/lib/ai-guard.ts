import type { User } from "@prisma/client";
import { AppError } from "./errors";
import { prisma } from "./db";
import { requireUser } from "./session";
import { resolveEntitlement, type EntitlementSnapshot } from "./entitlement";
import { assertCanSpend, ensureFreeMonthlyGrant, freeMonthlyCreditAmount, type Scene } from "./credits";
import { shanghaiDayKey } from "./week";

/**
 * requireLLMAccess —— AI 路由统一鉴权闸门（server-only）。
 *
 * 收敛此前散落在 ~9 个 AI 路由里逐字复制的四步块：
 *   requireUser() → resolveEntitlement() → if(!canUseLLM) 402 → assertCanSpend()
 * 逐字复制是越权 / 免单缺口的温床（改一处漏一处），此处集中管理，各路由改一行调用。
 *
 * 保持等价：
 *   - 402 文案仍可逐路由定制（deniedMessage），集中默认值兜底；
 *   - 余额预检可带场景（spendScene）走最坏成本门槛，或整体关闭（precheckSpend:false，
 *     供 review-card 这类「先判权益、真正花钱时再 assertCanSpend」的延迟扣费路由）。
 *   - 限流 / onUsage / 具体业务不在本 helper 内 —— 各路由保留自己的 scene、限流窗口与记账。
 *
 * 抛错语义与原写法一致：requireUser 抛 AuthError(401)，未订阅抛 AppError(402)，
 * assertCanSpend 余额不足抛 AppError(402)，均由 route 的 handle() 折叠为对应 fail()。
 */
export interface LLMAccessOptions {
  /** 未订阅（无 canUseLLM）时的 402 文案。默认通用文案。 */
  deniedMessage?: string;
  /** 是否在闸门内做余额预检（assertCanSpend）。默认 true；review-card 传 false 延迟扣费。 */
  precheckSpend?: boolean;
  /** 余额预检的场景：传入则按该场景最坏成本设门槛，否则最低 1 分。 */
  spendScene?: Scene;
}

export interface LLMAccessResult {
  user: User;
  snapshot: EntitlementSnapshot;
}

const DEFAULT_DENIED = "AI 功能需订阅后使用";

export async function requireLLMAccess(opts: LLMAccessOptions = {}): Promise<LLMAccessResult> {
  const user = await requireUser();

  const snapshot = await resolveEntitlement(user.id);
  if (!snapshot.canUseLLM) throw new AppError(opts.deniedMessage ?? DEFAULT_DENIED, 402);

  if (opts.precheckSpend !== false) {
    await assertCanSpend(user.id, opts.spendScene);
  }

  return { user, snapshot };
}

/** 蓝图 D5：每月免费造课次数（含导入课）。env FREE_COURSEGEN_MONTHLY 覆盖；0 = 关闭免费体验。 */
export function freeCourseGenQuota(): number {
  const n = Number(process.env.FREE_COURSEGEN_MONTHLY);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1;
}

/**
 * 免费造课剩余次数——**闸门与 UI 的唯一口径**（审计修复：此前 /create 页只查次数开关、
 * 漏查积分开关且自行复制月界统计，两处口径漂移会出现「入口亮着点了 402」）。
 * 返回 null = 免费体验整体关闭（次数或积分任一开关为 0）。
 */
export async function freeCourseGenRemaining(userId: string): Promise<number | null> {
  const quota = freeCourseGenQuota();
  if (quota <= 0 || freeMonthlyCreditAmount() <= 0) return null;
  const monthKey = shanghaiDayKey().slice(0, 7); // Asia/Shanghai 当月
  const used = await prisma.course.count({
    where: {
      authorUserId: userId,
      origin: { in: ["ai_generated", "user_imported"] },
      createdAt: { gte: new Date(`${monthKey}-01T00:00:00+08:00`) },
    },
  });
  return Math.max(0, quota - used);
}

export interface CourseGenAccessResult extends LLMAccessResult {
  /** 本次是否走免费体验额度（造课路由据此强制 standard 档 + free tier 模型）。 */
  viaFreeQuota: boolean;
}

/**
 * 蓝图 D5（审查 P1-9）：造课/导入专属闸门——订阅者走老路；免费用户每月 N 次体验造课
 * （standard 档、free tier 模型），解开「不订阅→没体验→不订阅」的冷启动死锁。
 * 只放宽「造一门课」这一个动作；companion/笔记 AI 等其余 AI 能力仍走 requireLLMAccess 会员门。
 * 免费路径顺手发放月度体验积分（ensureFreeMonthlyGrant），再过与订阅者相同的余额预检，
 * 计费与预算闸门（逐节投影/inflight）全部原样生效——免费不等于绕过任何成本护栏。
 */
export async function requireCourseGenAccess(opts: LLMAccessOptions = {}): Promise<CourseGenAccessResult> {
  const user = await requireUser();
  const snapshot = await resolveEntitlement(user.id);

  if (snapshot.canUseLLM) {
    if (opts.precheckSpend !== false) await assertCanSpend(user.id, opts.spendScene);
    return { user, snapshot, viaFreeQuota: false };
  }

  const remaining = await freeCourseGenRemaining(user.id);
  if (remaining === null) throw new AppError(opts.deniedMessage ?? DEFAULT_DENIED, 402);
  if (remaining <= 0) {
    throw new AppError(`本月 ${freeCourseGenQuota()} 次免费造课已用完，订阅后可不限次造课并解锁精修排版`, 402);
  }

  await ensureFreeMonthlyGrant(user.id, shanghaiDayKey().slice(0, 7));
  if (opts.precheckSpend !== false) await assertCanSpend(user.id, opts.spendScene);
  return { user, snapshot, viaFreeQuota: true };
}

/**
 * 蓝图 D5 配套：逐节生成/HTML 渲染的闸门——免费用户对「自己名下、由造课主链建出的课」放行，
 * 让免费体验课的前端逐节流水与失败重试可用；其余场景仍要求会员。
 */
export async function requireLessonGenAccess(
  courseAuthorUserId: string | null | undefined,
  opts: LLMAccessOptions = {},
): Promise<LLMAccessResult> {
  const user = await requireUser();
  const snapshot = await resolveEntitlement(user.id);

  const ownCourse = Boolean(courseAuthorUserId && courseAuthorUserId === user.id);
  if (!snapshot.canUseLLM && !(ownCourse && freeCourseGenQuota() > 0)) {
    throw new AppError(opts.deniedMessage ?? DEFAULT_DENIED, 402);
  }
  // 审计修复：免费路径同样确保当月体验积分已发放——否则跨月重试自己课的逐节生成时,
  // 月度积分未发、预检直接 402,与「重试/续跑可用」的设计意图相悖。幂等,已发放则无操作。
  if (!snapshot.canUseLLM) {
    await ensureFreeMonthlyGrant(user.id, shanghaiDayKey().slice(0, 7));
  }
  if (opts.precheckSpend !== false) await assertCanSpend(user.id, opts.spendScene);
  return { user, snapshot };
}
