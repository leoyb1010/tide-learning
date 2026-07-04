"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Coins, Plus, CaretDown, ArrowClockwise, Check } from "@phosphor-icons/react";
import { Dialog } from "@/components/Dialog";
import { useToast } from "@/components/Toast";

/** 充值档位（与 /api/credits/recharge 的 PACKS 保持一致）。 */
const PACKS = [
  { id: "pack_small", yuan: 6, credits: 60, hot: false },
  { id: "pack_mid", yuan: 30, credits: 350, hot: true },
  { id: "pack_large", yuan: 98, credits: 1300, hot: false },
] as const;

interface LedgerItem {
  delta: number;
  type: string;
  reason: string | null;
  createdAt: string;
  balanceAfter: number;
}
interface CreditsMe {
  balance: number;
  recentLedger: LedgerItem[];
}

const TYPE_LABEL: Record<string, string> = {
  signup_bonus: "注册赠送",
  monthly_grant: "月度赠送",
  recharge: "充值",
  share_reward: "分享奖励",
  llm_spend: "AI 消耗",
  admin_adjust: "调账",
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
  });
}

/**
 * CreditCard, 积分卡（余额 + 本月消耗 + 充值 + 明细）。
 * 数据源 /api/credits/me；充值走 /api/credits/recharge（mock）。
 * 设计走 STUDIO token，余额数字用红色点睛。
 */
