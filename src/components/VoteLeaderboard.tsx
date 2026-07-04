"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Trophy,
  ChatCircle,
  TrendUp,
  Waves,
  Quotes,
} from "@phosphor-icons/react/dist/ssr";
import { VoteButton } from "./VoteButton";
import { DEMAND_STATUS } from "@/lib/format";
import type { RankedDemandView } from "@/lib/queries";

/**
 * VoteLeaderboard, 课程共创投票重设计（§6.6 v2）。
 * 顶部「本周之星」深色 Color Block 大卡 + 生命周期阶段轨 + 增强需求卡列表。
 * 每张卡新增：讨论数、本周新增票（↑N 绿字）、支持者头像堆叠、发起人一句话理由。
 * 投票逻辑/API 完全复用 VoteButton，不做改动。
 */

const SPRING = { type: "spring" as const, stiffness: 260, damping: 26 };

// 需求生命周期阶段轨（对应 status 的推进）。信号红仅点亮当前阶段。
const LIFECYCLE = [
  { key: "collecting", label: "征集" },
  { key: "evaluating", label: "评估" },
  { key: "scheduled", label: "排期" },
  { key: "producing", label: "制作" },
  { key: "launched", label: "上线" },
] as const;

function lifecycleIndex(status: string): number {
  const i = LIFECYCLE.findIndex((s) => s.key === status);
  return i < 0 ? 0 : i;
}

