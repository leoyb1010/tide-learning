"use client";

import { useEffect, useState } from "react";
import { CaretUp, Bell, BellRinging } from "@phosphor-icons/react/dist/ssr";
import { Ripple, FlipCounter } from "./motion";
import { useToast } from "./Toast";
import { track } from "@/lib/analytics-client";
import { msUntilWeekReset } from "@/lib/week";

/**
 * VoteButton — 投票即时变化（§6.6 验收）。
 * 服务端校验订阅/周票额/单需求上限；此处处理乐观更新与错误回滚。
 * v1.0 升级：Ripple 点击涟漪 + FlipCounter 票数翻牌 + Toast 反馈，去掉 animate-pulse。
 * 可选传入 weeklyRemaining 展示 5 格水滴余额（消耗时对应格缩没）。
 */
export function VoteButton({
  demandId,
  initialVotes,
  canVote,
  disabledReason,
  weeklyRemaining,
  weeklyBudget = 5,
  showReset = false,
}: {
  demandId: string;
  initialVotes: number;
  canVote: boolean;
  disabledReason?: string;
  weeklyRemaining?: number;
  weeklyBudget?: number;
  showReset?: boolean;
}) {
  const { toast } = useToast();
  const [votes, setVotes] = useState(initialVotes);
  const [loading, setLoading] = useState(false);
  const [remaining, setRemaining] = useState<number | undefined>(weeklyRemaining);
  const [justVoted, setJustVoted] = useState(false);
  const [countdown, setCountdown] = useState<string | null>(null);

  // 周界重置倒计时（HH:mm 粒度，每分钟刷新）。
  useEffect(() => {
    if (!showReset) return;
    const fmt = () => {
      const ms = msUntilWeekReset();
      const totalMin = Math.floor(ms / 60000);
      const d = Math.floor(totalMin / (60 * 24));
      const h = Math.floor((totalMin % (60 * 24)) / 60);
      const m = totalMin % 60;
      setCountdown(d > 0 ? `${d}天${h}小时` : `${h}小时${m}分`);
    };
    fmt();
    const t = setInterval(fmt, 60000);
    return () => clearInterval(t);
  }, [showReset]);

  async function vote() {
    if (loading || !canVote) return;
    if (remaining !== undefined && remaining <= 0) {
      toast("本周票额已用完，下周一重置", { tone: "warn" });
      return;
    }
    setLoading(true);
    const prev = votes;
    setVotes((v) => v + 1); // 乐观
    try {
      const res = await fetch(`/api/demands/${demandId}/vote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ count: 1 }),
      });
      const json = (await res.json()) as
        | { ok: true; data: { totalVotes: number; remainingThisWeek: number; myVotesForDemand: number } }
        | { ok: false; error: string };
      if (!json.ok) {
        setVotes(prev);
        toast(json.error, { tone: "warn" });
      } else {
        setVotes(json.data.totalVotes);
        setRemaining(json.data.remainingThisWeek);
        setJustVoted(true);
        setTimeout(() => setJustVoted(false), 900);
        toast(`已投票 · 本周剩 ${json.data.remainingThisWeek} 票`, { tone: "success" });
      }
    } catch {
      setVotes(prev);
      toast("网络异常，请重试", { tone: "warn" });
    } finally {
      setLoading(false);
    }
  }

  // 水滴余额：filled 格数 = 剩余票；被消耗的格淡出缩小。
  const showDroplets = remaining !== undefined && canVote;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Ripple className="rounded-xl">
        <button
          onClick={vote}
          disabled={!canVote || loading}
          title={!canVote ? disabledReason : undefined}
          className={`flex flex-col items-center gap-0.5 rounded-xl border px-4 py-2 text-sm font-medium transition-all duration-[var(--dur-fast)] [transition-timing-function:var(--ease-tide)] active:scale-[0.95] disabled:cursor-not-allowed disabled:opacity-60 ${
            justVoted
              ? "border-accent-300 bg-accent-50 text-accent-700"
              : "border-ink-200 bg-paper-raised text-ink-950 hover:border-accent-400 hover:text-accent-700"
          }`}
        >
          <CaretUp
            size={15}
            weight="bold"
            className={`transition-transform duration-[var(--dur-fast)] ${justVoted ? "-translate-y-0.5" : ""}`}
          />
          <FlipCounter value={votes} className="text-[0.9rem]" />
        </button>
      </Ripple>

      {showDroplets && (
        <div className="flex items-center gap-1" aria-label={`本周剩余 ${remaining} 票`}>
          {Array.from({ length: weeklyBudget }).map((_, i) => {
            const filled = i < (remaining ?? 0);
            return (
              <span
                key={i}
                className={`h-2 w-2 rounded-full transition-all duration-[var(--dur-normal)] [transition-timing-function:var(--ease-tide)] ${
                  filled ? "scale-100 bg-accent-500" : "scale-50 bg-ink-200 opacity-50"
                }`}
              />
            );
          })}
        </div>
      )}

      {showReset && countdown && canVote && (
        <span className="text-xs text-ink-400">{countdown}后重置票额</span>
      )}
      {!canVote && disabledReason && <span className="text-xs text-ink-400">{disabledReason}</span>}
    </div>
  );
}

/**
 * DemandFollowButton — 关注/取关需求（C2.4：进度订阅）。
 * 与投票同为需求头部动作，故与 VoteButton 同域。乐观切换 + Toast + 埋点。
 */
export function DemandFollowButton({
  demandId,
  initialFollowing,
  initialCount,
  canFollow,
  disabledReason,
}: {
  demandId: string;
  initialFollowing: boolean;
  initialCount: number;
  canFollow: boolean;
  disabledReason?: string;
}) {
  const { toast } = useToast();
  const [following, setFollowing] = useState(initialFollowing);
  const [count, setCount] = useState(initialCount);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    if (loading) return;
    if (!canFollow) {
      toast(disabledReason ?? "登录后可关注", { tone: "warn" });
      return;
    }
    setLoading(true);
    const next = !following;
    // 乐观切换
    setFollowing(next);
    setCount((c) => c + (next ? 1 : -1));
    try {
      const res = await fetch(`/api/demands/${demandId}/follow`, {
        method: next ? "POST" : "DELETE",
      });
      const json = (await res.json()) as
        | { ok: true; data: { following: boolean; followerCount: number } }
        | { ok: false; error: string };
      if (!json.ok) {
        setFollowing(!next);
        setCount((c) => c + (next ? -1 : 1));
        toast(json.error, { tone: "warn" });
      } else {
        setFollowing(json.data.following);
        setCount(json.data.followerCount);
        track("demand_follow", { demand_id: demandId, action: next ? "follow" : "unfollow" });
        toast(next ? "已关注，进度更新会通知你" : "已取消关注", { tone: "success" });
      }
    } catch {
      setFollowing(!next);
      setCount((c) => c + (next ? -1 : 1));
      toast("网络异常，请重试", { tone: "warn" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      title={!canFollow ? disabledReason : undefined}
      className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-medium transition-all duration-[var(--dur-fast)] [transition-timing-function:var(--ease-tide)] active:scale-[0.96] disabled:opacity-60 ${
        following
          ? "border-accent-300 bg-accent-50 text-accent-700"
          : "border-ink-200 bg-paper-raised text-ink-700 hover:border-accent-400 hover:text-accent-700"
      }`}
    >
      {following ? <BellRinging size={16} weight="fill" /> : <Bell size={16} />}
      {following ? "已关注" : "关注进度"}
      <FlipCounter value={count} className="text-xs text-ink-400" />
    </button>
  );
}
