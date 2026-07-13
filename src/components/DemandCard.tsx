"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  Robot,
  Translate,
  GraduationCap,
  Heart,
  Sparkle,
  UsersThree,
  ChatCircle,
  TrendUp,
  Waves,
  CaretRight,
  ListChecks,
  ArrowRight,
  Flame,
  Fire,
} from "@phosphor-icons/react/dist/ssr";
import { VoteButton } from "./VoteButton";
import { DEMAND_STATUS } from "@/lib/format";
import { trackGradientVar, trackIconKey } from "@/lib/tracks";
import type { RankedDemandView } from "@/lib/queries";

/**
 * ProposalCard（原 DemandCard 重设计）:「待孵化的课程」众筹式提案卡。
 * 每张需求 = 一个课程提案：赛道渐变封面 + 主题图标、标题、一句话介绍、
 * 目标人群、票数/进度、生命周期阶段徽章、支持者头像堆叠、可展开的演示介绍、
 * 精致投票交互（复用 VoteButton，票数回调驱动进度条弹性增长）。
 *
 * 架构：本文件为 "use client"（持有展开态 + 乐观票数），只引 VoteButton(client)、
 * 纯 lib(tracks/format) 与类型，无 server 链。
 */

const SPRING = { type: "spring" as const, stiffness: 260, damping: 26 };

// 生命周期阶段轨（与详情页对齐）。
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

// 赛道 key → 封面主题图标（在客户端按 trackIconKey 的纯字符串结果取本体）。
const TRACK_ICON: Record<string, typeof Robot> = {
  ai: Robot,
  english: Translate,
  elder: GraduationCap,
  life: Heart,
  default: Sparkle,
};

// 目标人群速查（无对应则不显示，避免编造）。
const TRACK_AUDIENCE: Record<string, string> = {
  ai_skill: "职场人 / 自媒体",
  english_oral: "想开口交流的学习者",
  english_foundation: "有基础 / 备考人群",
  silver_english: "50+ 长辈学员",
  life: "35–65 岁通用",
};

/** 阶段徽章：collecting/evaluating 用中性，scheduled/producing 点亮品牌红，launched 用暖金。 */
function StageBadge({ status }: { status: string }) {
  const label = DEMAND_STATUS[status]?.label ?? status;
  const hot = status === "scheduled" || status === "producing";
  const live = status === "launched";
  const cls = live
    ? "border-[var(--border)] bg-[var(--new-bg)] text-[var(--new-ink)]"
    : hot
      ? "border-[var(--red-soft-border)] bg-[var(--red-soft)] text-[var(--red-ink)]"
      : "border-[var(--border)] bg-[var(--surface-inset)] text-[var(--ink3)]";
  return (
    <span
      className={`mono inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${cls}`}
    >
      {(hot || live) && (
        <span
          className={`h-1.5 w-1.5 rounded-full ${live ? "bg-[var(--new-ink)]" : "bg-[var(--red)]"}`}
          aria-hidden
        />
      )}
      {label}
    </span>
  );
}

/** 支持者头像堆叠：前 5 个圆头像叠放，多余显示 +N。 */
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
            className="inline-flex h-6 w-6 items-center justify-center overflow-hidden rounded-full ring-2 ring-[var(--surface)]"
          >
            {u.avatarUrl ? (

              <img
                src={u.avatarUrl}
                alt=""
                width={24}
                height={24}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : (
              <span
                className="flex h-full w-full items-center justify-center bg-[var(--surface-inset)] text-[10px] font-semibold text-[var(--ink2)]"
                aria-hidden
              >
                {u.nickname.charAt(0) || "?"}
              </span>
            )}
          </span>
        ))}
      </div>
      {extra > 0 && (
        <span className="mono ml-2 text-[11px] text-[var(--ink4)]">+{extra}</span>
      )}
    </div>
  );
}

