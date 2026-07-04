"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Star } from "@phosphor-icons/react";
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
 * SubscriptionCard, §6.1：连续包月默认高亮，但不得默认勾选额外服务。
 * D1：首月 vs 之后价格对比清晰（大字 + 小字标注）；点击后发起 checkout，
 * 跳转 mock 收银台页（payUrl）完成「支付」，不再前端直连 webhook。
 * couponCode 可由 pricing 页透传，进入结算。
 * 视觉：推荐档用 --red-soft 描边 + --inner-hi 材质高光 + .cta-glow 柔光，
 * 与普通档拉开海拔层级；数字用 mono，语义色描述权益。
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
  const hot = plan.highlight;

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

  const benefits =
    plan.scope === "all"
      ? [
          { label: "解锁全部赛道课程", strong: true },
          { label: "本周上新可学习", strong: false },
          { label: "无限笔记 + 时间戳锚点", strong: false },
          { label: "需求投票权", strong: false },
        ]
      : [
          { label: `解锁「${trackLabel(plan.scope)}」全部课程`, strong: true },
          { label: "该赛道持续更新", strong: false },
          { label: "无限笔记 + 投票权", strong: false },
        ];

  return (
    <div
      className={`hover-sheen studio-lift relative flex h-full flex-col rounded-[16px] p-6 ${
        hot
          ? "border-2 border-[var(--red-soft-border)] bg-[var(--surface)] shadow-[var(--card-hover),var(--inner-hi)] md:-translate-y-1.5 md:scale-[1.02]"
          : "border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card)]"
      }`}
    >
      {hot && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="mono cta-glow inline-flex items-center gap-1 rounded-full bg-[var(--red)] px-3 py-1 text-[11px] font-bold tracking-[0.06em] text-white">
            <Star size={11} weight="fill" />
            最受欢迎
          </span>
        </div>
      )}
      <div className="flex items-baseline justify-between">
        <h3 className="text-[16px] font-bold text-[var(--ink)]">{plan.name}</h3>
        <span className="mono text-[11px] uppercase tracking-[0.08em] text-[var(--ink4)]">{periodLabel}</span>
      </div>

      {/* 价格区：首月大字 + 之后原价小字标注 */}
      <div className="mt-4">
        <div className="flex items-baseline gap-1">
          {hasFirstDeal && (
            <span className="mono rounded-[6px] bg-[var(--red-soft)] px-1.5 py-0.5 text-[11px] font-bold text-[var(--red-ink)]">
              首期
            </span>
          )}
          <span className="text-[14px] text-[var(--ink3)]">¥</span>
          <span className={`mono text-[40px] font-extrabold leading-none tracking-tight ${hot ? "text-[var(--red)]" : "text-[var(--ink)]"}`}>
            {yuan(shownPrice)}
          </span>
          <span className="text-[13px] text-[var(--ink4)]">/{perUnit}</span>
        </div>
        {hasFirstDeal ? (
          <p className="mt-2 text-[12px] text-[var(--ink3)]">
            首期 <span className="mono font-semibold text-[var(--red-ink)]">¥{yuan(plan.firstPriceCents!)}</span>，
            之后每期 <span className="mono text-[var(--ink4)] line-through">¥{yuan(plan.priceCents)}</span>
          </p>
        ) : (
          <p className="mt-2 text-[12px] text-[var(--ink3)]">价格透明，无隐藏续费涨价</p>
        )}
      </div>

      <ul className="mt-5 flex-1 space-y-2.5 text-[13px]">
        {benefits.map((b) => (
          <li key={b.label} className="flex items-start gap-2 leading-[1.5]">
            <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-[var(--ok-soft)] text-[var(--ok)]">
              <Check size={11} weight="bold" />
            </span>
            <span className={b.strong ? "font-semibold text-[var(--ink)]" : "text-[var(--ink2)]"}>{b.label}</span>
          </li>
        ))}
        {plan.scope !== "all" && (
          <li className="pl-6 text-[12px] text-[var(--ink4)]">升级全站可解锁其他赛道</li>
        )}
      </ul>

      <div className="mt-6">
        <Ripple className="w-full rounded-[12px]">
          <button
            onClick={subscribe}
            disabled={loading}
            className={`studio-press flex w-full items-center justify-center gap-2 rounded-[12px] py-3 text-[14px] font-bold transition-all disabled:opacity-60 ${
              hot
                ? "cta-glow bg-[var(--red)] text-white hover:brightness-105"
                : "border border-[var(--border2)] bg-[var(--surface)] text-[var(--ink)] hover:border-[var(--ink3)]"
            }`}
          >
            {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
            {ctaText}
          </button>
        </Ripple>
      </div>
      <p className="mt-3 text-center text-[11px] text-[var(--ink4)]">随时可取消，取消后笔记仍保留</p>
    </div>
  );
}
