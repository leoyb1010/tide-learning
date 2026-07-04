"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Flame, Bell, BellRinging } from "@phosphor-icons/react/dist/ssr";
import { Ripple, FlipCounter, SPRING_TIDE } from "./motion";
import { useToast } from "./Toast";
import { track } from "@/lib/analytics-client";
import { msUntilWeekReset } from "@/lib/week";

/**
 * VoteButton — 课程共创「点火 / 助推」按钮（v4.0 视觉重做）。
 *
 * 隐喻：给心仪的课程需求投票 = 一起点燃这门课。
 *   未投 → 静默火种（引信极缓呼吸，暗示可点燃）
 *   投票瞬间 → 火苗窜起 + 火星迸溅 + 火力值弹跳（一次性庆祝）
 *   已投 → 火苗稳态轻曳的「已助推」确定感
 *   票额耗尽 → 冷却余温（暖底明灭 + 重置倒计时）
 * 票数即「火力值」；水滴余额升级为「火种 ×N」余量指示。
 *
 * 功能契约保持不变（只重做视觉与投票瞬间动效）：
 *   vote() 回调 / remaining 票额 / weeklyBudget 火种格 / countdown 冷却 /
 *   disabledReason / FlipCounter 票数滚动 / onVotesChange 乐观回调。
 *
 * 架构：纯 client 组件，只引 client 原语（motion / lib 纯函数 week、analytics-client）。
 * 动效全部 transform/opacity/filter，reduce-motion 由 globals.css 统一降级为静态直显。
 */
