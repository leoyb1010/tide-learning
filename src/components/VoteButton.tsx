"use client";

import { useState } from "react";
import { CaretUp } from "@phosphor-icons/react/dist/ssr";

/**
 * VoteButton — 投票即时变化（§6.6 验收）。
 * 服务端校验订阅/周票额/单需求上限；此处处理乐观更新与错误回滚。
 */
export function VoteButton({
  demandId,
  initialVotes,
  canVote,
  disabledReason,
}: {
  demandId: string;
  initialVotes: number;
  canVote: boolean;
  disabledReason?: string;
}) {
  const [votes, setVotes] = useState(initialVotes);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [justVoted, setJustVoted] = useState(false);

  async function vote() {
    if (loading || !canVote) return;
    setLoading(true);
    setMsg(null);
    const prev = votes;
    setVotes((v) => v + 1); // 乐观
    try {
      const res = await fetch(`/api/demands/${demandId}/vote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ count: 1 }),
      });
      const json = await res.json();
      if (!json.ok) {
        setVotes(prev);
        setMsg(json.error);
      } else {
        setVotes(json.data.totalVotes);
        setJustVoted(true);
        setMsg(`已投票 · 本周剩 ${json.data.remainingThisWeek} 票`);
      }
    } catch {
      setVotes(prev);
      setMsg("网络异常，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={vote}
        disabled={!canVote || loading}
        title={!canVote ? disabledReason : undefined}
        className={`flex flex-col items-center gap-0.5 rounded-xl border px-4 py-2 text-sm font-medium transition-all duration-200 [transition-timing-function:var(--ease-out-expo)] active:scale-[0.95] disabled:cursor-not-allowed disabled:opacity-60 ${
          justVoted ? "border-accent-300 bg-accent-50 text-accent-700" : "border-ink-200 bg-paper-raised text-ink-950 hover:border-accent-400 hover:text-accent-700"
        }`}
      >
        <CaretUp size={15} weight="bold" className={`transition-transform duration-200 ${justVoted ? "-translate-y-0.5" : ""} ${loading ? "animate-pulse" : ""}`} />
        <span className="num text-[0.9rem]">{votes.toLocaleString()}</span>
      </button>
      {msg && <span className="text-xs text-ink-400">{msg}</span>}
      {!canVote && !msg && disabledReason && <span className="text-xs text-ink-400">{disabledReason}</span>}
    </div>
  );
}
