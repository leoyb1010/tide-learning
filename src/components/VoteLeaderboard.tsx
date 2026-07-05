"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  Trophy,
  ChatCircle,
  TrendUp,
  Waves,
  Quotes,
  PlayCircle,
  ArrowRight,
  Robot,
  Translate,
  GraduationCap,
  Heart,
  Sparkle,
} from "@phosphor-icons/react/dist/ssr";
import { VoteButton } from "./VoteButton";
import { AmbientVideo } from "./AmbientVideo";
import { ProposalCard } from "./DemandCard";
import { DEMAND_STATUS } from "@/lib/format";
import { trackGradientVar, trackIconKey } from "@/lib/tracks";
import type { RankedDemandView } from "@/lib/queries";

/**
 * VoteLeaderboard, 课程共创重设计（v3.1 第2轮）。
 * 从「纵向堆叠列表」升级为「Hero 大卡 + 响应式卡墙 grid」：
 *  - 榜首「本周之星」= 横跨整宽的深色 Hero（--video-grad + 大票数 + 趋势 + 演示介绍入口）。
 *  - 其余需求 = ProposalCard 众筹式提案卡，sm:2 列 / lg:3 列 grid，一屏看更多。
 * 投票逻辑/API 完全复用 VoteButton，不做改动。
 */

const SPRING = { type: "spring" as const, stiffness: 260, damping: 26 };

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

const TRACK_ICON: Record<string, typeof Robot> = {
  ai: Robot,
  english: Translate,
  elder: GraduationCap,
  life: Heart,
  default: Sparkle,
};

// 本周之星封面视频的静帧兜底（按 iconKey 选定格图，reduce-motion / 未加载时显示）。
const STAR_POSTER: Record<string, string> = {
  ai: "/lesson-stills/lesson-still-ai.jpg",
  english: "/lesson-stills/lesson-still-oral.jpg",
  elder: "/lesson-stills/lesson-still-silver.jpg",
  life: "/lesson-stills/lesson-still-life.jpg",
};

/** 支持者头像堆叠（Hero 深色版）。 */
function SupporterStack({
  supporters,
  total,
}: {
  supporters: RankedDemandView["supporters"];
  total: number;
}) {
  if (supporters.length === 0) return null;
  const extra = total - supporters.length;
  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {supporters.map((u) => (
          <span
            key={u.id}
            title={u.nickname}
            className="inline-flex h-7 w-7 items-center justify-center overflow-hidden rounded-full ring-2 ring-white/15"
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
                className="flex h-full w-full items-center justify-center bg-white/15 text-[11px] font-semibold text-white"
                aria-hidden
              >
                {u.nickname.charAt(0) || "?"}
              </span>
            )}
          </span>
        ))}
      </div>
      {extra > 0 && <span className="mono ml-2 text-[11px] text-white/60">+{extra}</span>}
    </div>
  );
}

/** 预计排期/进度状态提示（Hero 深色）。 */
function ScheduleHint({ status }: { status: string }) {
  const map: Record<string, string> = {
    collecting: "征集中 · 达到票数阈值后进入评估",
    evaluating: "评估中 · 教研团队正在排期评审",
    scheduled: "已排期 · 即将进入制作",
    producing: "制作中 · 关注可追更新进度",
    launched: "已上线 · 立即开学",
  };
  const text = map[status] ?? "征集中";
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-white/60">
      <Waves size={14} weight="fill" className="text-[var(--red)]" />
      {text}
    </span>
  );
}

