"use client";

import { useEffect, useRef } from "react";

/** Opt-in disposable CI diagnostics. Values are lengths/state only, never note text. */
export function useCaptureAuditTrace(component: string, state: Record<string, unknown>) {
  const identity = useRef<string | null>(null);
  const snapshot = JSON.stringify(state);
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_CAPTURE_AUDIT !== "1") return;
    const id = crypto.randomUUID();
    identity.current = id;
    const emit = (phase: string) => window.dispatchEvent(new CustomEvent("tide:capture-audit", { detail: { component, id, phase } }));
    emit("mount");
    return () => { emit("unmount"); identity.current = null; };
  }, [component]);
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_CAPTURE_AUDIT !== "1") return;
    window.dispatchEvent(new CustomEvent("tide:capture-audit", { detail: { component, id: identity.current, phase: "state", state: JSON.parse(snapshot) } }));
  }, [component, snapshot]);
}
