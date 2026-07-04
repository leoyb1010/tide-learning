"use client";

import { useState } from "react";
import { SubscriptionCard, type PlanData } from "./SubscriptionCard";
import { yuan } from "@/lib/format";
import { Tag, CheckCircle, XCircle } from "@phosphor-icons/react";

interface CouponPreview {
  code: string;
  discountCents: number;
  finalCents: number;
  basePriceCents: number;
}

/**
 * PricingPlans, 客户端：优惠券输入 + 折后价预览，并把校验通过的券码
 * 透传给全站会员卡（结算时进入 createCheckoutSession）。
 * 单赛道卡不套用券（券多为全站活动，避免误导；如需可扩展 planId 维度）。
 * 视觉：优惠券框用 --surface-inset 内凹材质；校验成功用 --ok 语义色，
 * 失败用 --red 信号；全站三档用 .stagger 递延进场。
 */
export function PricingPlans({
  fullPlans,
  trackPlans,
  isLoggedIn,
}: {
  fullPlans: PlanData[];
  trackPlans: PlanData[];
  isLoggedIn: boolean;
}) {
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState<CouponPreview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // 用第一张主推全站卡作为预览基准
  const previewPlan = fullPlans.find((p) => p.highlight) ?? fullPlans[0] ?? null;
  const appliedCode = preview?.code;

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
    <div className="space-y-9">
      {/* 优惠券输入 */}
      {previewPlan && (
        <div className="mx-auto max-w-md rounded-[14px] border border-[var(--border)] bg-[var(--surface-inset)] p-4 shadow-[var(--inner-hi)]">
          <div className="mb-2.5 flex items-center gap-1.5 text-[13px] text-[var(--ink2)]">
            <Tag size={15} weight="fill" className="text-[var(--red)]" />
            有优惠券？输入后预览折后价（结算自动生效于全站会员）
          </div>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => { setCode(e.target.value); setErr(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") validate(); }}
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
                全站会员首期仅需 <span className="mono font-bold">¥{yuan(preview.finalCents)}</span>
              </span>
            </p>
          )}
        </div>
      )}

      {/* 全站会员卡（透传已校验券码；递延进场，推荐档视觉更聚焦） */}
      <div className="stagger mx-auto grid max-w-3xl items-stretch gap-5 sm:grid-cols-3">
        {fullPlans.map((p, i) => (
          <div key={p.id} style={{ "--i": i } as React.CSSProperties} className="flex">
            <SubscriptionCard plan={p} isLoggedIn={isLoggedIn} redirectTo="/me/subscription" couponCode={appliedCode} />
          </div>
        ))}
      </div>

      {/* 单赛道会员卡 */}
      <div>
        <div className="mb-5 text-center">
          <h2 className="text-[18px] font-bold text-[var(--ink)]">单赛道会员</h2>
          <p className="mt-1 text-[13px] text-[var(--ink3)]">低门槛切入，只学你需要的方向</p>
        </div>
        <div className="stagger mx-auto grid max-w-3xl items-stretch gap-5 sm:grid-cols-3">
          {trackPlans.map((p, i) => (
            <div key={p.id} style={{ "--i": i } as React.CSSProperties} className="flex">
              <SubscriptionCard plan={p} isLoggedIn={isLoggedIn} redirectTo="/me/subscription" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