/** 支持者头像堆叠：前 5 个圆头像叠放，多余显示 +N。 */
function SupporterStack({
  supporters,
  total,
  tone = "light",
}: {
  supporters: RankedDemandView["supporters"];
  total: number;
  tone?: "light" | "dark";
}) {
  if (supporters.length === 0) return null;
  const ring = tone === "dark" ? "ring-white/15" : "ring-[var(--surface)]";
  const extra = total - supporters.length;
  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {supporters.map((u) => (
          <span
            key={u.id}
            title={u.nickname}
            className={`inline-flex h-7 w-7 items-center justify-center overflow-hidden rounded-full ring-2 ${ring}`}
          >
            {u.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={u.avatarUrl}
                alt=""
                width={28}
                height={28}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : (
              <span
                className={`flex h-full w-full items-center justify-center text-[11px] font-semibold ${
                  tone === "dark"
                    ? "bg-white/15 text-white"
                    : "bg-[var(--surface-inset)] text-[var(--ink2)]"
                }`}
                aria-hidden
              >
                {u.nickname.charAt(0) || "?"}
              </span>
            )}
          </span>
        ))}
      </div>
      {extra > 0 && (
        <span
          className={`mono ml-2 text-[11px] ${
            tone === "dark" ? "text-white/60" : "text-[var(--ink4)]"
          }`}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}

/** 本周新增票信号：↑N，绿色小字（正向增长信号）。 */
function WeeklyDelta({
  recent,
  tone = "light",
}: {
  recent: number;
  tone?: "light" | "dark";
}) {
  if (recent <= 0) return null;
  // 正向增长信号：亮/暗都用 --ok 语义色（token 已双值，深色区对比达标）
  return (
    <span
      className={`mono inline-flex items-center gap-0.5 text-[11px] font-semibold ${
        tone === "dark" ? "text-[var(--ok)] brightness-125" : "text-[var(--ok)]"
      }`}
      title="本周新增票数"
    >
      <TrendUp size={12} weight="bold" />↑{recent}
    </span>
  );
}

/** 头部「本周之星」大卡：票数第一的需求做成醒目深色 Color Block。 */
function StarCard({
  demand,
  canVote,
  disabledReason,
}: {
  demand: RankedDemandView;
  canVote: boolean;
  disabledReason?: string;
}) {
  const idx = lifecycleIndex(demand.status);
  const status = DEMAND_STATUS[demand.status] ?? { label: demand.status };
  const pitch = demand.description?.trim();
  // 本周之星实时票数：投票成功时大号票数弹跳、水位条弹性满格。
  const [liveVotes, setLiveVotes] = useState(demand.totalVotes);
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING}
      className="relative overflow-hidden rounded-[18px] p-6 text-white shadow-[var(--lift)]"
      style={{ background: "var(--video-grad)" }}
    >
      {/* 右上红圆装饰（信号红，低透明） */}
      <div
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[var(--red)] opacity-25 blur-[2px]"
        aria-hidden
      />
      <div className="relative">
        <div className="flex items-center gap-2">
          <span className="mono inline-flex items-center gap-1.5 rounded-full bg-[var(--red)] px-2.5 py-1 text-[11px] font-bold tracking-[0.06em] text-white">
            <Trophy size={13} weight="fill" />
            本周之星
          </span>
          <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-[11px] text-white/80">
            {demand.categoryLabel}
          </span>
          <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-[11px] font-medium text-white/85">
            {status.label}
          </span>
        </div>

        <Link href={`/demands/${demand.id}`} className="group mt-4 block">
          <h2 className="text-[22px] font-bold leading-[1.3] transition-colors group-hover:text-white/85">
            {demand.title}
          </h2>
        </Link>

        {pitch && (
          <div className="mt-3 flex gap-2 text-white/70">
            <Quotes size={16} weight="fill" className="mt-0.5 shrink-0 text-white/40" />
            <p className="line-clamp-2 max-w-[560px] text-[14px] leading-[1.65]">
              {pitch}
              {demand.authorNickname && (
                <span className="ml-1.5 text-white/45">· {demand.authorNickname}</span>
              )}
            </p>
          </div>
        )}

        {/* 票数 + 支持者堆叠 + 本周新增 */}
        <div className="mt-5 flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="flex items-baseline gap-1.5">
            {/* 投票成功时大号票数弹跳（key 变化触发 spring scale） */}
            <motion.span
              key={liveVotes}
              initial={{ scale: 1.3 }}
              animate={{ scale: 1 }}
              transition={{ ...SPRING, type: "spring" }}
              className="mono text-[34px] font-extrabold leading-none tabular-nums"
            >
              {liveVotes}
            </motion.span>
            <span className="text-[13px] text-white/60">票</span>
            <span className="ml-1">
              <WeeklyDelta recent={demand.recentVotes} tone="dark" />
            </span>
          </div>
          {demand.supporters.length > 0 && (
            <div className="flex items-center gap-2.5">
              <SupporterStack
                supporters={demand.supporters}
                total={demand.totalVotes}
                tone="dark"
              />
              <span className="text-[12px] text-white/55">位支持者已加入</span>
            </div>
          )}
          {demand.commentCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[12px] text-white/60">
              <ChatCircle size={14} weight="fill" className="text-white/40" />
              {demand.commentCount} 条讨论
            </span>
          )}
        </div>

        {/* 生命周期阶段轨 */}
        <div className="mt-6">
          <LifecycleTrack currentIndex={idx} tone="dark" />
        </div>

        {/* 领跑水位条：投票成功时弹性满格并微微起伏（榜首领跑信号）。 */}
        <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-white/12">
          <motion.div
            key={liveVotes}
            className="h-full rounded-full bg-[var(--red)]"
            initial={{ width: "92%" }}
            animate={{ width: "100%" }}
            transition={{ ...SPRING, type: "spring" }}
            aria-hidden
          />
        </div>

        {/* 底部：预计排期状态 + 投票 */}
        <div className="mt-5 flex items-center justify-between gap-4">
          <ScheduleHint status={demand.status} tone="dark" />
          <div className="shrink-0">
            <VoteButton
              demandId={demand.id}
              initialVotes={demand.totalVotes}
              canVote={canVote}
              disabledReason={disabledReason}
              onVotesChange={setLiveVotes}
            />
          </div>
        </div>
      </div>
    </motion.section>
  );
}

