"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { track } from "@/lib/analytics-client";

export function ScormCourseware({ configJson, lessonId, title, onComplete }: { configJson: string; lessonId: string; title: string; onComplete?: () => void }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const config = useMemo(() => {
    try {
      const parsed = JSON.parse(configJson) as { v?: number; assetId?: string; launchPath?: string };
      if (parsed.v === 1 && /^[A-Za-z0-9_-]{1,80}$/.test(parsed.assetId ?? "") && parsed.launchPath) return parsed;
    } catch { /* 损坏配置在下方展示失败态 */ }
    return null;
  }, [configJson]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
      const data = event.data;
      if (!data || data.type !== "ct-scorm" || typeof data.key !== "string") return;
      track("scorm_runtime_event", { lesson_id: lessonId, key: data.key, value: typeof data.value === "string" ? data.value.slice(0, 100) : null });
      const value = String(data.value ?? "").toLowerCase();
      if ((data.key.includes("lesson_status") || data.key.includes("completion_status")) && ["completed", "passed"].includes(value)) onComplete?.();
      if (data.key === "finish") onComplete?.();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [lessonId, onComplete]);

  // 取播放签名(审查 M1/P0):sandbox 不透明源带不上 cookie,子资源鉴权靠嵌进路径段的 2h 签名 token
  // ——包内相对引用解析时天然继承它。取号端在服务端做完整权益校验。
  const [token, setToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    fetch(`/api/scorm/${encodeURIComponent(config.assetId!)}/token`)
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as { data?: { token?: string }; error?: string } | null;
        if (cancelled) return;
        if (res.ok && json?.data?.token) setToken(json.data.token);
        else setTokenError(json?.error || "无法获取播放授权");
      })
      .catch(() => { if (!cancelled) setTokenError("网络异常，无法获取播放授权"); });
    return () => { cancelled = true; };
  }, [config]);

  if (!config) return <div className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-6 text-[13px] text-[var(--ink3)]">SCORM 启动信息损坏，无法打开本节。</div>;
  if (tokenError) return <div className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-6 text-[13px] text-[var(--ink3)]">{tokenError}</div>;
  if (!token) return <div className="flex h-[min(76vh,820px)] min-h-[560px] w-full items-center justify-center rounded-[14px] border border-[var(--border)] bg-[var(--surface2)] text-[13px] text-[var(--ink3)]">正在打开课件…</div>;
  const src = `/api/scorm/${encodeURIComponent(config.assetId!)}/${token}/${config.launchPath!.split("/").map(encodeURIComponent).join("/")}`;
  return (
    <div className="overflow-hidden rounded-[14px] border border-[var(--border)] bg-white shadow-[var(--card)]">
      <iframe ref={iframeRef} src={src} title={title} sandbox="allow-scripts allow-forms" allowFullScreen className="block h-[min(76vh,820px)] min-h-[560px] w-full border-0" />
    </div>
  );
}
