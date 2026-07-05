"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  UsersThree,
  CheckCircle,
  GraduationCap,
  Translate,
  Sparkle,
  Heart,
  Books,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { VoteButton } from "@/components/VoteButton";
import { useStudyRoom } from "./StudyRoomContext";

/* ============================================================
   第三幕 · 环顾房间（滚动 3-4 屏）
   镜头拉远见整个「学习工作室」的全貌：
     ① 课程赛道精选卡片墙（TrackWall）—— 替代原 CourseShelf 书架墙
        （问题⑧-3：书架已更新掉、放首页不好看，能力回归 /desk；这里改产品能力/赛道展示）。
     ② 邻座的桌 = 社区共创（举手投票剪影 + VoteButton teaser）。
     ③ 窗外潮汐 = 品牌收尾 + 订阅 CTA。

   深浅色（问题⑧-5）：场景底/墨阶/材质走 --scene-* —— 浅=晨光亮场、暗=夜航暗场，跟随系统。
   宽屏响应式（问题⑧-1）：内容列 max-w 阶梯 1080→lg:1200→xl:1320→2xl:1440，
     赛道卡在宽屏 3 列铺开、卡与字号随视口放大，消除中央窄条。

   降级：所有子块用 whileInView 淡入（reduce-motion 由 framer + globals 统一降级为直显）；
   VoteButton 自带降级。
   ============================================================ */

interface DemandTeaser {
  id: string;
  title: string;
  description: string | null;
  categoryLabel: string;
  totalVotes: number;
}

/** 赛道精选卡（server 用真实赛道 + 课程数派生，client 只渲染）。 */
export interface TrackCardData {
  key: string;
  label: string;
  blurb: string;
  people: string;
  gradient: string; // trackGradientVar() 结果，如 var(--track-ai)
  iconKey: string; // trackIconKey() 结果
  courseCount: number;
}

// iconKey → Phosphor 图标（不把图标本体耦合进 lib，组件层查表）。
const TRACK_ICONS: Record<string, Icon> = {
  ai: Sparkle,
  english: Translate,
  elder: Heart,
  life: GraduationCap,
  default: Books,
};

