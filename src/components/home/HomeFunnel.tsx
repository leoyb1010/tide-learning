"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  UsersThree,
  GraduationCap,
  Translate,
  Sparkle,
  Heart,
  Books,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { VoteButton } from "@/components/VoteButton";
import type { TrackCardData } from "./types";
import { useStudyRoom } from "./StudyRoomContext";

/* ============================================================
   HomeFunnel —— 首页「下半区」转化漏斗（三幕沉浸之后的落地编排）
   ------------------------------------------------------------
   问题⑩：上半三幕沉浸叙事已完成，下半原本平铺三块（赛道网格 / 共创卡 / 订阅卡）
   等重、无主次、无节奏。这里重新编排为一条「有节奏、有主次」的转化漏斗：

     Beat 1 · 精选赛道（探索 · 中量级）—— 先挑一条赛道，或一句话造一门
     Beat 2 · 社区共创（参与 · 轻量级、偏置）—— 想学的还没有？一屋子人帮你点亮
     Beat 3 · 订阅转化（决定 · 最重 · 高潮）—— 坐下开始学 / 造第一门课

   主次：视觉重量 Beat1 → Beat2 → Beat3 递增，Beat3 为全场唯一「主 CTA 高潮」。
   CTA 主线：造课 / 开始学习 贯穿三拍（每拍都能进入下一步，最终收束到订阅）。

   与三幕衔接（问题⑩-2）：本区不另起炉灶，延续三幕的冷灰蓝材质与光影语言，
   底色从 --scene-bg-1（三幕收尾落点的最亮调）起，向订阅高潮微暖过渡，
   全程复用 --scene-* token，避免「上面高级、下面突然变普通」的断层。

   内容取舍（问题⑩-3）：三大能力（边学边记/到点复习/AI 伴侣）已在第二幕讲透，
   本区不复述能力，只聚焦「精选赛道 + 社区共创 + 订阅转化」这条漏斗。

   架构：纯 client（"use client" + framer-motion），真实数据由 server page 经
   ImmersiveStudyRoom props 传入，本组件只渲染，不触任何 server 链。
   动效（问题⑩-4）：whileInView stagger 进场 + hover 反馈，克制不喧宾夺主；
   reduce-motion 经 framer + globals 统一降级为直显。触达区 ≥44px。
   ============================================================ */

interface DemandTeaser {
  id: string;
  title: string;
  description: string | null;
  categoryLabel: string;
  totalVotes: number;
}

// iconKey → Phosphor 图标（与 ActThree TrackCard 同族，避免把图标耦合进 lib）。
const TRACK_ICONS: Record<string, Icon> = {
  ai: Sparkle,
  english: Translate,
  elder: Heart,
  life: GraduationCap,
  default: Books,
};

