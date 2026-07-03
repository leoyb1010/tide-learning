"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "@phosphor-icons/react";
import { useToast } from "./Toast";
import { track } from "@/lib/analytics-client";

/**
 * AccessRequestActions —— 「我的分享」里一条待批准申请的批准/拒绝按钮（client）。
 * 调 /api/market/decide。批准后作者得积分奖励（服务端 grantCredits），本地隐藏该条。
 * STUDIO token。
 */
export function AccessRequestActions({ requestId }: { requestId: string }) {
  const { toast } = useToast();
  const router = useRouter();
  const [loading, setLoading] = useState<"approve" | "reject" | null>(null);
  const [done, setDone] = useState<"approved" | "rejected" | null>(null);

  async function decide(approve: boolean) {
    if (loading) return;
    setLoading(approve ? "approve" : "reject");
    try {
      const res = await fetch("/api/market/decide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId, approve }),
      });
      const json = (await res.json()) as
        | { ok: true; data: { status: string; reward?: number; message: string } }
        | { ok: false; error: string };
      if (!json.ok) {
        toast(json.error, { tone: "warn" });
        return;
      }
      setDone(json.data.status === "approved" ? "approved" : "rejected");
      toast(json.data.message, { tone: json.data.status === "approved" ? "success" : "info" });
      track("market_decide", { request_id: requestId, approve });
      router.refresh();
    } catch {
      toast("网络异常，请重试", { tone: "warn" });
    } finally {
      setLoading(null);
    }
  }

  if (done) {
    return (
      <span className="mono text-[12px] font-semibold text-[var(--ink3)]">
        {done === "approved" ? "已批准 · +10 积分" : "已拒绝"}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => decide(false)}
        disabled={loading !== null}
        className="studio-press inline-flex items-center gap-1 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--ink3)] transition-colors hover:text-[var(--ink)] disabled:opacity-50"
      >
        <X size={13} weight="bold" />
        {loading === "reject" ? "…" : "拒绝"}
      </button>
      <button
        onClick={() => decide(true)}
        disabled={loading !== null}
        className="studio-press inline-flex items-center gap-1 rounded-[10px] bg-[var(--red)] px-3 py-1.5 text-[12.5px] font-bold text-white transition-all hover:brightness-105 disabled:opacity-50"
      >
        <Check size={13} weight="bold" />
        {loading === "approve" ? "…" : "批准"}
      </button>
    </div>
  );
}
