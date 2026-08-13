const STORAGE_KEY = "tide:course-outline-request:v1";

/** 造课 requestId 跨刷新保留，供响应丢失后向服务端回放同一结果。 */
export function getOrCreateCourseOutlineRequestId(): string {
  try {
    const existing = sessionStorage.getItem(STORAGE_KEY)?.trim();
    if (existing && /^[A-Za-z0-9_-]{16,128}$/.test(existing)) return existing;
  } catch {
    // 隐私模式不支持 sessionStorage 时仍可用随机键完成当次请求。
  }
  const requestId = crypto.randomUUID();
  try { sessionStorage.setItem(STORAGE_KEY, requestId); } catch { /* no-op */ }
  return requestId;
}

export function clearCourseOutlineRequestId(requestId: string): void {
  try {
    if (sessionStorage.getItem(STORAGE_KEY) === requestId) sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // 服务端是幂等真值，清理失败不影响安全。
  }
}

/**
 * 失败是否仍可能对应一个正在运行或已经提交的耐久操作。
 * 结构化 running 契约与所有不确定的 5xx / 非 JSON 响应都必须保留原 ID；
 * 只有明确解析出的终态 4xx 才允许下一次点击成为新意图。
 */
export function shouldPreserveCourseOutlineRequestId(value: unknown, httpStatus?: number): boolean {
  if (!value || typeof value !== "object") return true;
  const data = (value as { data?: unknown }).data;
  if (data && typeof data === "object") {
    const contract = data as { code?: unknown; preserveRequestId?: unknown };
    if (contract.code === "COURSE_OUTLINE_RUNNING" && contract.preserveRequestId === true) return true;
  }
  if (typeof httpStatus !== "number" || httpStatus >= 500) return true;
  return false;
}