export function HomeFunnel({
  tracks,
  totalCourses,
  demand,
  demandCount,
  canVote,
  yearPriceText,
}: {
  tracks: TrackCardData[];
  totalCourses: number;
  demand: DemandTeaser | null;
  demandCount: number;
  canVote: boolean;
  yearPriceText: string | null;
}) {
  const { motionOk } = useStudyRoom();

  // 统一入场包裹：沉浸态 whileInView 上浮，降级态直显（framer + globals 双保险）。
  const reveal = (delay = 0) =>
    motionOk
      ? {
          initial: { opacity: 0, y: 22 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, margin: "-80px" },
          transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] as const, delay },
        }
      : {};

  // 精选赛道：只取前 3 条作 curated selection（不平铺全量，全量在 /courses）。
  // 让本区是「先挑一条」的探索入口，而非又一面赛道墙。
  const featured = tracks.slice(0, 3);

  return (
    <section
      aria-label="开始学习"
      className="relative w-full overflow-hidden px-6 pb-28 pt-20 lg:px-10 lg:pb-40 lg:pt-28"
      style={{
        // 与三幕衔接：从三幕收尾落点的最亮调 --scene-bg-1 起，向订阅高潮微暖压柔，
        // 材质连续、不断层。收尾底部再压一层 --scene-bg-2 托住订阅高潮。
        background:
          "linear-gradient(180deg, var(--scene-bg-1) 0%, var(--scene-bg-1) 44%, var(--scene-bg-2) 100%)",
      }}
    >
      {/* 与上方三幕的接缝：一道极淡的 hairline 分隔线 + 顶部渐隐，视觉上「换一口气」进入转化区 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: "var(--scene-hairline)" }}
      />

      <div className="mx-auto flex max-w-[1080px] flex-col gap-16 lg:max-w-[1200px] lg:gap-24 xl:max-w-[1320px] 2xl:max-w-[1440px]">
        {/* ============================================================
            Beat 1 · 精选赛道（探索 · 中量级）
            一句话主张 + 支撑，标题层级清晰。curated 3 条 + 造课逃逸口。
            ============================================================ */}
        <motion.div {...reveal(0)}>
          <div className="mb-6 flex items-end justify-between gap-4 lg:mb-10">
            <div>
              <p className="mono text-[11px] uppercase tracking-[0.2em] text-[var(--scene-ink-3)] lg:text-[12px]">
                01 · 先挑一条赛道
              </p>
              <h2 className="mt-2 text-[24px] font-bold leading-[1.2] tracking-[-0.01em] text-[var(--scene-ink)] sm:text-[28px] lg:text-[40px] xl:text-[46px]">
                想学什么，从这里开始
              </h2>
              <p className="mt-2 max-w-[520px] text-[13px] leading-[1.7] text-[var(--scene-ink-2)] lg:mt-3 lg:max-w-[640px] lg:text-[16px]">
                真实在架的赛道，一排排等着你。挑一条进去，或者
                <span className="font-semibold text-[var(--scene-ink)]"> 一句话让 AI 现场为你造一门</span>。
              </p>
            </div>
            {/* 桌面：赛道区 CTA 主线之一「浏览全部」，触达≥44px */}
            <Link
              href="/courses"
              className="group hidden shrink-0 items-center gap-1 px-2 py-2 text-[13px] font-semibold text-[var(--scene-ink-2)] transition-colors hover:text-[var(--red)] sm:inline-flex lg:text-[15px]"
            >
              浏览全部课程
              <ArrowRight
                size={14}
                weight="bold"
                aria-hidden
                className="transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          </div>

          {/* curated 赛道卡：3 条精选 + 1 张造课卡，四格一行铺开（宽屏 4 列） */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
            {featured.map((t) => (
              <FunnelTrackCard key={t.key} track={t} />
            ))}
            {/* 造课卡：把「想学的没有 → AI 造」做进赛道行内，CTA 主线贯穿本拍 */}
            <Link
              href="/create"
              className="studio-lift group relative flex min-h-[168px] flex-col justify-between overflow-hidden rounded-[18px] border border-dashed p-5 lg:min-h-[212px] lg:rounded-[22px] lg:p-6"
              style={{
                borderColor: "color-mix(in srgb, var(--red) 34%, var(--scene-hairline))",
                background: "var(--scene-card-2)",
              }}
            >
              <div
                className="flex h-[42px] w-[42px] items-center justify-center rounded-[12px] lg:h-[50px] lg:w-[50px] lg:rounded-[14px]"
                style={{ background: "var(--red-soft)", color: "var(--red)" }}
              >
                <Sparkle size={22} weight="fill" className="lg:hidden" />
                <Sparkle size={26} weight="fill" className="hidden lg:block" />
              </div>
              <div>
                <h3 className="text-[17px] font-bold text-[var(--scene-ink)] lg:text-[20px]">
                  没有想学的？
                </h3>
                <p className="mt-1 text-[13px] leading-[1.6] text-[var(--scene-ink-2)] lg:text-[15px]">
                  说出来，AI 当场造一门。
                </p>
                <span className="mt-3 inline-flex items-center gap-1 text-[12px] font-bold text-[var(--red-ink)] lg:text-[14px]">
                  去造一门课
                  <ArrowRight
                    size={13}
                    weight="bold"
                    aria-hidden
                    className="transition-transform group-hover:translate-x-0.5"
                  />
                </span>
              </div>
            </Link>
          </div>

          {/* 移动端：赛道区 CTA 主线（桌面在标题右侧，移动折到卡下），触达≥44px */}
          <Link
            href="/courses"
            className="mt-5 inline-flex min-h-[44px] items-center gap-1 text-[13px] font-semibold text-[var(--red-ink)] sm:hidden"
          >
            浏览全部课程
            <ArrowRight size={14} weight="bold" aria-hidden />
          </Link>
        </motion.div>

        {/* ============================================================
            Beat 2 · 社区共创（参与 · 轻量级、偏置）
            刻意窄一档、不与订阅高潮争重量。真实需求 + VoteButton teaser。
            ============================================================ */}
        <motion.div {...reveal(0.05)} className="lg:mx-auto lg:max-w-[920px]">
          <div
            className="relative overflow-hidden rounded-[18px] border p-6 sm:p-7 lg:rounded-[24px] lg:p-9"
            style={{
              borderColor: "var(--scene-hairline)",
              background: "var(--scene-card)",
              boxShadow: "var(--scene-card-shadow)",
            }}
          >
            {/* 邻座剪影：几枚「举手」头像剪影，暗示一屋子人一起共创（装饰，aria-hidden） */}
            <div
              aria-hidden
              className="pointer-events-none absolute right-4 top-4 flex -space-x-2 opacity-60 lg:right-6 lg:top-6"
            >
              {[0, 1, 2, 3].map((n) => (
                <span
                  key={n}
                  className="h-7 w-7 rounded-full border lg:h-9 lg:w-9"
                  style={{
                    borderColor: "var(--scene-hairline)",
                    background: `linear-gradient(140deg, color-mix(in srgb, var(--scene-ink) ${
                      14 - n * 2
                    }%, transparent), transparent)`,
                  }}
                />
              ))}
            </div>
            <p className="mono text-[11px] uppercase tracking-[0.2em] text-[var(--scene-ink-3)] lg:text-[12px]">
              02 · 一屋子人帮你点亮
            </p>
            <h2 className="mt-2 text-[20px] font-bold tracking-[-0.01em] text-[var(--scene-ink)] lg:text-[28px]">
              想学的还没有？举手投票，一起点亮
            </h2>
            <p className="mt-2 max-w-[520px] text-[13px] leading-[1.7] text-[var(--scene-ink-2)] lg:mt-3 lg:max-w-[600px] lg:text-[15px]">
              票高的需求进入平台排期，为你和邻座一起造出来。每周排期一次。
            </p>

            {demand ? (
              <div
                className="mt-5 flex flex-wrap items-center gap-4 rounded-[14px] border p-4 lg:mt-6 lg:rounded-[16px] lg:p-5"
                style={{ borderColor: "var(--scene-hairline)", background: "var(--scene-card-2)" }}
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/demands/${demand.id}`}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span className="text-[14px] font-semibold text-[var(--scene-ink)] transition-colors hover:text-[var(--red)] lg:text-[16px]">
                      {demand.title}
                    </span>
                    {/* teaser 数据仅含 {categoryLabel,totalVotes}，不含真实排期 status
                        （getHomeDemandTeaser 未透传 status，此处无从判断阶段），
                        故不再硬编码「已进入排期」误导，改用可从现有字段确证的事实：
                        这是当前呼声最高的一条需求。 */}
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--red-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--red)]">
                      <UsersThree size={12} weight="fill" />
                      {demand.categoryLabel} · 呼声最高
                    </span>
                  </Link>
                  {demand.description && (
                    <p className="mt-1 line-clamp-1 text-[13px] text-[var(--scene-ink-3)] lg:text-[14px]">
                      {demand.description}
                    </p>
                  )}
                </div>
                <div className="shrink-0">
                  {/* VoteButton teaser：真实投票组件（自带 client 动效 + reduce-motion 降级）。 */}
                  <VoteButton
                    demandId={demand.id}
                    initialVotes={demand.totalVotes}
                    canVote={canVote}
                    disabledReason={canVote ? undefined : "订阅后可举手投票"}
                  />
                </div>
              </div>
            ) : (
              <Link
                href="/demands"
                className="cta-glow studio-press mt-5 inline-flex min-h-[44px] items-center gap-1.5 rounded-[12px] bg-[var(--red)] px-4 py-2.5 text-[13px] font-bold text-white lg:mt-6 lg:text-[15px]"
              >
                <UsersThree size={14} weight="fill" />
                发起第一条共创需求
              </Link>
            )}

            <Link
              href="/demands"
              className="mono mt-4 inline-flex min-h-[44px] items-center gap-1.5 text-[11px] text-[var(--scene-ink-3)] transition-colors hover:text-[var(--red)] lg:mt-5 lg:text-[12px]"
            >
              <UsersThree size={13} />共{" "}
              <span className="font-bold text-[var(--scene-ink-2)]">{demandCount}</span> 条在征集 ·
              查看需求广场
            </Link>
          </div>
        </motion.div>

        {/* ============================================================
            Beat 3 · 订阅转化（决定 · 最重 · 全场唯一高潮）
            全宽居中、光晕最强、主 CTA 最大：造第一门课（主）+ 查看方案（次）。
            ============================================================ */}
        <motion.div {...reveal(0.1)}>
          <div
            className="relative overflow-hidden rounded-[22px] border p-8 text-center sm:p-12 lg:rounded-[30px] lg:p-16"
            style={{
              borderColor: "var(--scene-hairline)",
              background: "var(--scene-card)",
              boxShadow: "var(--scene-card-shadow)",
            }}
          >
            {/* 窗外潮汐光：底部一道横向暖冷渐变，像窗外将亮未亮的海平线（延续三幕光影语言） */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-40 lg:h-56"
              style={{
                background:
                  "linear-gradient(180deg, transparent, rgba(59,141,214,0.14) 60%, rgba(255,200,140,0.10))",
              }}
            />
            {/* 留给你的一盏灯：中央暖光晕（呼吸动效，reduce-motion 降级为静态） */}
            <div
              aria-hidden
              className={`pointer-events-none absolute left-1/2 top-4 h-44 w-44 -translate-x-1/2 rounded-full lg:h-60 lg:w-60 ${
                motionOk ? "lamp-breathe" : ""
              }`}
              style={{ background: "var(--scene-lamp)" }}
            />
            <p className="mono relative text-[11px] uppercase tracking-[0.2em] text-[var(--scene-ink-3)] lg:text-[12px]">
              03 · 坐下，开始学
            </p>
            <h2 className="relative mt-3 text-[27px] font-bold leading-[1.25] tracking-[-0.01em] text-[var(--scene-ink)] sm:text-[36px] lg:text-[52px] xl:text-[60px]">
              这间工作室，
              <br className="sm:hidden" />
              为你留了一盏灯
            </h2>
            <p className="relative mx-auto mt-4 max-w-[460px] text-[14px] leading-[1.8] text-[var(--scene-ink-2)] lg:mt-6 lg:max-w-[620px] lg:text-[18px]">
              {yearPriceText ? (
                <>
                  年度会员 {yearPriceText}，{totalCourses}{" "}
                  门课全部赛道畅学。停订后笔记与截帧永久保存，随时可取消。
                </>
              ) : (
                <>订阅制畅学全部赛道。停订后笔记与截帧永久保存，随时可取消。</>
              )}
            </p>
            {/* 主 CTA 高潮：造课（主，最大最亮）+ 查看方案（次）。触达≥44px */}
            <div className="relative mt-7 flex flex-wrap items-center justify-center gap-3 lg:mt-10 lg:gap-4">
              <Link
                href="/create"
                className="cta-glow studio-press inline-flex min-h-[48px] items-center gap-2 rounded-[14px] bg-[var(--red)] px-6 py-3 text-[15px] font-bold text-white transition-[filter] hover:brightness-105 lg:rounded-[16px] lg:px-9 lg:py-4 lg:text-[18px]"
              >
                坐下，造第一门课
                <ArrowRight size={16} weight="bold" aria-hidden />
              </Link>
              <Link
                href="/pricing"
                className="inline-flex min-h-[48px] items-center gap-2 rounded-[14px] border px-6 py-3 text-[15px] font-bold text-[var(--scene-ink)] backdrop-blur-sm transition-colors hover:border-[var(--red)] lg:rounded-[16px] lg:px-8 lg:py-4 lg:text-[18px]"
                style={{ borderColor: "var(--scene-hairline)", background: "var(--scene-card-2)" }}
              >
                查看方案
              </Link>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------
   FunnelTrackCard —— 精选赛道卡（Beat 1 内用）
   与 ActThree TrackCard 视觉同族，但更紧凑（漏斗探索入口，不是赛道墙）：
   顶部赛道渐变条 + 图标 → 标题 + 人群。点击进课程库该赛道。
   ------------------------------------------------------------ */
function FunnelTrackCard({ track }: { track: TrackCardData }) {
  const TrackIcon = TRACK_ICONS[track.iconKey] ?? Books;
  return (
    <Link
      href={`/courses?category=${encodeURIComponent(track.key)}`}
      className="studio-lift group relative flex min-h-[168px] flex-col overflow-hidden rounded-[18px] border lg:min-h-[212px] lg:rounded-[22px]"
      style={{
        borderColor: "var(--scene-hairline)",
        background: "var(--scene-card)",
        boxShadow: "var(--scene-card-shadow-sm)",
      }}
    >
      {/* 顶部赛道渐变条 + 图标（课程封面视觉语言的浓缩） */}
      <div
        className="relative flex h-[66px] items-center justify-center lg:h-[84px]"
        style={{ background: track.gradient }}
      >
        <TrackIcon size={28} weight="fill" color="rgba(255,255,255,.92)" className="lg:hidden" />
        <TrackIcon
          size={34}
          weight="fill"
          color="rgba(255,255,255,.92)"
          className="hidden lg:block"
        />
        {/* 顶条内高光，增材质 */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: "linear-gradient(160deg, rgba(255,255,255,.18), transparent 44%)" }}
        />
      </div>
      {/* 卡信息 */}
      <div className="flex flex-1 flex-col p-4 lg:p-5">
        <h3 className="text-[16px] font-bold text-[var(--scene-ink)] lg:text-[19px]">
          {track.label}
        </h3>
        <p className="mt-1 flex-1 text-[12px] leading-[1.6] text-[var(--scene-ink-2)] lg:mt-1.5 lg:text-[14px]">
          {track.blurb}
        </p>
        <div className="mono mt-3 flex items-center justify-between text-[11px] text-[var(--scene-ink-3)] lg:mt-3.5">
          <span className="truncate">{track.people}</span>
          {track.courseCount > 0 && (
            <span className="shrink-0 pl-2 font-semibold text-[var(--scene-ink-2)]">
              {track.courseCount} 门
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