/** 预计排期/进度状态提示。 */
function ScheduleHint({ status, tone = "light" }: { status: string; tone?: "light" | "dark" }) {
  const map: Record<string, string> = {
    collecting: "征集中 · 达到票数阈值后进入评估",
    evaluating: "评估中 · 教研团队正在排期评审",
    scheduled: "已排期 · 即将进入制作",
    producing: "制作中 · 关注可追更新进度",
    launched: "已上线 · 立即开学",
  };
  const text = map[status] ?? "征集中";
  const muted = tone === "dark" ? "text-white/60" : "text-[var(--ink3)]";
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12px] ${muted}`}>
      <Waves size={14} weight="fill" className={tone === "dark" ? "text-[var(--red)]" : "text-[var(--red)]"} />
      {text}
    </span>
  );
}

/** 生命周期阶段轨：collecting→evaluating→scheduled→producing→launched。 */
function LifecycleTrack({
  currentIndex,
  tone = "light",
}: {
  currentIndex: number;
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";
  return (
    <ol className="flex items-center gap-1.5">
      {LIFECYCLE.map((s, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        const dotBase = "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold mono transition-colors";
        const dotCls = active
          ? "bg-[var(--red)] text-white"
          : done
            ? dark
              ? "bg-white/85 text-[var(--video-bg)]"
              : "bg-[var(--ink)] text-[var(--surface)]"
            : dark
              ? "bg-white/12 text-white/45"
              : "bg-[var(--surface-inset)] text-[var(--ink4)]";
        const labelCls = active
          ? dark
            ? "text-white"
            : "text-[var(--ink)]"
          : dark
            ? "text-white/55"
            : "text-[var(--ink4)]";
        const barCls = done
          ? "bg-[var(--red)]"
          : dark
            ? "bg-white/15"
            : "bg-[var(--border)]";
        return (
          <li key={s.key} className="flex items-center gap-1.5" aria-current={active ? "step" : undefined}>
            <div className="flex flex-col items-center gap-1">
              <span className={`${dotBase} ${dotCls}`}>{i + 1}</span>
              <span className={`text-[11px] ${labelCls}`}>{s.label}</span>
            </div>
            {i < LIFECYCLE.length - 1 && (
              <span className={`mb-4 h-[2px] w-5 rounded-full ${barCls}`} aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** 单张增强需求卡（非榜首）。 */
function RankedCard({
  demand,
  rank,
  topVotes,
  canVote,
  disabledReason,
}: {
  demand: RankedDemandView;
  rank: number;
  topVotes: number;
  canVote: boolean;
  disabledReason?: string;
}) {
  const status = DEMAND_STATUS[demand.status] ?? { label: demand.status };
  const scheduled = ["scheduled", "producing"].includes(demand.status);
  // 实时票数：投票成功时进度条随之弹性增长（投票 API 不变，仅接收 VoteButton 的票数回调）。
  const [liveVotes, setLiveVotes] = useState(demand.totalVotes);
  const [voted, setVoted] = useState(false); // 投票后进度条即时弹性增长（去掉入场 delay）
  const pct = Math.max(4, Math.min(100, Math.round((liveVotes / topVotes) * 100)));
  const pitch = demand.description?.trim();
  // 入场时进度条从 0 生长并带排名错峰 delay；投票后重算宽度且无 delay，spring 弹性满格。
  const barTransition = voted
    ? SPRING
    : { ...SPRING, delay: Math.min(rank * 0.03, 0.24) + 0.1 };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING, delay: Math.min(rank * 0.03, 0.24) }}
      className="studio-lift flex items-stretch gap-4 rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]"
    >
      {/* 排名 */}
      <div className="mono flex w-7 shrink-0 items-start justify-center pt-0.5 text-[19px] font-extrabold text-[var(--ink4)]">
        {String(rank).padStart(2, "0")}
      </div>

      <div className="min-w-0 flex-1">
        <Link href={`/demands/${demand.id}`} className="block">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[15px] font-bold text-[var(--ink)]">{demand.title}</h3>
            <span className="rounded-full border border-[var(--border)] bg-[var(--surface-inset)] px-2.5 py-0.5 text-[11px] text-[var(--ink3)]">
              {demand.categoryLabel}
            </span>
            {scheduled && (
              <span className="rounded-full border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--red)]">
                {status.label}
              </span>
            )}
            {demand.status === "launched" && (
              <span className="rounded-full border border-[var(--border)] bg-[var(--new-bg)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--new-ink)]">
                {status.label}
              </span>
            )}
          </div>
        </Link>

        {/* 发起人一句话理由 */}
        {pitch && (
          <div className="mt-1.5 flex items-start gap-1.5 text-[var(--ink3)]">
            <Quotes size={13} weight="fill" className="mt-[3px] shrink-0 text-[var(--ink4)]" />
            <p className="line-clamp-1 text-[13px] leading-[1.55]">
              {pitch}
              {demand.authorNickname && (
                <span className="ml-1 text-[var(--ink4)]">· {demand.authorNickname}</span>
              )}
            </p>
          </div>
        )}

        {/* 票占比进度条：投票成功时随 liveVotes 弹性增长（spring width）。 */}
        <div className="mt-2.5 flex items-center gap-2.5">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-inset)]">
            <motion.div
              className="h-full rounded-full bg-[var(--red)]"
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={barTransition}
              aria-hidden
            />
          </div>
          <span className="mono shrink-0 text-[11px] text-[var(--ink4)]">{liveVotes} 票</span>
        </div>

        {/* 社交信号行：支持者堆叠 + 讨论数 + 本周新增 */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
          {demand.supporters.length > 0 && (
            <SupporterStack supporters={demand.supporters} total={demand.totalVotes} />
          )}
          <div className="flex items-center gap-3">
            {demand.commentCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[12px] text-[var(--ink3)]">
                <ChatCircle size={13} weight="fill" className="text-[var(--ink4)]" />
                {demand.commentCount} 讨论
              </span>
            )}
            {demand.followerCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[12px] text-[var(--ink3)]">
                <Waves size={13} weight="fill" className="text-[var(--ink4)]" />
                {demand.followerCount} 关注
              </span>
            )}
            <WeeklyDelta recent={demand.recentVotes} />
          </div>
        </div>

        {demand.status === "launched" && demand.launchedCourseId && (
          <Link
            href={`/courses/${demand.launchedCourseId}`}
            className="mt-2 inline-block text-[12px] font-medium text-[var(--red)] hover:underline"
          >
            该需求已上线 → 查看课程
          </Link>
        )}
      </div>

      {/* 右侧投票 */}
      <div className="flex shrink-0 items-center">
        <VoteButton
          demandId={demand.id}
          initialVotes={demand.totalVotes}
          canVote={canVote}
          disabledReason={disabledReason}
          onVotesChange={(v) => {
            setVoted(true);
            setLiveVotes(v);
          }}
        />
      </div>
    </motion.div>
  );
}

export function VoteLeaderboard({
  demands,
  canVote,
  disabledReason,
}: {
  demands: RankedDemandView[];
  canVote: boolean;
  disabledReason?: string;
}) {
  if (demands.length === 0) return null;
  const [star, ...rest] = demands;
  const topVotes = demands.reduce((m, d) => Math.max(m, d.totalVotes), 0) || 1;

  return (
    <div className="space-y-4">
      <StarCard demand={star} canVote={canVote} disabledReason={disabledReason} />

      {rest.length > 0 && (
        <div className="flex flex-col gap-3">
          {rest.map((d, i) => (
            <RankedCard
              key={d.id}
              demand={d}
              rank={i + 2}
              topVotes={topVotes}
              canVote={canVote}
              disabledReason={disabledReason}
            />
          ))}
        </div>
      )}
    </div>
  );
}
