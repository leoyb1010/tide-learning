"use client";

import { useEffect } from "react";

/** 客户端埋点：页面曝光等事件上报（§10）。 */
export function TrackView({ event, properties }: { event: string; properties?: Record<string, unknown> }) {
  useEffect(() => {
    fetch("/api/analytics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventName: event, properties, platform: "web" }),
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
