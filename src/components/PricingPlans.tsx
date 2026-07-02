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
 * PricingPlans — 客户端：优惠券输入 + 折后价预览，并把校验通过的券码
 * 透传给全站会员卡（结算时进入 createCheckoutSession）。
 * 单赛道卡不套用券（券多为全站活动，避免误导；如需可扩展 planId 维度）。
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
    <div className="space-y-8">
      {/* 优惠券输入 */}
      {previewPlan && (
        <div className="mx-auto max-w-md rounded-2xl border border-ink-100 bg-paper-raised p-4">
          <div className="mb-2 flex items-center gap-1.5 text-sm text-ink-500">
            <Tag size={16} weight="fill" className="text-accent-600" />
            有优惠券？输入后预览折后价（结算自动生效于全站会员）
          </div>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => { setCode(e.target.value); setErr(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") validate(); }}
              placeholder="输入优惠券码"
              className="flex-1 rounded-xl border border-ink-200 px-3 py-2.5 text-sm uppercase outline-none focus:border-accent-400"
            />
            {preview ? (
              <button onClick={clear} className="rounded-xl border border-ink-200 px-4 py-2.5 text-sm text-ink-500 hover:text-error">
                清除
              </button>
            ) : (
              <button
                onClick={validate}
                disabled={checking || !code.trim()}
                className="rounded-xl bg-accent-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-700 disabled:opacity-50"
              >
                {checking ? "校验中…" : "应用"}
              </button>
            )}
          </div>
          {err && (
            <p className="mt-2 flex items-center gap-1 text-xs text-error">
              <XCircle size={14} weight="fill" /> {err}
            </p>
          )}
          {preview && (
            <p className="mt-2 flex items-center gap-1 text-xs text-success">
              <CheckCircle size={14} weight="fill" />
              已应用「{preview.code}」：立减 ¥{yuan(preview.discountCents)}，
              全站会员首期仅需 <span className="font-semibold">¥{yuan(preview.finalCents)}</span>
            </p>
          )}
        </div>
      )}

      {/* 全站会员卡（透传已校验券码） */}
      <div className="mx-auto grid max-w-3xl gap-5 sm:grid-cols-3">
        {fullPlans.map((p) => (
          <SubscriptionCard key={p.id} plan={p} isLoggedIn={isLoggedIn} redirectTo="/me/subscription" couponCode={appliedCode} />
        ))}
      </div>

      {/* 单赛道会员卡 */}
      <div>
        <div className="mb-5 text-center">
          <h2 className="text-xl font-semibold text-ink-950">单赛道会员</h2>
          <p className="mt-1 text-sm text-ink-500">低门槛切入，只学你需要的方向</p>
        </div>
        <div className="mx-auto grid max-w-3xl gap-5 sm:grid-cols-3">
          {trackPlans.map((p) => (
            <SubscriptionCard key={p.id} plan={p} isLoggedIn={isLoggedIn} redirectTo="/me/subscription" />
          ))}
        </div>
      </div>
    </div>
  );
}
