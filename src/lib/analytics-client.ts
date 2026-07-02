/** 客户端埋点：POST /api/analytics，失败静默不影响主流程。 */
export function track(eventName: string, properties?: Record<string, unknown>) {
  try {
    const body = JSON.stringify({ eventName, properties: properties ?? {} });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/analytics", new Blob([body], { type: "application/json" }));
    } else {
      fetch("/api/analytics", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
    }
  } catch {
    /* noop */
  }
}
