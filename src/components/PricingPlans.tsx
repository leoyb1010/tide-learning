"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Tag, CheckCircle, XCircle, Star, CaretDown } from "@phosphor-icons/react";
import { SubscriptionCard, type PlanData } from "./SubscriptionCard";
import { yuan } from "@/lib/format";
import { coursesFromGrant } from "@/lib/pricing";

/**
 * v3.0 订阅页商业化重做（客户端主体）。
 *
 * 职责边界：
 *   - 保留优惠券预览校验（透传券码进 checkout）与「已登录/未登录」态。
 *   - 全站三档卡从定价心理学重排：年卡=推荐主卡（视觉最大 + 红 CTA + cta-glow +
 *     省钱标签 + ≈/天 换算），季卡=中间过渡，月卡/连续包月=入门锚点。
 *   - 「最受欢迎」角标全站只出现一张（年卡），且用 absolute + 卡片 pt 让位，绝不被
 *     卡片 overflow 裁切（旧 bug：DB 里连续包月与年卡都 highlight=true → 两卡都挂角标且被切）。
 *   - 每档卡明确写「每月赠 N 积分 · 可造约 x 门课」(积分是造课/AI 整理货币，差异化说服力)。
 *   - FAQ 手风琴（framer-motion 展开，reduce-motion 降级）。
 *
 * 与后端联动：月赠积分额度由 fullPlans[i].monthlyGrant 携带（entitlement/credits 派生，
 * 月/连续包月 300、季 500、年 800）；此处不重算，只据其展示，保证前后端单一事实源。
 */

interface CouponPreview {
  code: string;
  discountCents: number;
  finalCents: number;
  basePriceCents: number;
}

/** 档位递进权益：按 月 → 季 → 年 差异化，不再三档复制粘贴。 */
function planPerks(plan: PlanData): { label: string; strong?: boolean }[] {
  const period = plan.billingPeriod;
  const grant = plan.monthlyGrant;
  const courses = coursesFromGrant(grant);
  const base: { label: string; strong?: boolean }[] = [
    { label: "解锁全部赛道课程", strong: true },
    { label: `每月赠 ${grant} 积分 · 可造约 ${courses} 门课`, strong: true },
  ];
  if (period === "year") {
    return [
      ...base,
      { label: "本周上新第一时间可学" },
      { label: "AI 笔记整理 + 模拟考试不限量" },
      { label: "学习周报 + 分享卡 + 新功能抢先体验" },
      { label: "专属优先客服通道" },
    ];
  }
  if (period === "quarter") {
    return [
      ...base,
      { label: "本周上新可学习" },
      { label: "AI 笔记整理 + 模拟考试" },
      { label: "学习周报 + 分享卡" },
    ];
  }
  // month / month_recurring：入门锚点，权益克制
  return [
    ...base,
    { label: "本周上新可学习" },
    { label: "AI 笔记整理（基础）" },
  ];
}

const FAQ: { q: string; a: string }[] = [
  {
    q: "怎么退订？会立刻失效吗？",
    a: "随时可在「我的订阅」一键退订，无需联系客服。退订后权益保留到当前周期结束，之后课程锁定，但你的笔记与截帧永久保留、可继续查看导出。",
  },
  {
    q: "月赠积分是怎么用的？会清零吗？",
    a: "订阅期内每月自动到账（月卡/连续包月 300、季卡 500、年卡 800）。积分用于 AI 造课、AI 笔记整理、模拟考试等能力，一门完整课程约消耗 40 积分。积分不随月清零，可累积使用。",
  },
  {
    q: "目前可以直接付款吗？",
    a: "正式支付渠道仍在接入中。渠道开放前不会产生真实扣款；开放后，结算页会明确展示可用渠道、实付金额和服务周期。",
  },
  {
    q: "一个账号能几台设备用？",
    a: "同一账号支持手机、平板、网页多端登录，并同步学习进度与笔记。请勿与他人共享账号或登录凭据。",
  },
  {
    q: "优惠券什么时候生效？",
    a: "只有结算页明确显示校验成功、优惠金额和最终实付价时才会生效；未显示的优惠不会在支付后补扣或追认。",
  },
];

