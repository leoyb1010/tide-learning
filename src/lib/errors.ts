/**
 * 纯错误类型 —— 零依赖（不引 next/headers / prisma / session），
 * 可被 client 与 server 双侧安全 import，切断 credits → api → session 的传染链。
 */

/**
 * 业务级错误：message 可安全回传客户端。
 * 与之相对，未包裹的 Error / Prisma 错误一律折叠为通用文案（A1-6：不泄露内部）。
 */
export class AppError extends Error {
  // retryable：仅 llm 层重试决策用。上游 4xx 折叠成 502 后按 status 已无法判定是否可重试，
  // 用此标记显式区分「客户端可见 502 但内部不可重试」（如上游 4xx 配置错、payload 超限）。
  constructor(message: string, public status = 400, public retryable?: boolean) {
    super(message);
  }
}

/** 写日志前移除常见凭据；不追求还原，只保证原始秘密不落盘。 */
export function redactSensitiveText(value: unknown): string {
  return String(value)
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+\/-]+=*/gi, "$1 [REDACTED]")
    .replace(/\b(sk|pk|whsec)_[A-Za-z0-9_-]{8,}\b/gi, "[REDACTED]")
    .replace(/((?:password|passwd|token|secret|session|api[_-]?key)\s*[=:]\s*)[^\s,;\"'}]+/gi, "$1[REDACTED]");
}
