"use client";

import { useState } from "react";
import { useToast } from "@/components/Toast";

interface LedgerRow {
  id: string;
  delta: number;
  type: string;
  reason: string | null;
  balanceAfter: number;
  createdAt: string;
}
interface CreditUser {
  id: string;
  nickname: string;
  email: string | null;
  balance: number;
  totalEarned: number;
  totalSpent: number;
  ledger: LedgerRow[];
}

const TYPE_LABEL: Record<string, string> = {
  signup_bonus: "注册赠送",
  monthly_grant: "月度赠送",
  recharge: "充值",
  share_reward: "分享奖励",
  llm_spend: "AI 消耗",
  admin_adjust: "管理调账",
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * 积分管理台：搜索用户 → 查看余额/流水 → 手动 +/- 调账。
 * 全走 STUDIO token；数字 mono；调账走 /api/admin/credits/adjust。
 */
export function AdminCreditManager() {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<CreditUser[] | null>(null);
  const [searching, setSearching] = useState(false);
  // 每个用户独立的调账表单状态
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (!q.trim()) return;
    setSearching(true);
    try {
      const json = await fetch(`/api/admin/credits?q=${encodeURIComponent(q.trim())}`).then((r) => r.json());
      if (json.ok) setUsers(json.data.users as CreditUser[]);
      else toast(json.error ?? "查询失败", { tone: "warn" });
    } catch {
      toast("网络异常，请重试", { tone: "warn" });
    } finally {
      setSearching(false);
    }
  }

  async function adjust(userId: string) {
    const raw = (amounts[userId] ?? "").trim();
    const reason = (reasons[userId] ?? "").trim();
    const amount = Number(raw);
    if (!raw || !Number.isFinite(amount) || amount === 0 || !Number.isInteger(amount)) {
      toast("调账积分需为非零整数", { tone: "warn" });
      return;
    }
    if (!reason) {
      toast("请填写调账原因", { tone: "warn" });
      return;
    }
    setSubmitting(userId);
    try {
      const json = await fetch("/api/admin/credits/adjust", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, amount, reason }),
      }).then((r) => r.json());
      if (json.ok) {
        toast(`已调账 ${amount > 0 ? "+" : ""}${amount}，余额 ${json.data.balance}`, { tone: "success" });
        setAmounts((s) => ({ ...s, [userId]: "" }));
        setReasons((s) => ({ ...s, [userId]: "" }));
        search(); // 刷新余额与流水
      } else {
        toast(json.error ?? "调账失败", { tone: "warn" });
      }
    } catch {
      toast("网络异常，请重试", { tone: "warn" });
    } finally {
      setSubmitting(null);
    }
  }

  const inputCls =
    "rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--ink3)]";

  return (
    <div className="space-y-5">
      {/* 搜索 */}
      <form onSubmit={search} className="flex flex-wrap items-center gap-2.5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索用户（昵称 / 邮箱）"
          className={`${inputCls} min-w-[240px] flex-1`}
          aria-label="搜索用户"
        />
        <button
          type="submit"
          disabled={searching || !q.trim()}
          className="rounded-[10px] bg-[var(--ink)] px-4 py-2 text-[13px] font-semibold text-[var(--surface)] transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {searching ? "查询中…" : "查询"}
        </button>
      </form>

      {/* 结果 */}
      {users === null ? (
        <p className="text-[13px] text-[var(--ink3)]">输入昵称或邮箱以查询用户积分账户。</p>
      ) : users.length === 0 ? (
        <p className="text-[13px] text-[var(--ink3)]">未找到匹配用户。</p>
      ) : (
        <div className="space-y-4">
          {users.map((u) => (
            <div
              key={u.id}
              className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)]"
            >
              {/* 用户头部 + 余额 */}
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-[var(--ink)]">{u.nickname}</p>
                  <p className="mono mt-0.5 text-[12px] text-[var(--ink3)]">{u.email ?? u.id}</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-wide text-[var(--ink4)]">当前余额</p>
                  <p className="mono text-[22px] font-bold leading-tight text-[var(--red)]">{u.balance}</p>
                  <p className="mono mt-0.5 text-[11px] text-[var(--ink4)]">
                    累计入账 {u.totalEarned} · 消耗 {u.totalSpent}
                  </p>
                </div>
              </div>

              {/* 调账表单 */}
              <div className="mt-4 flex flex-wrap items-center gap-2.5 rounded-[12px] border border-[var(--border2)] bg-[var(--surface2)] p-3.5">
                <input
                  type="number"
                  step={1}
                  value={amounts[u.id] ?? ""}
                  onChange={(e) => setAmounts((s) => ({ ...s, [u.id]: e.target.value }))}
                  placeholder="±积分"
                  className={`${inputCls} mono w-[110px]`}
                  aria-label="调账积分（正为入账，负为扣减）"
                />
                <input
                  value={reasons[u.id] ?? ""}
                  onChange={(e) => setReasons((s) => ({ ...s, [u.id]: e.target.value }))}
                  placeholder="调账原因（审计留痕）"
                  className={`${inputCls} min-w-[180px] flex-1`}
                  aria-label="调账原因"
                />
                <button
                  onClick={() => adjust(u.id)}
                  disabled={submitting === u.id}
                  className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[13px] font-semibold text-[var(--ink)] transition-colors hover:border-[var(--ink3)] disabled:opacity-40"
                >
                  {submitting === u.id ? "提交中…" : "调账"}
                </button>
              </div>
              <p className="mt-1.5 text-[12px] text-[var(--ink4)]">正数为补偿入账，负数为扣减（不透支，余额不足将拒绝）。</p>

              {/* 最近流水 */}
              <div className="mt-4">
                <p className="mb-2 text-[12px] font-medium text-[var(--ink2)]">最近流水</p>
                {u.ledger.length === 0 ? (
                  <p className="text-[12px] text-[var(--ink4)]">暂无流水。</p>
                ) : (
                  <div className="overflow-x-auto rounded-[12px] border border-[var(--border)]">
                    <table className="w-full text-[13px]">
                      <thead className="border-b border-[var(--border)] text-left text-[var(--ink4)]">
                        <tr>
                          <th className="px-3 py-2 font-medium">时间</th>
                          <th className="px-3 py-2 font-medium">类型</th>
                          <th className="px-3 py-2 font-medium">变动</th>
                          <th className="px-3 py-2 font-medium">余额</th>
                          <th className="px-3 py-2 font-medium">备注</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {u.ledger.map((l) => (
                          <tr key={l.id}>
                            <td className="mono whitespace-nowrap px-3 py-2 text-[var(--ink3)]">{fmtTime(l.createdAt)}</td>
                            <td className="px-3 py-2 text-[var(--ink2)]">{TYPE_LABEL[l.type] ?? l.type}</td>
                            <td
                              className={`mono px-3 py-2 font-medium ${l.delta >= 0 ? "text-[var(--ink)]" : "text-[var(--red)]"}`}
                            >
                              {l.delta > 0 ? "+" : ""}
                              {l.delta}
                            </td>
                            <td className="mono px-3 py-2 text-[var(--ink3)]">{l.balanceAfter}</td>
                            <td className="max-w-[220px] truncate px-3 py-2 text-[var(--ink3)]" title={l.reason ?? ""}>
                              {l.reason ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
