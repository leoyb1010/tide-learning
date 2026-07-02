"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "./Dialog";
import { Ripple } from "./motion";
import { useToast } from "./Toast";
import { yuan, PLAN_PERIOD_LABELS } from "@/lib/format";
import { track } from "@/lib/analytics-client";

export interface SwitchablePlan {
  id: string;
  name: string;
  billingPeriod: string;
  priceCents: number;
  scope: string;
}

/**
 * SubscriptionManager — 订阅升/降级入口（Dialog 确认）。
 * 当前套餐价格用于对比「升级 / 降级」文案；调 /api/subscription/change。
 */
export function ChangePlanButton({
  currentPriceCents,
  currentPlanId,
  plans,
}: {
  currentPriceCents: number;
  currentPlanId: string;
  plans: SwitchablePlan[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<SwitchablePlan | null>(null);
  const [loading, setLoading] = useState(false);

  const options = plans.filter((p) => p.id !== currentPlanId);
  if (options.length === 0) return null;

  async function confirmChange() {
    if (!selected) return;
    setLoading(true);
    try {
      const r = await fetch("/api/subscription/change", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId: selected.id }),
      }).then((res) => res.json());
      if (!r.ok) throw new Error(r.error);
      track("subscription_change", { to_plan: selected.id });
      toast("套餐已变更", { tone: "success" });
      setOpen(false);
      setSelected(null);
      router.refresh();
    } catch (e) {
      toast((e as Error).message || "变更失败，请重试", { tone: "warn" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-accent-700 hover:underline"
      >
        升级 / 降级套餐
      </button>

      <Dialog open={open} onClose={() => !loading && setOpen(false)} title="切换套餐">
        <div className="space-y-2">
          {options.map((p) => {
            const isUpgrade = p.priceCents > currentPriceCents;
            const active = selected?.id === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setSelected(p)}
                className={`flex w-full items-center justify-between rounded-xl border p-3 text-left transition-colors ${
                  active ? "border-accent-600 bg-accent-50" : "border-ink-200 hover:border-accent-300"
                }`}
              >
                <div>
                  <p className="text-sm font-medium text-ink-950">{p.name}</p>
                  <p className="text-xs text-ink-400">{PLAN_PERIOD_LABELS[p.billingPeriod] ?? p.billingPeriod}</p>
                </div>
                <div className="text-right">
                  <p className="num text-sm font-semibold text-ink-950">¥{yuan(p.priceCents)}</p>
                  <span className={`text-[11px] ${isUpgrade ? "text-accent-700" : "text-ink-400"}`}>
                    {isUpgrade ? "升级" : "降级"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {selected && (
          <p className="mt-3 rounded-lg bg-accent-50 px-3 py-2 text-xs text-accent-700">
            将切换到「{selected.name}」，立即生效；权益按新套餐结算，差价按剩余周期折算。
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => setOpen(false)}
            disabled={loading}
            className="flex-1 rounded-xl border border-ink-200 py-2.5 text-sm text-ink-500 disabled:opacity-50"
          >
            取消
          </button>
          <Ripple className="flex-1 rounded-xl">
            <button
              onClick={confirmChange}
              disabled={!selected || loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-700 disabled:opacity-50"
            >
              {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
              确认切换
            </button>
          </Ripple>
        </div>
      </Dialog>
    </>
  );
}