export function CreditCard() {
  const { toast } = useToast();
  const [data, setData] = useState<CreditsMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [buying, setBuying] = useState<string | null>(null);
  // 余额变化时给数字加 num-pop（反馈：充值到账的强调）
  const [balancePop, setBalancePop] = useState(false);
  const prevBalance = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const json = await fetch("/api/credits/me").then((r) => r.json());
      if (json.ok) setData(json.data as CreditsMe);
    } catch {
      /* 静默：卡片降级为占位态 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 余额上升时触发一次 num-pop（首次加载不触发）
  useEffect(() => {
    if (data == null) return;
    if (prevBalance.current != null && data.balance > prevBalance.current) {
      setBalancePop(true);
      const t = setTimeout(() => setBalancePop(false), 450);
      prevBalance.current = data.balance;
      return () => clearTimeout(t);
    }
    prevBalance.current = data.balance;
  }, [data]);

  // 本月消耗：汇总本月 llm_spend 的绝对值。
  const monthSpend = (() => {
    if (!data) return 0;
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    return data.recentLedger
      .filter((l) => {
        if (l.type !== "llm_spend") return false;
        const d = new Date(l.createdAt);
        return d.getFullYear() === y && d.getMonth() === m;
      })
      .reduce((sum, l) => sum + Math.abs(l.delta), 0);
  })();

  async function recharge(packId: string) {
    setBuying(packId);
    try {
      const json = await fetch("/api/credits/recharge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packId }),
      }).then((r) => r.json());
      if (!json.ok) {
        toast(json.error ?? "充值失败", { tone: "warn" });
        return;
      }
      toast(`充值成功，+${json.data.granted} 积分`, { tone: "success" });
      setRechargeOpen(false);
      await load();
    } catch {
      toast("充值失败，请稍后再试", { tone: "warn" });
    } finally {
      setBuying(null);
    }
  }

  const balance = data?.balance ?? 0;

  // 近 7 笔消耗微型曲线（叙事：让「本月消耗」不是一个孤立数字，而有节奏感）
  const spendSeries = (data?.recentLedger ?? [])
    .filter((l) => l.type === "llm_spend")
    .slice(0, 7)
    .map((l) => Math.abs(l.delta))
    .reverse();
  const spendPeak = Math.max(1, ...spendSeries);

  return (
    <div className="studio-rise relative overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--card),var(--inner-hi)]">
      <span className="absolute left-0 top-6 h-6 w-[3px] rounded-r bg-[var(--red)]" aria-hidden />

      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 text-[var(--ink3)]">
          <Coins size={16} weight="fill" className="text-[var(--red)]" />
          <span className="text-[12px] font-semibold tracking-[0.1em]">我的积分</span>
        </div>
        <button
          type="button"
          onClick={() => setRechargeOpen(true)}
          className="studio-press cta-glow inline-flex items-center gap-1.5 rounded-[11px] bg-[var(--red)] px-3.5 py-2 text-[12.5px] font-bold text-white"
        >
          <Plus size={13} weight="bold" /> 充值
        </button>
      </div>

      {/* 余额大数字（红色点睛，充值到账 num-pop 强调） */}
      <div className="mt-5 flex items-end gap-2">
        <span
          key={loading ? "load" : balance}
          className={`mono text-[44px] font-extrabold leading-none tracking-tight text-[var(--red)] ${loading ? "opacity-30" : ""} ${balancePop ? "num-pop" : ""}`}
        >
          {loading ? "···" : balance.toLocaleString()}
        </span>
        <span className="pb-1 text-[15px] font-semibold text-[var(--ink3)]">积分</span>
      </div>

      {/* 本月消耗 + 近 7 笔消耗微曲线 */}
      <div className="mt-4 flex items-end justify-between border-t border-[var(--border)] pt-3">
        <div>
          <span className="block text-[12.5px] text-[var(--ink3)]">本月消耗</span>
          <span className="mono mt-0.5 block text-[16px] font-bold text-[var(--ink)]">{monthSpend.toLocaleString()}</span>
        </div>
        {spendSeries.length > 1 && (
          <div className="flex h-7 items-end gap-[3px]" aria-hidden>
            {spendSeries.map((v, i) => (
              <span
                key={i}
                className="w-[5px] rounded-full bg-[var(--warn)] opacity-70"
                style={{ height: `${Math.max((v / spendPeak) * 100, 12)}%` }}
              />
            ))}
          </div>
        )}
      </div>

      {/* 明细入口 */}
      <button
        type="button"
        onClick={() => setDetailOpen((v) => !v)}
        className="mt-2 flex w-full items-center justify-between rounded-[10px] py-1.5 text-left text-[12.5px] font-medium text-[var(--ink3)] transition-colors hover:text-[var(--ink)]"
        aria-expanded={detailOpen}
      >
        <span>最近流水</span>
        <CaretDown size={13} weight="bold" className={`transition-transform ${detailOpen ? "rotate-180" : ""}`} />
      </button>

      {detailOpen && (
        <ul className="stagger mt-2 space-y-1.5">
          {(data?.recentLedger ?? []).length === 0 ? (
            <li className="py-2 text-center text-[12px] text-[var(--ink4)]">暂无流水</li>
          ) : (
            data!.recentLedger.map((l, i) => (
              <li
                key={i}
                style={{ "--i": i } as React.CSSProperties}
                className="flex items-center justify-between rounded-[10px] border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-2"
              >
                <div className="min-w-0">
                  <span className="block truncate text-[12.5px] text-[var(--ink2)]">
                    {l.reason ?? TYPE_LABEL[l.type] ?? l.type}
                  </span>
                  <span className="mono block text-[10px] tracking-[0.06em] text-[var(--ink4)]">{fmtDate(l.createdAt)}</span>
                </div>
                {/* 语义色：进账绿(--ok)，消耗暖警(--warn) */}
                <span
                  className={`mono shrink-0 text-[13px] font-semibold ${l.delta >= 0 ? "text-[var(--ok)]" : "text-[var(--warn)]"}`}
                >
                  {l.delta >= 0 ? "+" : ""}
                  {l.delta}
                </span>
              </li>
            ))
          )}
        </ul>
      )}

      {/* 充值 Dialog：三档 */}
      <Dialog open={rechargeOpen} onClose={() => setRechargeOpen(false)} title="积分充值">
        <div className="stagger grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {PACKS.map((p, idx) => {
            const busy = buying === p.id;
            return (
              <button
                key={p.id}
                type="button"
                disabled={buying !== null}
                onClick={() => recharge(p.id)}
                style={{ "--i": idx } as React.CSSProperties}
                className={`studio-lift hover-sheen relative flex flex-col items-center gap-1.5 rounded-[14px] border px-4 py-5 text-center transition-all disabled:opacity-45 ${
                  p.hot ? "cta-glow border-[var(--red-soft-border)] bg-[var(--red-soft)]" : "border-[var(--border)] bg-[var(--surface)]"
                } focus:border-[var(--ink3)] focus:outline-none`}
              >
                {p.hot && (
                  <span className="mono absolute -top-2 right-2.5 rounded-full bg-[var(--red)] px-2 py-0.5 text-[9px] font-bold tracking-[0.08em] text-white">
                    热门
                  </span>
                )}
                <span className="mono text-[26px] font-extrabold leading-none text-[var(--red)]">{p.credits}</span>
                <span className="text-[11px] text-[var(--ink3)]">积分</span>
                <span className="mono mt-1 text-[15px] font-bold text-[var(--ink)]">
                  {busy ? <ArrowClockwise size={16} weight="bold" className="animate-spin" /> : `¥${p.yuan}`}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mono mt-3.5 flex items-center gap-1.5 text-[11px] text-[var(--ink4)]">
          <Check size={12} weight="bold" className="text-[var(--red)]" /> 演示环境，点击即视为支付成功
        </p>
      </Dialog>
    </div>
  );
}
