"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "./ui";
import { Ripple } from "./motion";
import { useToast } from "./Toast";
import { yuan, PLAN_PERIOD_LABELS } from "@/lib/format";
import { trackLabel } from "@/lib/tracks";
import { track } from "@/lib/analytics-client";

export interface PlanData {
  id: string;
  name: string;
  billingPeriod: string;
  priceCents: number;
  firstPriceCents: number | null;
  currency: string;
  scope: string;
  highlight: boolean;
}

/** 支付流程分步状态，供 CTA 文案反馈。 */
type PayStep = "idle" | "creating" | "redirecting";

/**
 * SubscriptionCard — §6.1：连续包月默认高亮，但不得默认勾选额外服务。
 * D1：首月 vs 之后价格对比清晰（大字 + 小字标注）；点击后发起 checkout，
 * 跳转 mock 收银台页（payUrl）完成「支付」——不再前端直连 webhook。
 * couponCode 可由 pricing 页透传，进入结算。
 */
export function SubscriptionCard({
  plan,
  isLoggedIn,
  redirectTo,
  couponCode,
}: {
  plan: PlanData;
  isLoggedIn: boolean;
  redirectTo?: string;
  couponCode?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState<PayStep>("idle");

  const hasFirstDeal = plan.firstPriceCents != null && plan.firstPriceCents < plan.priceCents;
  const shownPrice = plan.firstPriceCents ?? plan.priceCents;
  const periodLabel = PLAN_PERIOD_LABELS[plan.billingPeriod] ?? plan.billingPeriod;
  const perUnit = plan.billingPeriod === "year" ? "年" : plan.billingPeriod === "quarter" ? "季" : "月";
  const loading = step !== "idle";

  async function subscribe() {
    if (!isLoggedIn) {
      router.push(`/login?next=${encodeURIComponent(redirectTo ?? "/pricing")}`);
      return;
    }
    setStep("creating");
    try {
      track("checkout_start", { plan_id: plan.id, coupon: couponCode ?? null });
      const s = await fetch("/api/checkout/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId: plan.id, channel: "mock", couponCode: couponCode || undefined }),
      }).then((r) => r.json());
      if (!s.ok) throw new Error(s.error);

      // 跳转 mock 收银台页；真实环境这里应是渠道收银台链接
      setStep("redirecting");
      const payUrl: string = s.data.payUrl ?? `/checkout/mock?order=${encodeURIComponent(s.data.externalOrderId)}`;
      const next = redirectTo ?? "/me/subscription";
      router.push(`${payUrl}${payUrl.includes("?") ? "&" : "?"}next=${encodeURIComponent(next)}`);
    } catch (e) {
      setStep("idle");
      toast((e as Error).message || "发起支付失败，请重试", { tone: "warn" });
    }
  }

  const ctaText = !isLoggedIn
    ? "登录后订阅"
    : step === "creating"
      ? "生成订单…"
      : step === "redirecting"
        ? "前往收银台…"
        : "立即订阅";

  return (
    <div
      className={`relative flex flex-col rounded-[var(--radius-card)] border p-6 transition-all duration-300 [transition-timing-function:var(--ease-out-expo)] hover:-translate-y-1 ${
        plan.highlight ? "border-accent-600 bg-paper-raised shadow-[var(--shadow-soft)]" : "border-ink-200 bg-paper-raised hover:border-accent-300"
      }`}
    >
      {plan.highlight && (
        <div className="absolute -top-3 left-6">
          <Badge tone="accent">推荐</Badge>
        </div>
      )}
      <div className="flex items-baseline justify-between">
        <h3 className="text-base font-semibold text-ink-950">{plan.name}</h3>
        <span className="text-xs text-ink-400">{periodLabel}</span>
      </div>

      {/* 价格区：首月大字 + 之后原价小字标注 */}
      <div className="mt-4">
        <div className="flex items-baseline gap-1">
          {hasFirstDeal && <span className="rounded bg-accent-50 px-1.5 py-0.5 text-[11px] font-medium text-accent-700">首月</span>}
          <span className="text-sm text-ink-500">¥</span>
          <span className="num text-4xl font-semibold text-ink-950">{yuan(shownPrice)}</span>
          <span className="text-sm text-ink-400">/{perUnit}</span>
        </div>
        {hasFirstDeal ? (
          <p className="mt-1.5 text-xs text-ink-400">
            首月 <span className="font-medium text-accent-700">¥{yuan(plan.firstPriceCents!)}</span>，
            之后每月 <span className="text-ink-500 line-through decoration-ink-300">¥{yuan(plan.priceCents)}</span>
          </p>
        ) : (
          <p className="mt-1.5 text-xs text-ink-400">价格透明，无隐藏续费涨价</p>
        )}
      </div>

      <ul className="mt-5 flex-1 space-y-2 text-sm text-ink-500">
        {plan.scope === "all" ? (
          <>
            <li>✓ 解锁<span className="font-medium text-ink-800">全部赛道</span>课程</li>
            <li>✓ 本周上新可学习</li>
            <li>✓ 无限笔记 + 时间戳锚点</li>
            <li>✓ 需求投票权</li>
          </>
        ) : (
          <>
            <li>✓ 解锁「{trackLabel(plan.scope)}」全部课程</li>
            <li>✓ 该赛道持续更新</li>
            <li>✓ 无限笔记 + 投票权</li>
            <li className="text-ink-400">升级全站可解锁其他赛道</li>
          </>
        )}
      </ul>

      <div className="mt-6">
        <Ripple className="w-full rounded-xl">
          <button
            onClick={subscribe}
            disabled={loading}
            className={`btn flex w-full items-center justify-center gap-2 rounded-xl py-3 font-medium transition-all duration-150 disabled:opacity-60 ${
              plan.highlight ? "bg-accent-600 text-white hover:bg-accent-700" : "border border-ink-200 bg-white text-ink-950 hover:border-accent-400"
            }`}
          >
            {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
            {ctaText}
          </button>
        </Ripple>
      </div>
      <p className="mt-3 text-center text-xs text-ink-400">随时可取消 · 取消后笔记仍保留</p>
    </div>
  );
}
