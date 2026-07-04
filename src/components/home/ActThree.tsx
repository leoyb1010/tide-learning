"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, UsersThree, CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { CourseShelf } from "@/components/CourseShelf";
import { VoteButton } from "@/components/VoteButton";
import type { CourseCardData } from "@/components/CourseCard";
import { useStudyRoom } from "./StudyRoomContext";

/* ============================================================
   第三幕 · 环顾房间（滚动 3-4 屏）
   镜头拉远见整面书架墙 = 课程赛道（复用 CourseShelf 3D 书脊，点击去赛道）。
   邻座的桌 = 社区共创（举手投票剪影 + VoteButton teaser）。
   窗外潮汐 = 品牌收尾 + 订阅 CTA：「这间自习室，为你留了一盏灯」。

   降级：所有子块用 whileInView 淡入（reduce-motion 由 framer + globals 统一
   降级为直显）；CourseShelf 自带 reduce-motion 静态书架；VoteButton 自带降级。
   ============================================================ */

interface DemandTeaser {
  id: string;
  title: string;
  description: string | null;
  categoryLabel: string;
  totalVotes: number;
}

export function ActThree({
  courses,
  demand,
  demandCount,
  canVote,
  yearPriceText,
}: {
  courses: CourseCardData[];
  demand: DemandTeaser | null;
  demandCount: number;
  canVote: boolean;
  yearPriceText: string | null;
}) {
  const { motionOk } = useStudyRoom();

  // 统一的入场包裹：沉浸态 whileInView 上浮，降级态直显。
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
      className="relative w-full overflow-hidden px-6 pb-24 pt-24"
      style={{
        // 拉远：房间整体在弱环境光下显形（比前两幕略亮，像开了一盏顶灯环顾四周）
        background: "linear-gradient(180deg, #0e131c 0%, #12171f 40%, #161c26 100%)",
      }}
    >
      <div className="mx-auto flex max-w-[1080px] flex-col gap-20">
        {/* —— 书架墙 = 课程赛道 —— */}
        <motion.div {...reveal(0)}>
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <p className="mono text-[11px] uppercase tracking-[0.2em] text-[var(--ink-on-dark-3)]">
                THE SHELVES · 环顾四壁
              </p>
              <h2 className="mt-2 text-[22px] font-bold tracking-[-0.01em] text-[var(--ink-on-dark)] sm:text-[26px]">
                整面墙，是一排排真实的课
              </h2>
              <p className="mt-2 max-w-[520px] text-[13px] leading-[1.7] text-[var(--ink-on-dark-2)]">
                每一本书脊都是一门课，厚薄按课时。抽一本出来，就从这里开始学。
              </p>
            </div>
            <Link
              href="/courses"
              className="group hidden shrink-0 items-center gap-1 text-[13px] font-semibold text-[var(--ink-on-dark-2)] transition-colors hover:text-[var(--red)] sm:inline-flex"
            >
              走到书架前
              <ArrowRight size={14} weight="bold" aria-hidden className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
          {/* CourseShelf 自带 3D 书脊 + reduce-motion 静态降级；此处只提供数据。 */}
          {courses.length > 0 ? (
            <CourseShelf courses={courses} />
          ) : (
            <p className="text-[13px] text-[var(--ink-on-dark-3)]">课程正在上架，先去造一门属于你的课。</p>
          )}
          <Link
            href="/courses"
            className="mt-6 inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--red-ink)] sm:hidden"
          >
            走到书架前
            <ArrowRight size={14} weight="bold" aria-hidden />
          </Link>
        </motion.div>

        {/* —— 邻座的桌 = 社区共创（举手投票剪影 + VoteButton teaser）—— */}
        <motion.div {...reveal(0.05)}>
          <div
            className="relative overflow-hidden rounded-[18px] border border-[var(--hairline-on-dark)] p-6 sm:p-7"
            style={{ background: "var(--video-grad)", boxShadow: "0 16px 40px -20px rgba(0,0,0,0.7)" }}
          >
            {/* 邻座剪影：几枚「举手」头像剪影，暗示一屋子人一起共创 */}
            <div aria-hidden className="pointer-events-none absolute right-4 top-4 flex -space-x-2 opacity-60">
              {[0, 1, 2, 3].map((n) => (
                <span
                  key={n}
                  className="h-7 w-7 rounded-full border border-[var(--hairline-on-dark)]"
                  style={{
                    background: `linear-gradient(140deg, rgba(255,255,255,${0.12 - n * 0.02}), transparent)`,
                  }}
                />
              ))}
            </div>
            <p className="mono text-[11px] uppercase tracking-[0.2em] text-[var(--ink-on-dark-3)]">
              THE NEIGHBOURS · 邻座的桌
            </p>
            <h2 className="mt-2 text-[20px] font-bold tracking-[-0.01em] text-[var(--ink-on-dark)]">
              下一门课，一屋子人一起点亮
            </h2>
            <p className="mt-2 max-w-[520px] text-[13px] leading-[1.7] text-[var(--ink-on-dark-2)]">
              你想学什么？举手投票，票高的需求进入平台排期，为你和邻座一起造出来。
            </p>

            {demand ? (
              <div className="mt-5 flex flex-wrap items-center gap-4 rounded-[14px] border border-[var(--hairline-on-dark)] bg-white/[0.04] p-4">
                <div className="min-w-0 flex-1">
                  <Link href={`/demands/${demand.id}`} className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold text-[var(--ink-on-dark)] hover:text-[var(--red)]">
                      {demand.title}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--ok-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--ok)]">
                      <CheckCircle size={12} weight="fill" />
                      {demand.categoryLabel} · 已进入排期
                    </span>
                  </Link>
                  {demand.description && (
                    <p className="mt-1 line-clamp-1 text-[13px] text-[var(--ink-on-dark-3)]">
                      {demand.description}
                    </p>
                  )}
                </div>
                <div className="shrink-0">
                  {/* VoteButton teaser：真实投票组件（自带 client 动效 + reduce-motion 降级）。
                      未登录/未订阅 → disabledReason 引导；点火动效即「共创点亮」隐喻。 */}
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
                className="cta-glow studio-press mt-5 inline-flex items-center gap-1.5 rounded-[12px] bg-[var(--red)] px-4 py-2.5 text-[13px] font-bold text-white"
              >
                <UsersThree size={14} weight="fill" />
                发起第一条共创需求
              </Link>
            )}

            <Link
              href="/demands"
              className="mono mt-4 inline-flex items-center gap-1.5 text-[11px] text-[var(--ink-on-dark-3)] transition-colors hover:text-[var(--red)]"
            >
              <UsersThree size={13} />
              共 <span className="font-bold text-[var(--ink-on-dark-2)]">{demandCount}</span> 条在征集 · 每周排期一次
            </Link>
          </div>
        </motion.div>

        {/* —— 窗外潮汐 = 品牌收尾 + 订阅 CTA —— */}
        <motion.div {...reveal(0.1)}>
          <div
            className="relative overflow-hidden rounded-[20px] border border-[var(--hairline-on-dark)] p-8 text-center sm:p-12"
            style={{ background: "var(--video-grad)", boxShadow: "var(--lift)" }}
          >
            {/* —— 窗外意象底图：天明潮汐抽象光影（studyroom-act3-dawn）。铺满卡片、object-cover，
                 作「窗外将亮」的实景氛围底，压在卡片渐变之上、下方潮汐光带 + 中央暖光晕之下。
                 静态图，reduce-motion 亦显示。上叠暗化层，让「为你留了一盏灯」文案与订阅 CTA 保持清晰。 —— */}
            <img
              src="/marketing/studyroom-act3-dawn.jpg"
              alt=""
              aria-hidden
              className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-30"
              loading="lazy"
              decoding="async"
            />
            {/* 图上暗化：压住天明高光、维持深色收尾调，保证中央文案与双 CTA 对比度充足。 */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(120% 120% at 50% 30%, rgba(16,20,28,0.62) 0%, rgba(12,16,22,0.82) 55%, rgba(8,10,14,0.92) 100%)",
              }}
            />

            {/* 窗外潮汐光：底部一道横向暖冷渐变，像窗外将亮未亮的海平线 */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-40"
              style={{
                background:
                  "linear-gradient(180deg, transparent, rgba(59,141,214,0.14) 60%, rgba(255,200,140,0.10))",
              }}
            />
            {/* 留给你的一盏灯：中央暖光晕 */}
            <div
              aria-hidden
              className={`pointer-events-none absolute left-1/2 top-6 h-40 w-40 -translate-x-1/2 rounded-full ${
                motionOk ? "lamp-breathe" : ""
              }`}
              style={{
                background: "radial-gradient(circle, rgba(255,210,150,0.30), transparent 68%)",
              }}
            />
            <p className="mono relative text-[11px] uppercase tracking-[0.2em] text-[var(--ink-on-dark-3)]">
              THE WINDOW · 窗外潮汐
            </p>
            <h2 className="relative mt-3 text-[26px] font-bold leading-[1.3] tracking-[-0.01em] text-[var(--ink-on-dark)] sm:text-[34px]">
              这间自习室，
              <br className="sm:hidden" />
              为你留了一盏灯
            </h2>
            <p className="relative mx-auto mt-4 max-w-[440px] text-[14px] leading-[1.8] text-[var(--ink-on-dark-2)]">
              {yearPriceText ? (
                <>
                  年度会员 {yearPriceText}，全部赛道畅学。停订后笔记与截帧永久保存，随时可取消。
                </>
              ) : (
                <>订阅制畅学全部赛道。停订后笔记与截帧永久保存，随时可取消。</>
              )}
            </p>
            <div className="relative mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/create"
                className="cta-glow studio-press inline-flex items-center gap-2 rounded-[13px] bg-[var(--red)] px-6 py-3 text-[14px] font-bold text-white transition-[filter] hover:brightness-105"
              >
                坐下，造第一门课
                <ArrowRight size={15} weight="bold" aria-hidden />
              </Link>
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 rounded-[13px] border border-[var(--hairline-on-dark)] bg-white/[0.06] px-6 py-3 text-[14px] font-bold text-[var(--ink-on-dark)] backdrop-blur-sm transition-colors hover:bg-white/[0.1]"
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