export function ActThree({
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

  // 统一入场包裹：沉浸态 whileInView 上浮，降级态直显。
  const reveal = (delay = 0) =>
    motionOk
      ? {
          initial: { opacity: 0, y: 20 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, margin: "-80px" },
          transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] as const, delay },
        }
      : {};

  return (
    <section
      aria-label="环顾房间"
      className="relative w-full overflow-hidden px-6 pb-24 pt-24 lg:px-10 lg:pb-32 lg:pt-32"
      style={{
        // 拉远：整个工作室在弱环境光下显形（比前两幕略亮，像开了一盏顶灯环顾四周）。
        background:
          "linear-gradient(180deg, var(--scene-bg-3) 0%, var(--scene-bg-2) 40%, var(--scene-bg-1) 100%)",
      }}
    >
      <div className="mx-auto flex max-w-[1080px] flex-col gap-20 lg:max-w-[1200px] lg:gap-28 xl:max-w-[1320px] 2xl:max-w-[1440px]">
        {/* —— ① 课程赛道精选卡片墙（替代原书架墙）—— */}
        <motion.div {...reveal(0)}>
          <div className="mb-6 flex items-end justify-between gap-4 lg:mb-9">
            <div>
              <p className="mono text-[11px] uppercase tracking-[0.2em] text-[var(--scene-ink-3)] lg:text-[12px]">
                THE TRACKS · 环顾四壁
              </p>
              <h2 className="mt-2 text-[22px] font-bold tracking-[-0.01em] text-[var(--scene-ink)] sm:text-[26px] lg:text-[38px] xl:text-[44px]">
                一整面墙,五条赛道任你选
              </h2>
              <p className="mt-2 max-w-[520px] text-[13px] leading-[1.7] text-[var(--scene-ink-2)] lg:mt-3 lg:max-w-[640px] lg:text-[16px]">
                从 AI 技能到英语口语,从银发生活到实用技能,每条赛道都有一排排真实的课。
                想学的没有?一句话让 AI 现场造一门。
              </p>
            </div>
            <Link
              href="/courses"
              className="group hidden shrink-0 items-center gap-1 text-[13px] font-semibold text-[var(--scene-ink-2)] transition-colors hover:text-[var(--red)] sm:inline-flex lg:text-[15px]"
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

          {/* 赛道卡墙：宽屏 3 列铺开，卡随视口放大。 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6 xl:gap-7">
            {tracks.map((t) => (
              <TrackCard key={t.key} track={t} />
            ))}
            {/* 收尾「造课」卡：把「想学的没有 → AI 造」做成同一墙上的一块，引导造课。 */}
            <Link
              href="/create"
              className="studio-lift group relative flex min-h-[168px] flex-col justify-between overflow-hidden rounded-[18px] border border-dashed p-5 lg:min-h-[220px] lg:rounded-[22px] lg:p-7"
              style={{
                borderColor: "color-mix(in srgb, var(--red) 34%, var(--scene-hairline))",
                background: "var(--scene-card-2)",
              }}
            >
              <div
                className="flex h-[42px] w-[42px] items-center justify-center rounded-[12px] lg:h-[52px] lg:w-[52px] lg:rounded-[14px]"
                style={{ background: "var(--red-soft)", color: "var(--red)" }}
              >
                <Sparkle size={22} weight="fill" className="lg:hidden" />
                <Sparkle size={27} weight="fill" className="hidden lg:block" />
              </div>
              <div>
                <h3 className="text-[17px] font-bold text-[var(--scene-ink)] lg:text-[21px]">
                  没有想学的赛道?
                </h3>
                <p className="mt-1 text-[13px] leading-[1.6] text-[var(--scene-ink-2)] lg:text-[15px]">
                  说出你想学的,AI 当场为你造一门。
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

          <Link
            href="/courses"
            className="mt-6 inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--red-ink)] sm:hidden"
          >
            浏览全部课程
            <ArrowRight size={14} weight="bold" aria-hidden />
          </Link>
        </motion.div>

        {/* —— ② 邻座的桌 = 社区共创（举手投票剪影 + VoteButton teaser）—— */}
        <motion.div {...reveal(0.05)}>
          <div
            className="relative overflow-hidden rounded-[18px] border p-6 sm:p-7 lg:rounded-[24px] lg:p-10"
            style={{
              borderColor: "var(--scene-hairline)",
              background: "var(--scene-card)",
              boxShadow: "var(--scene-card-shadow)",
            }}
          >
            {/* 邻座剪影：几枚「举手」头像剪影，暗示一屋子人一起共创 */}
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
              THE NEIGHBOURS · 邻座的桌
            </p>
            <h2 className="mt-2 text-[20px] font-bold tracking-[-0.01em] text-[var(--scene-ink)] lg:text-[30px]">
              下一门课,一屋子人一起点亮
            </h2>
            <p className="mt-2 max-w-[520px] text-[13px] leading-[1.7] text-[var(--scene-ink-2)] lg:mt-3 lg:max-w-[640px] lg:text-[16px]">
              你想学什么?举手投票,票高的需求进入平台排期,为你和邻座一起造出来。
            </p>

            {demand ? (
              <div
                className="mt-5 flex flex-wrap items-center gap-4 rounded-[14px] border p-4 lg:mt-7 lg:rounded-[16px] lg:p-5"
                style={{ borderColor: "var(--scene-hairline)", background: "var(--scene-card-2)" }}
              >
                <div className="min-w-0 flex-1">
                  <Link href={`/demands/${demand.id}`} className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold text-[var(--scene-ink)] hover:text-[var(--red)] lg:text-[16px]">
                      {demand.title}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--ok-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--ok)]">
                      <CheckCircle size={12} weight="fill" />
                      {demand.categoryLabel} · 已进入排期
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
                className="cta-glow studio-press mt-5 inline-flex items-center gap-1.5 rounded-[12px] bg-[var(--red)] px-4 py-2.5 text-[13px] font-bold text-white lg:mt-7 lg:text-[15px]"
              >
                <UsersThree size={14} weight="fill" />
                发起第一条共创需求
              </Link>
            )}

            <Link
              href="/demands"
              className="mono mt-4 inline-flex items-center gap-1.5 text-[11px] text-[var(--scene-ink-3)] transition-colors hover:text-[var(--red)] lg:mt-5 lg:text-[12px]"
            >
              <UsersThree size={13} />
              共{" "}
              <span className="font-bold text-[var(--scene-ink-2)]">{demandCount}</span> 条在征集 ·
              每周排期一次
            </Link>
          </div>
        </motion.div>

        {/* —— ③ 窗外潮汐 = 品牌收尾 + 订阅 CTA —— */}
        <motion.div {...reveal(0.1)}>
          <div
            className="relative overflow-hidden rounded-[20px] border p-8 text-center sm:p-12 lg:rounded-[28px] lg:p-16"
            style={{
              borderColor: "var(--scene-hairline)",
              background: "var(--scene-card)",
              boxShadow: "var(--scene-card-shadow)",
            }}
          >
            {/* 窗外潮汐光：底部一道横向暖冷渐变，像窗外将亮未亮的海平线 */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-40 lg:h-52"
              style={{
                background:
                  "linear-gradient(180deg, transparent, rgba(59,141,214,0.14) 60%, rgba(255,200,140,0.10))",
              }}
            />
            {/* 留给你的一盏灯：中央暖光晕 */}
            <div
              aria-hidden
              className={`pointer-events-none absolute left-1/2 top-6 h-40 w-40 -translate-x-1/2 rounded-full lg:h-52 lg:w-52 ${
                motionOk ? "lamp-breathe" : ""
              }`}
              style={{ background: "var(--scene-lamp)" }}
            />
            <p className="mono relative text-[11px] uppercase tracking-[0.2em] text-[var(--scene-ink-3)] lg:text-[12px]">
              THE WINDOW · 窗外潮汐
            </p>
            <h2 className="relative mt-3 text-[26px] font-bold leading-[1.3] tracking-[-0.01em] text-[var(--scene-ink)] sm:text-[34px] lg:text-[48px] xl:text-[56px]">
              这间工作室,
              <br className="sm:hidden" />
              为你留了一盏灯
            </h2>
            <p className="relative mx-auto mt-4 max-w-[440px] text-[14px] leading-[1.8] text-[var(--scene-ink-2)] lg:mt-6 lg:max-w-[600px] lg:text-[18px]">
              {yearPriceText ? (
                <>
                  年度会员 {yearPriceText},{totalCourses} 门课全部赛道畅学。停订后笔记与截帧永久保存,随时可取消。
                </>
              ) : (
                <>订阅制畅学全部赛道。停订后笔记与截帧永久保存,随时可取消。</>
              )}
            </p>
            <div className="relative mt-7 flex flex-wrap items-center justify-center gap-3 lg:mt-10 lg:gap-4">
              <Link
                href="/create"
                className="cta-glow studio-press inline-flex items-center gap-2 rounded-[13px] bg-[var(--red)] px-6 py-3 text-[14px] font-bold text-white transition-[filter] hover:brightness-105 lg:rounded-[16px] lg:px-8 lg:py-4 lg:text-[17px]"
              >
                坐下,造第一门课
                <ArrowRight size={15} weight="bold" aria-hidden />
              </Link>
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 rounded-[13px] border px-6 py-3 text-[14px] font-bold text-[var(--scene-ink)] backdrop-blur-sm transition-colors lg:rounded-[16px] lg:px-8 lg:py-4 lg:text-[17px]"
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

/** 单张赛道卡：赛道渐变封面条 + 主题图标 + 人群 + 课程数，点击去课程库该赛道。 */
function TrackCard({ track }: { track: TrackCardData }) {
  const TrackIcon = TRACK_ICONS[track.iconKey] ?? Books;
  return (
    <Link
      href={`/courses?category=${encodeURIComponent(track.key)}`}
      className="studio-lift group relative flex min-h-[168px] flex-col overflow-hidden rounded-[18px] border lg:min-h-[220px] lg:rounded-[22px]"
      style={{
        borderColor: "var(--scene-hairline)",
        background: "var(--scene-card)",
        boxShadow: "var(--scene-card-shadow-sm)",
      }}
    >
      {/* 顶部赛道渐变条 + 图标（课程封面视觉语言的浓缩） */}
      <div
        className="relative flex h-[72px] items-center justify-center lg:h-[92px]"
        style={{ background: track.gradient }}
      >
        <TrackIcon size={30} weight="fill" color="rgba(255,255,255,.92)" className="lg:hidden" />
        <TrackIcon
          size={38}
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
      <div className="flex flex-1 flex-col p-5 lg:p-6">
        <h3 className="text-[17px] font-bold text-[var(--scene-ink)] lg:text-[21px]">
          {track.label}
        </h3>
        <p className="mt-1 flex-1 text-[13px] leading-[1.6] text-[var(--scene-ink-2)] lg:mt-1.5 lg:text-[15px]">
          {track.blurb}
        </p>
        <div className="mono mt-3 flex items-center justify-between text-[11px] text-[var(--scene-ink-3)] lg:mt-4 lg:text-[12px]">
          <span>{track.people}</span>
          {track.courseCount > 0 && (
            <span className="shrink-0 font-semibold text-[var(--scene-ink-2)]">
              {track.courseCount} 门
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
