"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ripple } from "./motion";
import { useToast } from "./Toast";
import { track } from "@/lib/analytics-client";

/**
 * MockPayActions — mock 收银台的「模拟支付成功/失败」按钮（开发/演示）。
 * 不持渠道密钥：POST /api/checkout/mock-pay，由服务端签名后回调 webhook。
 */
export function MockPayActions({ externalOrderId, nextUrl }: { externalOrderId: string; nextUrl: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<null | "success" | "fail">(null);

  async function pay(outcome: "success" | "fail") {
    setBusy(outcome);
    try {
      const r = await fetch("/api/checkout/mock-pay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ externalOrderId, outcome }),
      }).then((res) => res.json());
      if (!r.ok) throw new Error(r.error);

      if (outcome === "success") {
        track("subscription_success", { via: "mock_checkout" });
        toast("支付成功，权益已开通", { tone: "success" });
        router.push(nextUrl);
        router.refresh();
      } else {
        toast("已模拟支付失败，订单保持待支付", { tone: "warn" });
        setBusy(null);
      }
    } catch (e) {
      toast((e as Error).message || "操作失败，请重试", { tone: "warn" });
      setBusy(null);
    }
  }

  return (
    <div className="mt-6 space-y-3">
      <Ripple className="w-full rounded-xl">
        <button
          onClick={() => pay("success")}
          disabled={busy !== null}
          className="btn flex w-full items-center justify-center gap-2 rounded-xl bg-accent-600 py-3 font-medium text-white transition-colors hover:bg-accent-700 disabled:opacity-60"
        >
          {busy === "success" && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
          模拟支付成功
        </button>
      </Ripple>
      <button
        onClick={() => pay("fail")}
        disabled={busy !== null}
        className="w-full rounded-xl border border-ink-200 py-2.5 text-sm text-ink-500 transition-colors hover:border-error hover:text-error disabled:opacity-60"
      >
        模拟支付失败
      </button>
    </div>
  );
}
