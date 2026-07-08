"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Star, TrendUp, Coins } from "@phosphor-icons/react";
import { Ripple } from "./motion";
import { useToast } from "./Toast";
import { useSubmitGuard } from "@/hooks/useSubmitGuard";
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
  monthlyGrant: number; // v3.0：该档每月赠送积分（月/连续包月 300、季 500、年 800、单赛道 200）
}

/** 支付流程分步状态，供 CTA 文案反馈。 */
type PayStep = "idle" | "creating" | "redirecting";

/** 展示变体：hero=推荐主卡（红 CTA + 描边 + 抬升 + 锚定标签）；plain=普通档。 */
type CardVariant = "hero" | "plain" | "auto";

export interface Perk {
  label: string;
  strong?: boolean;
}

/**
 * SubscriptionCard, §6.1：连续包月默认高亮，但不得默认勾选额外服务。
 * D1：首期 vs 之后价格对比清晰（大字 + 小字标注）；点击后发起 checkout，
 * 跳转 mock 收银台页（payUrl）完成「支付」，不再前端直连 webhook。
 * couponCode 可由 pricing 页透传，进入结算。
 *
 * v3.0 商业化重做：
 *   - variant 显式决定视觉层级（不再仅靠 plan.highlight，避免 DB 双 highlight → 双角标 bug）。
 *     全站三档由 PricingPlans 统一决定唯一 hero；单赛道卡沿用 "auto"（据 highlight 自决）。
 *   - 角标默认由父层（PricingPlans）绘制并让位；仅 "auto"（单赛道独立使用）时卡内自绘。
 *   - perks 可由父层按档位递进注入（不再三档复制粘贴）；缺省回落 scope 默认权益。
 *   - hero 卡展示「省 ¥xxx / ≈¥x.xx/天」锚定标签，联动积分体系（每月赠 N 积分）。
 */
