import { randomUUID } from "node:crypto";
import { AppError } from "./errors";

/**
 * 付费幂等操作 requestId 的服务端统一校验/兜底。
 * import / course-outline / presentation 三族 operation 共用同一语法。
 */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export function validateRequestId(value: unknown): string {
  if (typeof value !== "string") throw new AppError("缺少 requestId", 400);
  const requestId = value.trim();
  if (!REQUEST_ID_PATTERN.test(requestId)) throw new AppError("requestId 格式错误", 400);
  return requestId;
}

/**
 * 兼容不发 requestId 的旧 iOS/Mac 客户端：缺失/空串 → 服务端生成一次性 ID
 * （回到 requestId 上线前语义：每次请求都是新操作，放弃丢包幂等回放）。
 * 有值但格式非法仍 400 —— 那是客户端 bug，不是旧客户端。
 */
export function ensureRequestId(value: unknown): string {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return `srv-${randomUUID().replace(/-/g, "")}`;
  }
  return validateRequestId(value);
}