export function VoteButton({
  demandId,
  initialVotes,
  canVote,
  disabledReason,
  weeklyRemaining,
  weeklyBudget = 5,
  showReset = false,
  onVotesChange,
}: {
  demandId: string;
  initialVotes: number;
  canVote: boolean;
  disabledReason?: string;
  weeklyRemaining?: number;
  weeklyBudget?: number;
  showReset?: boolean;
  /** 票数变化回调（乐观 + 服务端确认）——用于让外层进度条弹性增长。不改动投票 API/逻辑。 */
  onVotesChange?: (total: number) => void;
}) {
  const { toast } = useToast();
  const [votes, setVotes] = useState(initialVotes);
  const [loading, setLoading] = useState(false);
  const [remaining, setRemaining] = useState<number | undefined>(weeklyRemaining);
  const [ignite, setIgnite] = useState(false); // 一次性点火迸发（0.9s 后落定）
  const [hasVoted, setHasVoted] = useState(false); // 本会话已助推 → 火苗稳态点亮
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
      toast("本周火种已用完，下周一重新点燃", { tone: "warn" });
      return;
    }
    setLoading(true);
    const prev = votes;
    setVotes((v) => v + 1); // 乐观
    onVotesChange?.(prev + 1); // 外层进度条随乐观值弹性增长
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
        onVotesChange?.(prev); // 回滚外层进度条
        toast(json.error, { tone: "warn" });
      } else {
        setVotes(json.data.totalVotes);
        onVotesChange?.(json.data.totalVotes); // 以服务端权威值校正进度条
        setRemaining(json.data.remainingThisWeek);
        setHasVoted(true);
        setIgnite(true);
        setTimeout(() => setIgnite(false), 900); // 迸发落定，回稳态火苗
        toast(`已助推 · 本周剩 ${json.data.remainingThisWeek} 颗火种`, { tone: "success" });
      }
    } catch {
      setVotes(prev);
      onVotesChange?.(prev); // 网络异常回滚
      toast("网络异常，请重试", { tone: "warn" });
    } finally {
      setLoading(false);
    }
  }

  // —— 四态判定 ——
  const depleted = remaining !== undefined && remaining <= 0; // 票额耗尽（火种耗尽）
  const cooling = !canVote; // 冷却中：不满足投票条件（未订阅/未登录等）
  const lit = hasVoted && !depleted; // 已点燃：本会话已助推且仍有火种
  // 火种余量指示：仅在可投且服务端下发了余量时展示
  const showTinder = remaining !== undefined && canVote;

  // 按钮外观：四态清晰区隔（红只做点睛，不铺满）
  const shellCls = cooling
    ? "border-[var(--border)] bg-[var(--surface2)] text-[var(--ink3)]"
    : depleted
    ? "vote-cooldown-glow border-[var(--red-soft-border)] bg-[var(--red-soft)] text-[var(--ink3)]"
    : lit
    ? "border-[var(--red-soft-border)] bg-[var(--red-soft)] text-[var(--red-ink)]"
    : "border-[var(--border2)] bg-[var(--surface)] text-[var(--ink)] hover:border-[var(--red-soft-border)] hover:text-[var(--red-ink)]";

  // 火苗图标态：已点燃/迸发用 fill 暖色，其余用轮廓火种
  const flameFilled = lit || ignite || depleted;
  const flameColor = cooling ? "text-[var(--ink4)]" : "text-[var(--red)]";

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Ripple className="rounded-[13px]" color="rgba(252,1,26,0.28)">
        <button
          onClick={vote}
          disabled={!canVote || loading}
          aria-label={
            cooling
              ? disabledReason ?? "暂不可助推"
              : depleted
              ? "本周火种已用完"
              : lit
              ? `已助推，火力值 ${votes}，点击继续助推`
              : `助推这门课，当前火力值 ${votes}`
          }
          aria-pressed={lit}
          title={cooling ? disabledReason : undefined}
          className={`group/vote studio-press relative flex min-h-[44px] items-center gap-2 rounded-[13px] border px-3.5 py-2 text-sm font-semibold shadow-[var(--card)] transition-[color,background-color,border-color,box-shadow] duration-[var(--dur-fast)] [transition-timing-function:var(--ease-tide)] disabled:cursor-not-allowed disabled:opacity-70 ${shellCls}`}
        >
          {/* 火种 / 火苗：容器承接迸发+摇曳动效，火星在此层向上飞散 */}
          <span className="relative inline-flex h-[18px] w-[18px] items-center justify-center">
            <Flame
              size={18}
              weight={flameFilled ? "fill" : "regular"}
              className={`${flameColor} ${
                ignite
                  ? "vote-ignite"
                  : lit
                  ? "vote-flame-lit"
                  : cooling || depleted
                  ? ""
                  : "vote-ember group-hover/vote:opacity-100"
              }`}
            />
            {/* 点火火星：迸发瞬间飞散的三点，reduce-motion 下不显示 */}
            {ignite && (
              <>
                <span
                  className="vote-spark pointer-events-none absolute left-1/2 top-1/2 h-1 w-1 rounded-full bg-[var(--red)]"
                  style={{ ["--sx" as string]: "-9px", ["--sy" as string]: "-15px" }}
                  aria-hidden
                />
                <span
                  className="vote-spark pointer-events-none absolute left-1/2 top-1/2 h-1 w-1 rounded-full bg-[var(--red)]"
                  style={{ ["--sx" as string]: "8px", ["--sy" as string]: "-16px", animationDelay: "40ms" }}
                  aria-hidden
                />
                <span
                  className="vote-spark pointer-events-none absolute left-1/2 top-1/2 h-[3px] w-[3px] rounded-full bg-[var(--red-active)]"
                  style={{ ["--sx" as string]: "1px", ["--sy" as string]: "-19px", animationDelay: "80ms" }}
                  aria-hidden
                />
              </>
            )}
          </span>

          {/* 文案 + 火力值：已助推显「已助推」确定感，否则「助推」；票数=火力值 */}
          <span className="inline-flex items-center gap-1.5 leading-none">
            <span className="whitespace-nowrap">
              {depleted ? "火种耗尽" : lit ? "已助推" : "助推"}
            </span>
            <motion.span
              className={`inline-flex ${ignite ? "vote-fuel-pop" : ""}`}
              animate={ignite ? { scale: [1, 1.28, 1] } : { scale: 1 }}
              transition={{ ...SPRING_TIDE, type: "spring" }}
            >
              <FlipCounter value={votes} className="text-[0.9rem]" />
            </motion.span>
          </span>
        </button>
      </Ripple>

      {/* 火种余量指示（原水滴格升级）：filled=待点燃的火种亮，spent=已用格缩暗 */}
      {showTinder && (
        <div className="flex items-center gap-1" aria-label={`本周剩余 ${remaining} 颗火种`}>
          {Array.from({ length: weeklyBudget }).map((_, i) => {
            const filled = i < (remaining ?? 0);
            return (
              <span
                key={i}
                className={`vote-tinder h-2 w-2 rounded-full ${
                  filled
                    ? "scale-100 bg-[var(--red)] opacity-100 shadow-[0_0_0_2px_var(--red-soft)]"
                    : "scale-[0.55] bg-[var(--ink4)] opacity-45"
                }`}
              />
            );
          })}
        </div>
      )}

      {showReset && countdown && canVote && (
        <span className="text-xs text-[var(--ink4)]">{countdown}后火种重燃</span>
      )}
      {!canVote && disabledReason && <span className="text-xs text-[var(--ink4)]">{disabledReason}</span>}
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
      className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-medium transition-all duration-[var(--dur-fast)] [transition-timing-function:var(--ease-tide)] active:scale-[0.96] disabled:opacity-60 ${
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
