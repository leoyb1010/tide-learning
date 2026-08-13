/**
 * 表现层付费操作的浏览器端幂等键。sessionStorage 跨组件卸载/刷新保留，
 * 但不跨浏览器会话长期堆积。服务端 GenerationJob 仍是最终真值与并发闸门。
 */
export function getOrCreatePresentationRequestId(scope: string): string {
  const key = storageKey(scope);
  try {
    const existing = sessionStorage.getItem(key)?.trim();
    if (existing && /^[A-Za-z0-9_-]{16,128}$/.test(existing)) return existing;
  } catch {
    // 隐私模式/存储策略可拒绝 sessionStorage，回落当前组件内存键。
  }
  const requestId = crypto.randomUUID();
  try { sessionStorage.setItem(key, requestId); } catch { /* 由调用方 ref 保底 */ }
  return requestId;
}

/** 只清除本次已知 requestId，避免旧响应误删新操作的键。 */
export function clearPresentationRequestId(scope: string, requestId: string): void {
  const key = storageKey(scope);
  try {
    if (sessionStorage.getItem(key) === requestId) sessionStorage.removeItem(key);
  } catch {
    // 不影响服务端幂等协议。
  }
}

/** 将当前标签页改绑到服务端已存在的规范操作，用于丢包/多标签页回放。 */
export function bindPresentationRequestId(scope: string, value: string): string | null {
  const requestId = value.trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) return null;
  try { sessionStorage.setItem(storageKey(scope), requestId); } catch { /* 调用方 ref 仍可保留 */ }
  return requestId;
}

function storageKey(scope: string): string {
  return `tide:presentation-request:v1:${scope}`;
}