/** 演示预告：从描述里拆出「课程会教什么」的要点，营造「带演示」的详情感。 */
function demoPoints(description: string | null): string[] {
  if (!description) return [];
  // 描述里若含分句/分点符号，拆成大纲预览；否则整段作为一条。
  const parts = description
    .split(/[·•\n；;。]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
  return parts.slice(0, 3);
}

export function ProposalCard({
  demand,
  rank,
  topVotes,
  canVote,
  disabledReason,
  index = 0,
}: {
  demand: RankedDemandView;
  rank: number;
  topVotes: number;
  canVote: boolean;
  disabledReason?: string;
  /** 进场 stagger 序号（CSS --i 递延）。 */
  index?: number;
}) {
  const [liveVotes, setLiveVotes] = useState(demand.totalVotes);
  const [voted, setVoted] = useState(false);
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();

  const iconKey = trackIconKey(demand.category);
  const Icon = TRACK_ICON[iconKey] ?? Sparkle;
  const gradient = trackGradientVar(demand.category);
  const audience = TRACK_AUDIENCE[demand.category];
  const idx = lifecycleIndex(demand.status);
  const pitch = demand.description?.trim();
  const points = demoPoints(demand.description);
  // 点燃进度：以本榜领跑票数为 100% 参照（不引入未知阈值字段，沿用 topVotes 契约）。
  const pct = Math.max(6, Math.min(100, Math.round((liveVotes / topVotes) * 100)));
  // 距领跑还差多少「火力」——众筹造课的追赶目标，给出可感的下一步。
  const gapToLead = Math.max(0, topVotes - liveVotes);
  const isLeader = gapToLead === 0;
  const barTransition = voted ? SPRING : { ...SPRING, delay: 0.12 };
  const barInitial = reduce ? false : { width: 0 };
  // 已上线的提案不再强调「点燃」，收敛为成果态。
  const launched = demand.status === "launched";

  return (
    <article
      style={{ ["--i" as string]: index }}
      className="group relative flex flex-col overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card)] transition-[transform,box-shadow,border-color] duration-[var(--dur-fast)] [transition-timing-function:var(--ease-out-expo)] hover:-translate-y-1 hover:border-[var(--border2)] hover:shadow-[var(--card-hover)]"
    >
      {/* 课程封面：赛道渐变 + 主题图标水印 + 赛道徽章 + 排名章 + 「众筹造课」身份条。
          材质：顶部内高光 hairline + 底部压暗渐变，让白字与身份条稳稳可读（STUDIO 规格）。 */}
      <div
        className="hover-sheen relative h-[108px] overflow-hidden"
        style={{ background: gradient }}
      >
        {/* 大主题图标水印 */}
        <Icon
          size={112}
          weight="fill"
          className="pointer-events-none absolute -right-4 -top-3 text-white/15"
          aria-hidden
        />
        {/* 顶部内高光，增加材质 */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[var(--hairline-on-dark)]"
          aria-hidden
        />
        {/* 底部压暗渐变，托住身份条 */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/35 to-transparent"
          aria-hidden
        />
        <div className="relative flex h-full flex-col justify-between p-3.5">
          <div className="flex items-start justify-between gap-2">
            <span className="mono inline-flex items-center gap-1.5 rounded-full bg-black/20 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
              <Icon size={13} weight="fill" />
              {demand.categoryLabel}
            </span>
            {/* 排名章：前三名点亮暖金奖牌感，其余保持中性白（榜单纵深，不喧宾夺主） */}
            <span
              className={`mono inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold backdrop-blur-sm ${
                rank <= 3
                  ? "bg-[var(--new-bg)] text-[var(--new-ink)] ring-1 ring-white/25"
                  : "bg-white/15 text-white"
              }`}
              title={`当前排名第 ${rank}`}
            >
              {rank <= 3 && <Flame size={11} weight="fill" />}#{String(rank).padStart(2, "0")}
            </span>
          </div>
          {/* 身份条：众筹造课语义（点燃孵化），与 VoteButton 的火种隐喻一致 */}
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-white/90">
            <Fire size={14} weight="fill" className="text-white/80" />
            {launched ? "已点燃成课 · 立即开学" : "众筹造课 · 投票点燃孵化"}
          </div>
        </div>
      </div>

      {/* 卡身 */}
      <div className="flex flex-1 flex-col p-4">
        <div className="mb-2 flex items-start justify-between gap-2">
          <Link href={`/demands/${demand.id}`} className="group/title min-w-0 flex-1">
            <h3 className="line-clamp-2 text-[15px] font-bold leading-[1.35] text-[var(--ink)] transition-colors group-hover/title:text-[var(--red-ink)]">
              {demand.title}
            </h3>
          </Link>
          <StageBadge status={demand.status} />
        </div>

        {/* 一句话介绍 */}
        {pitch && (
          <p className="mb-2.5 line-clamp-2 text-[13px] leading-[1.6] text-[var(--ink3)]">
            {pitch}
          </p>
        )}

        {/* 目标人群 + 发起人：一行速览「面向谁 · 谁发起」，克制内嵌 surface-inset 胶囊 */}
        {(audience || demand.authorNickname) && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {audience && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-inset)] px-2.5 py-1 text-[11.5px] text-[var(--ink2)]">
                <UsersThree size={13} weight="fill" className="text-[var(--ink4)]" />
                面向 {audience}
              </span>
            )}
            {demand.authorNickname && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-inset)] px-2.5 py-1 text-[11.5px] text-[var(--ink3)]">
                <Sparkle size={12} weight="fill" className="text-[var(--ink4)]" />
                {demand.authorNickname} 发起
              </span>
            )}
          </div>
        )}

        {/* 点燃进度面板（众筹造课仪式感）：火力值 + 本周新增 + 距领跑目标 + 点燃进度条。
            与 VoteButton 的「火种 / 火力值」隐喻一致：票数 = 火力值，进度 = 距领跑的点燃度。 */}
        <div className="mb-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface2)] p-3">
          <div className="mb-2 flex items-end justify-between gap-2">
            <span className="flex items-baseline gap-1">
              <Flame size={16} weight="fill" className="translate-y-[1px] text-[var(--red)]" aria-hidden />
              <motion.span
                key={liveVotes}
                initial={reduce ? false : { scale: 1.2 }}
                animate={{ scale: 1 }}
                transition={SPRING}
                className="mono text-[21px] font-extrabold leading-none text-[var(--ink)] tabular-nums"
              >
                {liveVotes}
              </motion.span>
              <span className="text-[12px] text-[var(--ink4)]">火力值</span>
              {demand.recentVotes > 0 && (
                <span
                  className="mono ml-1 inline-flex items-center gap-0.5 text-[11px] font-semibold text-[var(--ok)]"
                  title="本周新增火力"
                >
                  <TrendUp size={11} weight="bold" />↑{demand.recentVotes}
                </span>
              )}
            </span>
            {/* 距领跑目标：给出可感的下一步；领跑者显「领跑本榜」荣誉 */}
            <span className="mono shrink-0 text-right text-[11px] leading-tight text-[var(--ink4)]">
              {launched ? (
                <span className="font-semibold text-[var(--new-ink)]">已成课</span>
              ) : isLeader ? (
                <span className="inline-flex items-center gap-0.5 font-semibold text-[var(--red-ink)]">
                  <Fire size={11} weight="fill" />领跑本榜
                </span>
              ) : (
                <>
                  距领跑还差
                  <br />
                  <span className="font-bold text-[var(--ink2)]">{gapToLead}</span> 火力
                </>
              )}
            </span>
          </div>
          {/* 点燃进度条：火色渐变填充 + 火苗头标记（活跃火力的视觉锚点）。 */}
          <div className="relative h-2 overflow-hidden rounded-full bg-[var(--surface-inset)] shadow-[var(--inner-hi)]">
            <motion.div
              className="relative h-full rounded-full bg-gradient-to-r from-[var(--red-active)] to-[var(--red)]"
              initial={barInitial}
              animate={{ width: `${pct}%` }}
              transition={barTransition}
              aria-hidden
            >
              {/* 火苗头：进度条前沿的一点暖光，暗示「火正在烧」（reduce-motion 下为静态亮点） */}
              <span
                className="vote-ember absolute right-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2 translate-x-1/4 rounded-full bg-white/85 shadow-[0_0_6px_2px_var(--red)]"
                aria-hidden
              />
            </motion.div>
          </div>
          {/* 进度尾注：阶段 + 点燃百分比，给进度一个语义落点 */}
          <div className="mono mt-1.5 flex items-center justify-between text-[10.5px] text-[var(--ink4)]">
            <span>
              {LIFECYCLE[idx]?.label} · {idx + 1}/{LIFECYCLE.length}
            </span>
            <span>已点燃 {pct}%</span>
          </div>
        </div>

        {/* 社交信号：支持者堆叠 + 讨论 + 关注 */}
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {demand.supporters.length > 0 && (
            <SupporterStack supporters={demand.supporters} total={demand.totalVotes} />
          )}
          {demand.commentCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[12px] text-[var(--ink3)]">
              <ChatCircle size={13} weight="fill" className="text-[var(--ink4)]" />
              {demand.commentCount}
            </span>
          )}
          {demand.followerCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[12px] text-[var(--ink3)]">
              <Waves size={13} weight="fill" className="text-[var(--ink4)]" />
              {demand.followerCount}
            </span>
          )}
        </div>

        {/* 演示介绍：可展开的「这门课会教什么」预告 */}
        {(points.length > 0 || pitch) && (
          <div className="mb-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface2)]">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3 text-[12.5px] font-semibold text-[var(--ink2)] transition-colors hover:text-[var(--ink)]"
            >
              <span className="inline-flex items-center gap-1.5">
                <ListChecks size={15} weight="bold" className="text-[var(--red)]" />
                看演示 · 这门课会教什么
              </span>
              <CaretRight
                size={14}
                weight="bold"
                className={`shrink-0 text-[var(--ink4)] transition-transform duration-[var(--dur-fast)] [transition-timing-function:var(--ease-out-expo)] ${
                  open ? "rotate-90" : ""
                }`}
              />
            </button>
            {open && (
              <div className="border-t border-[var(--border)] px-3 py-2.5">
                {points.length > 0 ? (
                  <ul className="space-y-1.5">
                    {points.map((p, i) => (
                      <li
                        key={i}
                        className="flex gap-2 text-[12.5px] leading-[1.55] text-[var(--ink2)]"
                      >
                        <span
                          className="mono mt-[1px] inline-flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full bg-[var(--red-soft)] text-[10px] font-bold text-[var(--red-ink)]"
                          aria-hidden
                        >
                          {i + 1}
                        </span>
                        <span className="line-clamp-2">{p}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12.5px] leading-[1.6] text-[var(--ink2)]">{pitch}</p>
                )}
                <Link
                  href={`/demands/${demand.id}`}
                  className="mt-2.5 inline-flex min-h-[44px] items-center gap-1 text-[12.5px] font-semibold text-[var(--red-ink)] hover:underline"
                >
                  查看完整介绍与大纲预览
                  <ArrowRight size={13} weight="bold" />
                </Link>
              </div>
            )}
          </div>
        )}

        {/* 底部动作：查看详情 + 投票 */}
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
          <Link
            href={`/demands/${demand.id}`}
            className="inline-flex min-h-[44px] items-center gap-1 text-[13px] font-semibold text-[var(--ink3)] transition-colors hover:text-[var(--red-ink)]"
          >
            看详情
            <ArrowRight
              size={14}
              weight="bold"
              className="transition-transform duration-[var(--dur-fast)] group-hover:translate-x-0.5"
            />
          </Link>
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

        {demand.status === "launched" && demand.launchedCourseId && (
          <Link
            href={`/courses/${demand.launchedCourseId}`}
            className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--red-ink)] hover:underline"
          >
            该需求已上线 → 查看课程
            <ArrowRight size={12} weight="bold" />
          </Link>
        )}
      </div>
    </article>
  );
}
