"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "./ui";
import { yuan, PLAN_PERIOD_LABELS } from "@/lib/format";

export interface PlanData {
  id: string;
  name: string;
  billingPeriod: string;
  priceCents: number;
  firstPriceCents: number | null;
  currency: string;
  highlight: boolean;
}

/**
 * SubscriptionCard — §6.1：连续包月默认高亮，但不得默认勾选额外服务。
 * 点击后走 mock 收银台：checkout/session → webhook（模拟支付成功）。
 */
export function SubscriptionCard({
  plan,
  isLoggedIn,
  redirectTo,
}: {
  plan: PlanData;
  isLoggedIn: boolean;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const price = plan.firstPriceCents ?? plan.priceCents;
  const periodLabel = PLAN_PERIOD_LABELS[plan.billingPeriod] ?? plan.billingPeriod;

  async function subscribe() {
    if (!isLoggedIn) {
      router.push(`/login?next=${encodeURIComponent(redirectTo ?? "/pricing")}`);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      // 1. 发起支付
      const s = await fetch("/api/checkout/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId: plan.id, channel: "stripe" }),
      }).then((r) => r.json());
      if (!s.ok) throw new Error(s.error);
      // 2. 模拟收银台回调支付成功（真实环境由渠道 webhook 触发）
      const w = await fetch(s.data.confirmUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventType: "payment.succeeded",
          externalId: s.data.externalOrderId,
          externalOrderId: s.data.externalOrderId,
        }),
      }).then((r) => r.json());
      if (!w.ok) throw new Error(w.error);
      router.push(redirectTo ?? "/me/subscription");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message || "支付失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-6 ${
        plan.highlight ? "border-tide-600 bg-paper-raised shadow-[var(--shadow-soft)]" : "border-ink-200 bg-paper-raised"
      }`}
    >
      {plan.highlight && (
        <div className="absolute -top-3 left-6">
          <Badge tone="tide">推荐</Badge>
        </div>
      )}
      <div className="flex items-baseline justify-between">
        <h3 className="text-base font-semibold text-ink-950">{plan.name}</h3>
        <span className="text-xs text-ink-400">{periodLabel}</span>
      </div>
      <div className="mt-4 flex items-baseline gap-1">
        <span className="text-sm text-ink-500">¥</span>
        <span className="text-4xl font-semibold text-ink-950 tabular">{yuan(price)}</span>
        <span className="text-sm text-ink-400">
          /{plan.billingPeriod === "year" ? "年" : "月"}
        </span>
      </div>
      {plan.firstPriceCents != null && plan.firstPriceCents < plan.priceCents && (
        <p className="mt-1 text-xs text-dawn-500">首月特惠，之后 ¥{yuan(plan.priceCents)}/月</p>
      )}
      <ul className="mt-5 flex-1 space-y-2 text-sm text-ink-500">
        <li>✓ 解锁全站课程</li>
        <li>✓ 本周上新可学习</li>
        <li>✓ 无限笔记 + 时间戳锚点</li>
        <li>✓ 需求投票权</li>
      </ul>
      <button
        onClick={subscribe}
        disabled={loading}
        className={`btn mt-6 w-full rounded-xl py-3 font-medium transition-all duration-150 disabled:opacity-50 ${
          plan.highlight ? "bg-tide-600 text-white hover:bg-tide-700" : "border border-ink-200 bg-white text-ink-950 hover:border-tide-400"
        }`}
      >
        {loading ? "处理中…" : isLoggedIn ? "立即订阅" : "登录后订阅"}
      </button>
      {err && <p className="mt-2 text-center text-xs text-error">{err}</p>}
      <p className="mt-3 text-center text-xs text-ink-400">随时可取消 · 取消后笔记仍保留</p>
    </div>
  );
}