export function PricingPlans({
  fullPlans,
  trackPlans,
  isLoggedIn,
  redirectTo,
}: {
  fullPlans: PlanData[];
  trackPlans: PlanData[];
  isLoggedIn: boolean;
  redirectTo: string;
}) {
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState<CouponPreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const reduce = useReducedMotion();

  // 推荐主卡：优先年卡（billingPeriod==="year"），拿不到则回落 DB highlight，再回落最贵一档。
  // 关键：无论 DB 里几张 highlight=true，前端只认定「一张」年卡为 hero，杜绝双角标 bug。
  const heroPlan =
    fullPlans.find((p) => p.billingPeriod === "year") ??
    fullPlans.find((p) => p.highlight) ??
    [...fullPlans].sort((a, b) => b.priceCents - a.priceCents)[0] ??
    null;

  // 展示顺序：入门锚点(月/连续包月) → 过渡(季) → 推荐(年)，让视线终点落在年卡。
  const ORDER: Record<string, number> = { month: 0, month_recurring: 0, quarter: 1, year: 2 };
  const orderedFull = [...fullPlans].sort(
    (a, b) => (ORDER[a.billingPeriod] ?? 9) - (ORDER[b.billingPeriod] ?? 9),
  );

  // 券预览基准：用推荐主卡（年卡）
  const previewPlan = heroPlan ?? fullPlans[0] ?? null;
  const appliedCode = preview?.code;

  // 年卡「省 ¥xxx」：年付一次 vs 连续包月 12 期原价累计
  const monthlyRef =
    fullPlans.find((p) => p.billingPeriod === "month_recurring") ??
    fullPlans.find((p) => p.billingPeriod === "month");
  const yearPlan = fullPlans.find((p) => p.billingPeriod === "year");
  const monthlyYearTotal = monthlyRef ? monthlyRef.priceCents * 12 : 0;
  const yearSaveCents =
    yearPlan && monthlyYearTotal > yearPlan.priceCents ? monthlyYearTotal - yearPlan.priceCents : 0;
  const yearPerDayCents = yearPlan ? Math.round(yearPlan.priceCents / 365) : 0;

  async function validate() {
    if (!code.trim() || !previewPlan) return;
    setChecking(true);
    setErr(null);
    setPreview(null);
    try {
      const r = await fetch("/api/coupons/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim(), planId: previewPlan.id }),
      }).then((res) => res.json());
      if (!r.ok) throw new Error(r.error);
      setPreview({
        code: r.data.code,
        discountCents: r.data.discountCents,
        finalCents: r.data.finalCents,
        basePriceCents: r.data.basePriceCents,
      });
    } catch (e) {
      setErr((e as Error).message || "优惠券无效");
    } finally {
      setChecking(false);
    }
  }

  function clear() {
    setPreview(null);
    setErr(null);
    setCode("");
  }

  return (
    <div className="space-y-10">
      {/* 优惠券输入（保留原校验逻辑，视觉打磨） */}
      {previewPlan && (
        <div className="mx-auto max-w-md rounded-[14px] border border-[var(--border)] bg-[var(--surface-inset)] p-4 shadow-[var(--inner-hi)]">
          <div className="mb-2.5 flex items-center gap-1.5 text-[13px] text-[var(--ink2)]">
            <Tag size={15} weight="fill" className="text-[var(--red)]" />
            有优惠券？输入后预览折后价（结算自动生效于年卡）
          </div>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setErr(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") validate();
              }}
              placeholder="输入优惠券码"
              className="mono flex-1 rounded-[11px] border border-[var(--border2)] bg-[var(--surface)] px-3 py-2.5 text-[13px] uppercase tracking-[0.06em] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--red)]"
            />
            {preview ? (
              <button
                onClick={clear}
                className="studio-press rounded-[11px] border border-[var(--border2)] bg-[var(--surface)] px-4 py-2.5 text-[13px] text-[var(--ink3)] transition-colors hover:text-[var(--red)]"
              >
                清除
              </button>
            ) : (
              <button
                onClick={validate}
                disabled={checking || !code.trim()}
                className="studio-press rounded-[11px] bg-[var(--ink)] px-5 py-2.5 text-[13px] font-bold text-[var(--surface)] transition-all hover:brightness-110 disabled:opacity-45"
              >
                {checking ? "校验中…" : "应用"}
              </button>
            )}
          </div>
          {err && (
            <p className="mt-2.5 flex items-center gap-1 text-[12px] font-medium text-[var(--red-ink)]">
              <XCircle size={14} weight="fill" /> {err}
            </p>
          )}
          {preview && (
            <p className="mt-2.5 flex items-center gap-1.5 rounded-[9px] bg-[var(--ok-soft)] px-3 py-2 text-[12px] leading-[1.5] text-[var(--ok)]">
              <CheckCircle size={15} weight="fill" className="shrink-0" />
              <span>
                已应用「{preview.code}」，立减 <span className="mono">¥{yuan(preview.discountCents)}</span>，
                首期仅需 <span className="mono font-bold">¥{yuan(preview.finalCents)}</span>
              </span>
            </p>
          )}
        </div>
      )}

      {/* 全站三档卡：入门锚点 → 过渡 → 推荐年卡。角标只在年卡，pt-4 让位不裁切。 */}
      <div className="stagger mx-auto grid max-w-[1000px] items-stretch gap-5 pt-4 sm:grid-cols-3">
        {orderedFull.map((p, i) => {
          const isHero = heroPlan?.id === p.id;
          const perks = planPerks(p);
          return (
            <div key={p.id} style={{ "--i": i } as React.CSSProperties} className="flex">
              <PlanCardShell
                plan={p}
                isHero={isHero}
                perks={perks}
                isLoggedIn={isLoggedIn}
                couponCode={isHero ? appliedCode : undefined}
                yearSaveCents={isHero ? yearSaveCents : 0}
                yearPerDayCents={isHero ? yearPerDayCents : 0}
                redirectTo={redirectTo}
              />
            </div>
          );
        })}
      </div>

      {/* 单赛道会员：低门槛入口，不与全站三档争视觉重量 */}
      <div className="pt-2">
        <div className="mb-5 text-center">
          <h2 className="text-[18px] font-bold text-[var(--ink)]">单赛道会员</h2>
          <p className="mt-1 text-[13px] text-[var(--ink3)]">低门槛切入，只学你需要的方向（每月赠 200 积分）</p>
        </div>
        <div className="stagger mx-auto grid max-w-[820px] items-stretch gap-5 sm:grid-cols-3">
          {trackPlans.map((p, i) => (
            <div key={p.id} style={{ "--i": i } as React.CSSProperties} className="flex">
              <SubscriptionCard plan={p} isLoggedIn={isLoggedIn} redirectTo={redirectTo} />
            </div>
          ))}
        </div>
      </div>

      {/* FAQ 手风琴 */}
      <div className="mx-auto max-w-[720px]">
        <h2 className="mb-4 text-center text-[18px] font-bold text-[var(--ink)]">常见问题</h2>
        <div className="overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card),var(--inner-hi)]">
          {FAQ.map((item, i) => {
            const open = openFaq === i;
            return (
              <div key={item.q} className={i > 0 ? "border-t border-[var(--border)]" : ""}>
                <button
                  onClick={() => setOpenFaq(open ? null : i)}
                  aria-expanded={open}
                  className="studio-press flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
                >
                  <span className="text-[14px] font-semibold text-[var(--ink)]">{item.q}</span>
                  <CaretDown
                    size={16}
                    weight="bold"
                    className={`shrink-0 text-[var(--ink3)] transition-transform ${open ? "rotate-180" : ""}`}
                  />
                </button>
                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      key="body"
                      initial={reduce ? false : { height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <p className="px-5 pb-4 text-[13px] leading-[1.75] text-[var(--ink2)]">{item.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * 全站档卡壳：只做两件事，其余全部委托 SubscriptionCard（保持单一支付实现，不分叉）。
 *   1) 在卡片外沿上方绘制唯一「最受欢迎」角标（absolute + z-10，父层已 pt-4 让位，不被裁切）；
 *   2) 把定价锚定与积分联动的展示数据（variant / perks / 省钱 / 每日均摊）注入 SubscriptionCard。
 * 价格、权益、月赠积分条、CTA、checkout 全在 SubscriptionCard 内渲染，避免重复与分叉。
 */
function PlanCardShell({
  plan,
  isHero,
  perks,
  isLoggedIn,
  couponCode,
  yearSaveCents,
  yearPerDayCents,
  redirectTo,
}: {
  plan: PlanData;
  isHero: boolean;
  perks: { label: string; strong?: boolean }[];
  isLoggedIn: boolean;
  couponCode?: string;
  yearSaveCents: number;
  yearPerDayCents: number;
  redirectTo: string;
}) {
  return (
    <div className="relative flex w-full">
      {/* 角标：absolute 于卡片外沿上方，父容器已留 pt-4，不会被卡片 overflow 裁切 */}
      {isHero && (
        <div className="pointer-events-none absolute -top-3.5 left-1/2 z-10 -translate-x-1/2">
          <span className="mono cta-glow inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-[var(--red)] px-3 py-1 text-[11px] font-bold tracking-[0.06em] text-white">
            <Star size={11} weight="fill" />
            最受欢迎
          </span>
        </div>
      )}
      <SubscriptionCard
        plan={plan}
        isLoggedIn={isLoggedIn}
        redirectTo={redirectTo}
        couponCode={couponCode}
        variant={isHero ? "hero" : "plain"}
        perks={perks}
        savingsCents={isHero ? yearSaveCents : 0}
        perDayCents={isHero ? yearPerDayCents : 0}
      />
    </div>
  );
}

export type { CouponPreview };