/** 生命周期阶段轨（Hero 深色版）。 */
function LifecycleTrack({ currentIndex }: { currentIndex: number }) {
  return (
    <ol className="flex items-center gap-1.5">
      {LIFECYCLE.map((s, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        const dotBase =
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold mono transition-colors";
        const dotCls = active
          ? "bg-[var(--red)] text-white"
          : done
            ? "bg-white/85 text-[var(--video-bg)]"
            : "bg-white/12 text-white/45";
        const labelCls = active ? "text-white" : "text-white/55";
        const barCls = done ? "bg-[var(--red)]" : "bg-white/15";
        return (
          <li
            key={s.key}
            className="flex items-center gap-1.5"
            aria-current={active ? "step" : undefined}
          >
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

/** 头部「本周之星」横跨 Hero 大卡。 */
function StarHero({
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
  const [liveVotes, setLiveVotes] = useState(demand.totalVotes);
  const reduce = useReducedMotion();

  const iconKey = trackIconKey(demand.category);
  const Icon = TRACK_ICON[iconKey] ?? Sparkle;
  const trackGrad = trackGradientVar(demand.category);

  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING}
      className="relative overflow-hidden rounded-[18px] text-white shadow-[var(--lift)]"
      style={{ background: "var(--video-grad)" }}
    >
      {/* 右上红圆装饰（信号红，低透明） */}
      <div
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[var(--red)] opacity-25 blur-[2px]"
        aria-hidden
      />
      <div className="relative grid gap-0 md:grid-cols-[1.05fr_.95fr]">
        {/* 左：文案 + 票数 + 阶段轨 + 投票 */}
        <div className="order-2 p-6 md:order-1 md:p-7">
          <div className="flex flex-wrap items-center gap-2">
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
            <h2 className="text-[23px] font-bold leading-[1.28] transition-colors group-hover:text-white/85">
              {demand.title}
            </h2>
          </Link>

          {pitch && (
            <div className="mt-3 flex gap-2 text-white/70">
              <Quotes size={16} weight="fill" className="mt-0.5 shrink-0 text-white/40" />
              <p className="line-clamp-2 max-w-[520px] text-[14px] leading-[1.65]">
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
              <motion.span
                key={liveVotes}
                initial={reduce ? false : { scale: 1.3 }}
                animate={{ scale: 1 }}
                transition={SPRING}
                className="mono text-[34px] font-extrabold leading-none tabular-nums"
              >
                {liveVotes}
              </motion.span>
              <span className="text-[13px] text-white/60">票</span>
              {demand.recentVotes > 0 && (
                <span
                  className="mono ml-1 inline-flex items-center gap-0.5 text-[11px] font-semibold text-[var(--ok)] brightness-125"
                  title="本周新增票数"
                >
                  <TrendUp size={12} weight="bold" />↑{demand.recentVotes}
                </span>
              )}
            </div>
            {demand.supporters.length > 0 && (
              <div className="flex items-center gap-2.5">
                <SupporterStack supporters={demand.supporters} total={demand.totalVotes} />
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
            <LifecycleTrack currentIndex={idx} />
          </div>

          {/* 领跑水位条 */}
          <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-white/12">
            <motion.div
              key={liveVotes}
              className="h-full rounded-full bg-[var(--red)]"
              initial={reduce ? false : { width: "92%" }}
              animate={{ width: "100%" }}
              transition={SPRING}
              aria-hidden
            />
          </div>

          {/* 底部：排期状态 + 演示入口 + 投票 */}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-2">
              <ScheduleHint status={demand.status} />
              <Link
                href={`/demands/${demand.id}`}
                className="inline-flex min-h-[44px] items-center gap-1.5 text-[13px] font-semibold text-white/90 transition-colors hover:text-white"
              >
                <PlayCircle size={16} weight="fill" className="text-[var(--red)]" />
                看演示介绍 · 这门课会教什么
                <ArrowRight size={14} weight="bold" />
              </Link>
            </div>
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

        {/* 右：赛道封面视觉（真实需求预告视频铺底 + 赛道渐变镶边 + 大主题图标） */}
        <div className="relative order-1 min-h-[160px] overflow-hidden md:order-2">
          {/* 需求预告视频作背景：赛道渐变作兜底底色 + 静帧 poster；reduce-motion 时只静帧不播放。 */}
          <AmbientVideo
            src="/videos/marketing/demand-course-teaser.mp4"
            poster={STAR_POSTER[iconKey]}
            gradient={trackGrad}
          />
          {/* 赛道渐变镶边层（半透明叠在视频上，保留赛道个性同时让视频透出）。 */}
          <div className="absolute inset-0 opacity-45 mix-blend-soft-light" style={{ background: trackGrad }} aria-hidden />
          <div
            className="absolute inset-0 bg-gradient-to-l from-transparent via-[var(--video-bg)]/10 to-[var(--video-bg)] md:bg-gradient-to-r"
            aria-hidden
          />
          <Icon
            size={200}
            weight="fill"
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white/22"
            aria-hidden
          />
          <span className="mono absolute bottom-4 right-5 inline-flex items-center gap-1.5 rounded-full bg-black/25 px-3 py-1.5 text-[11px] font-semibold text-white backdrop-blur-sm">
            <Icon size={13} weight="fill" />
            {demand.categoryLabel} 赛道
          </span>
        </div>
      </div>
    </motion.section>
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
    <div className="space-y-5">
      <StarHero demand={star} canVote={canVote} disabledReason={disabledReason} />

      {rest.length > 0 && (
        // 对齐规范（问题③）：items-stretch 让同行提案卡等高，卡内 flex-1 + mt-auto 底栏贴底对齐。
        <div className="stagger grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((d, i) => (
            <ProposalCard
              key={d.id}
              demand={d}
              rank={i + 2}
              topVotes={topVotes}
              canVote={canVote}
              disabledReason={disabledReason}
              index={Math.min(i, 8)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