export function SubscriptionCard({
  plan,
  isLoggedIn,
  redirectTo,
  couponCode,
  variant = "auto",
  perks,
  savingsCents = 0,
  perDayCents = 0,
}: {
  plan: PlanData;
  isLoggedIn: boolean;
  redirectTo?: string;
  couponCode?: string;
  variant?: CardVariant;
  perks?: Perk[];
  savingsCents?: number;
  perDayCents?: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState<PayStep>("idle");

  const hasFirstDeal = plan.firstPriceCents != null && plan.firstPriceCents < plan.priceCents;
  const shownPrice = plan.firstPriceCents ?? plan.priceCents;
  const periodLabel = PLAN_PERIOD_LABELS[plan.billingPeriod] ?? plan.billingPeriod;
  const perUnit = plan.billingPeriod === "year" ? "年" : plan.billingPeriod === "quarter" ? "季" : "月";
  // hero 由父层显式指定；auto 时回落 plan.highlight（单赛道独立使用场景）
  const hot = variant === "hero" || (variant === "auto" && plan.highlight);
  // 角标只在「独立自决」的 auto 场景由卡内自绘；hero/plain 由父层统一绘制并让位，避免裁切。
  const drawOwnBadge = variant === "auto" && plan.highlight;

  // useSubmitGuard(20s)：拦截快速双击的双发下单；网络卡死时 20s 兜底解锁，避免按钮永久 loading。
  const { submitting, guard: subscribe } = useSubmitGuard(async () => {
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
        // P1-2：渠道不再硬编码 mock——按环境 NEXT_PUBLIC_PAY_CHANNEL 读取（默认 mock 供开发/演示），
        // 部署接入真实渠道（web_wechat/web_alipay/stripe）后置该 env 即可，无需改代码。
        body: JSON.stringify({
          planId: plan.id,
          channel: process.env.NEXT_PUBLIC_PAY_CHANNEL || "mock",
          couponCode: couponCode || undefined,
        }),
      }).then((r) => r.json());
      if (!s.ok) throw new Error(s.error);

      // 跳转 mock 收银台页；真实环境这里应是渠道收银台链接
      setStep("redirecting");
      const payUrl: string = s.data.payUrl ?? `/checkout/mock?order=${encodeURIComponent(s.data.externalOrderId)}`;
      const next = redirectTo ?? "/me/subscription";
      router.push(`${payUrl}${payUrl.includes("?") ? "&" : "?"}next=${encodeURIComponent(next)}`);
    } catch (e) {
      setStep("idle");
      const msg = (e as Error).message || "";
      // P1-2：生产未开放 mock 渠道时后端回「不支持的支付渠道」——给用户明确「暂未开放」文案，
      // 不把技术错误抛到脸上（真实渠道接入前的过渡态）。
      const friendly = /不支持的支付渠道/.test(msg) ? "支付暂未开放，敬请期待" : msg || "发起支付失败，请重试";
      toast(friendly, { tone: "warn" });
    }
  }, 20000);

  const loading = submitting || step !== "idle";

  const ctaText = !isLoggedIn
    ? "登录后订阅"
    : step === "creating"
      ? "生成订单…"
      : step === "redirecting"
        ? "前往收银台…"
        : "立即订阅";

  // 权益：父层注入优先（按档递进）；否则回落 scope 默认（单赛道独立使用）。
  const benefits: Perk[] =
    perks ??
    (plan.scope === "all"
      ? [
          { label: "解锁全部赛道课程", strong: true },
          { label: `每月赠 ${plan.monthlyGrant} 积分`, strong: true },
          { label: "本周上新可学习" },
          { label: "无限笔记 + 时间戳锚点" },
        ]
      : [
          { label: `解锁「${trackLabel(plan.scope)}」全部课程`, strong: true },
          { label: `每月赠 ${plan.monthlyGrant} 积分` },
          { label: "该赛道持续更新" },
          { label: "无限笔记 + 投票权" },
        ]);

  return (
    <div
      className={`hover-sheen studio-lift relative flex h-full w-full flex-col rounded-[16px] p-6 ${
        hot
          ? "border-2 border-[var(--red-soft-border)] bg-[var(--surface)] shadow-[var(--card-hover),var(--inner-hi)] md:-translate-y-1.5 md:scale-[1.02]"
          : "border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card)]"
      }`}
    >
      {/* 仅单赛道独立使用（auto+highlight）时卡内自绘角标；全站三档由父层绘制并让位 */}
      {drawOwnBadge && (
        <div className="pointer-events-none absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="mono cta-glow inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-[var(--red)] px-3 py-1 text-[11px] font-bold tracking-[0.06em] text-white">
            <Star size={11} weight="fill" />
            最受欢迎
          </span>
        </div>
      )}

      <div className="flex items-baseline justify-between">
        <h3 className="text-[16px] font-bold text-[var(--ink)]">{plan.name}</h3>
        <span className="mono text-[11px] uppercase tracking-[0.08em] text-[var(--ink4)]">{periodLabel}</span>
      </div>

      {/* 价格区：首期大字 + 之后原价小字标注 */}
      <div className="mt-4">
        <div className="flex items-baseline gap-1">
          {hasFirstDeal && (
            <span className="mono rounded-[6px] bg-[var(--red-soft)] px-1.5 py-0.5 text-[11px] font-bold text-[var(--red-ink)]">
              首期
            </span>
          )}
          <span className="text-[14px] text-[var(--ink3)]">¥</span>
          <span
            className={`mono text-[40px] font-extrabold leading-none tracking-tight ${
              hot ? "text-[var(--red)]" : "text-[var(--ink)]"
            }`}
          >
            {yuan(shownPrice)}
          </span>
          <span className="text-[13px] text-[var(--ink4)]">/{perUnit}</span>
        </div>

        {/* 锚定标签：年卡「省 ¥xxx（vs 连续包月累计）」+「≈¥x.xx/天」 */}
        {savingsCents > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="mono inline-flex items-center gap-1 rounded-[7px] bg-[var(--ok-soft)] px-2 py-1 text-[11px] font-bold text-[var(--ok)]">
              <TrendUp size={12} weight="bold" />
              省 ¥{yuan(savingsCents)}
            </span>
            {perDayCents > 0 && (
              <span className="mono rounded-[7px] bg-[var(--surface2)] px-2 py-1 text-[11px] font-medium text-[var(--ink3)]">
                ≈ ¥{(perDayCents / 100).toFixed(2)}/天
              </span>
            )}
          </div>
        )}

        {hasFirstDeal ? (
          <p className="mt-2 text-[12px] leading-[1.6] text-[var(--ink3)]">
            首期 <span className="mono font-semibold text-[var(--red-ink)]">¥{yuan(plan.firstPriceCents!)}</span>，
            之后每期 <span className="mono text-[var(--ink4)] line-through">¥{yuan(plan.priceCents)}</span> · 随时可取消
          </p>
        ) : savingsCents > 0 ? (
          <p className="mt-2 text-[12px] text-[var(--ink3)]">一次付清一整年，随时可取消</p>
        ) : (
          <p className="mt-2 text-[12px] text-[var(--ink3)]">价格透明，无隐藏续费涨价</p>
        )}
      </div>

      {/* 月赠积分强化条：积分是造课/AI 整理货币，视觉上单独拎出 */}
      <div
        className={`mono mt-4 flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[12px] ${
          hot
            ? "bg-[var(--red-soft)] text-[var(--red-ink)]"
            : "bg-[var(--surface2)] text-[var(--ink2)]"
        }`}
      >
        <Coins size={14} weight="fill" className={hot ? "text-[var(--red)]" : "text-[var(--ink3)]"} />
        每月赠 <span className="font-bold">{plan.monthlyGrant}</span> 积分
      </div>

      <ul className="mt-4 flex-1 space-y-2.5 text-[13px]">
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
