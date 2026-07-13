/**
 * 定价换算纯函数 —— 零依赖、无 "use client"，server 与 client 双侧可安全 import。
 */

// 一门完整 AI 造课 ≈ 大纲(≤6k token) + 6~8 节正文(各 ≤6k) ≈ 40~50k token ≈ 40 积分。
// 取保守 40，「可造约 x 门课」= floor(月赠积分 / 40)，宁少不多，诚实不夸大。
export const CREDITS_PER_COURSE = 40;

/** 月赠积分可造约几门 AI 课（至少 1，向下取整，不夸大）。 */
export function coursesFromGrant(grant: number): number {
  return Math.max(1, Math.floor(grant / CREDITS_PER_COURSE));
}

/** 只展示当前支付渠道真正能完成结算的套餐，避免把不支持的自动续费卖给用户。 */
export function isPlanSupportedByChannel(billingPeriod: string, channel: string): boolean {
  if (channel === "stripe") return billingPeriod !== "month_recurring";
  return billingPeriod !== "month";
}
