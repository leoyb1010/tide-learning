/**
 * AI 错误 → 统一用户文案映射（流3 · U7）。
 *
 * 各 AI 出口（llm.ts / credits.ts）已把上游/预检错误折叠为 AppError（带 status + 中文 message），
 * 经 api.ts:handle() 原样回传客户端。绝大多数场景无需本模块——AppError.message 已是可读中文。
 *
 * 本模块的价值是「兜底一致性」：当某处只拿得到一个裸 status（例如手写 fetch 上游、
 * 或想对 AppError.message 做统一覆盖以对齐前端文案）时，用 aiErrorMessage(status) 得到
 * 与全站一致的一句话，避免各 route / 前端各写各的（"生成失败" / "服务异常" / "余额不够" 参差）。
 *
 * 覆盖的高频 AI 状态码：
 *   402 余额不足 —— assertCanSpend / recordLlmSpend 欠账后拦截
 *   429 上游/本地限流
 *   502 上游返回异常 / JSON 解析失败 / 返回为空（llm.ts 折叠）
 *   503 未配置 AI（无 DEEPSEEK_API_KEY）
 *   504 上游超时（AbortError）
 * 零依赖（不 import prisma/next），client 与 server 双侧可安全引用。
 */

/** AI 相关 HTTP 状态码 → 统一中文文案。未命中回落通用文案。 */
export const AI_ERROR_TEXT: Record<number, string> = {
  402: "积分不足，充值后可继续使用 AI 能力",
  429: "AI 请求过于频繁，请稍后再试",
  502: "AI 返回异常，请稍后重试",
  503: "AI 服务未配置，暂不可用",
  504: "AI 响应超时，请重试",
};

/** 通用兜底文案（未命中具体状态码时）。 */
export const AI_ERROR_FALLBACK = "AI 服务暂时不可用，请稍后再试";

/**
 * 据状态码取统一 AI 错误文案。
 * 传入非 AI 高频码（如 400/401/403/404/500）时回落通用文案——那些语义由各 route 自定，
 * 本 helper 只统一「AI 出口专属」的 402/429/502/503/504。
 */
export function aiErrorMessage(status: number): string {
  return AI_ERROR_TEXT[status] ?? AI_ERROR_FALLBACK;
}
