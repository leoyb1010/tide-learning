export type ImportRequestScope = "paste" | "file";

function storageKey(scope: ImportRequestScope): string {
  return `tide:import-request:v1:${scope}`;
}

/** 粘贴和文件导入各自跨刷新保留一个稳定 requestId。 */
export function getOrCreateImportRequestId(scope: ImportRequestScope): string {
  const key = storageKey(scope);
  try {
    const existing = sessionStorage.getItem(key)?.trim();
    if (existing && /^[A-Za-z0-9_-]{16,128}$/.test(existing)) return existing;
  } catch {
    // 隐私模式不支持 sessionStorage 时，当次请求仍有随机键。
  }
  const requestId = crypto.randomUUID();
  try { sessionStorage.setItem(key, requestId); } catch { /* no-op */ }
  return requestId;
}

export function clearImportRequestId(scope: ImportRequestScope, requestId: string): void {
  try {
    const key = storageKey(scope);
    if (sessionStorage.getItem(key) === requestId) sessionStorage.removeItem(key);
  } catch {
    // 服务端是幂等真值，清理失败不改变安全性。
  }
}

/** running / 不确定 5xx 保留；只有服务端明确返回终态 4xx 才清理。 */
export function shouldPreserveImportRequestId(value: unknown, httpStatus?: number): boolean {
  if (!value || typeof value !== "object") return true;
  const data = (value as { data?: unknown }).data;
  if (data && typeof data === "object") {
    const contract = data as { code?: unknown; preserveRequestId?: unknown };
    if (contract.code === "IMPORT_RUNNING" && contract.preserveRequestId === true) return true;
  }
  if (typeof httpStatus !== "number" || httpStatus >= 500) return true;
  return false;
}
