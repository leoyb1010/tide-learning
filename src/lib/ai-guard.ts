import type { User } from "@prisma/client";
import { AppError } from "./errors";
import { requireUser } from "./session";
import { resolveEntitlement, type EntitlementSnapshot } from "./entitlement";
import { assertCanSpend, type Scene } from "./credits";

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
