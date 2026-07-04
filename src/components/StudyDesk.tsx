"use client";

import { useState, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Play,
  PaperPlaneRight,
  Sparkle,
  BookOpen,
  NotePencil,
  Cards,
  Lightning,
  Flame,
} from "@phosphor-icons/react/dist/ssr";
import { WeeklyReportBanner } from "./WeeklyReportBanner";
import type { WeeklyReport } from "@/lib/weekly-report";

/**
 * §1 自习桌 Dashboard。登录后首页主体（D1 视觉升级版）。
 * 服务端在 page.tsx 计算好所有 SSR 稳定的派生数据，作为纯 props 传入；
 * 本组件为 client 组件，只负责中央输入框的交互与整体渲染。
 *
 * D1 材质/动效编排：
 * - 整页 .stagger 递延进场（子 section 设 --i），营造「一格一格点亮自习室」的仪式感。
 * - 主卡 --card + --inner-hi 内顶高光，hover 用 .studio-lift 抬升。
 * - 深色展示区（续学缩略、AI 建议）用 --video-grad 渐变 + 柔光，弃死黑平面。
 * - 关键数字变化用 .num-pop 强调；主 CTA 用 .cta-glow 红柔光。
 * - 状态语义走功能色：待复习 --warn、笔记 --info、点亮/live --red。
 * 数字/时长统一 .mono；圆角走两阶 token：大容器/展示区 var(--radius-card)(18)、
 * 小卡/输入/胶囊 var(--radius-card-sm)(14)，对齐 iOS StudioRadius card/cardLg。
 * 所有动效均尊重 prefers-reduced-motion（D1 工具类已内置降级）。
 */

// 传入的纯数据形状（page.tsx 服务端组装，均为可序列化基本值）。
export interface DeskResume {
  courseSlug: string;
  lessonId: string;
  courseTitle: string;
  lessonTitle: string;
  progressPct: number; // 0-100
  remainText: string; // "剩 6 分钟"
  resumeSec?: number; // v2.2：断点秒数，用于 ?t= 精确续播
}
export interface DeskNote {
  id: string;
  courseSlug: string;
  lessonId: string;
  title: string;
  relativeTime: string;
}
export interface StudyDeskProps {
  nickname: string;
  greeting: string; // 上午好 / 下午好 / 晚上好
  streak: number; // 连续天数
  litToday: boolean; // 今天是否已点亮
  resume: DeskResume | null;
  resumeList?: DeskResume[]; // v2.2：学习中（最多 3 门），第一门为主卡，其余为降权行
  myCourseCount: number;
  recentNotes: DeskNote[];
  dueReviewCount: number;
  advice: string; // AI 今日建议（服务端派生）
  onlineCount: number; // 自习室在线人数（静态）
  focusHref: string; // 进入专注按钮目标
  weeklyReport: WeeklyReport; // 本周周报（服务端 getWeeklyReport 组装，留存回路）
}

export function StudyDesk({
  nickname,
  greeting,
  streak,
  litToday,
  resume,
  resumeList,
  myCourseCount,
  recentNotes,
  dueReviewCount,
  advice,
  onlineCount,
  focusHref,
  weeklyReport,
}: StudyDeskProps) {
  const router = useRouter();
  const [value, setValue] = useState("");

  // 中央输入框「三合一」：把需求带去 /create 造课（AI 自习室主入口）。
  // 内容较像「找现成课程」的短查询走 /courses?q=；否则默认造课意图带 prompt 过去。
  function go() {
    const q = value.trim();
    if (!q) return;
    // 短且不含「学/做/怎么/如何」等造课信号 → 视为课程搜索；否则带需求去造课。
    const looksLikeSearch = q.length <= 8 && !/学|做|怎么|如何|教|会|想/.test(q);
    if (looksLikeSearch) {
      router.push(`/courses?q=${encodeURIComponent(q)}`);
    } else {
      router.push(`/create?prompt=${encodeURIComponent(q)}`);
    }
  }
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    go();
  }

  // 断点续播链接：学习页按 userId+lessonId 查该章节已存的 progressSec 自动定位，
  // 所以链接到章节即回到断点，无需 ?t=（进度已在 DB，不做冗余参数）。
  function continueHref(r: DeskResume): string {
    return `/courses/${r.courseSlug}/learn/${r.lessonId}`;
  }

  const deskItems = resumeList ?? [];
  const secondaryResumes = deskItems.slice(1);

  return (
    <div className="stagger mx-auto flex max-w-[1120px] flex-col gap-14 md:gap-16">
      {/* ============ 1. 问候 + 今日状态（点亮仪式感）============ */}
      <section
        className="flex flex-col gap-2 pt-2"
        style={{ "--i": 0 } as CSSProperties}
      >
        {/* 问候只是招呼，降到 20/22px 让位给中央输入主入口 */}
        <h1 className="text-[20px] font-semibold leading-[1.34] tracking-[-0.01em] text-[var(--ink)] sm:text-[22px]">
          {greeting}，{nickname}
        </h1>
        <div className="flex flex-wrap items-center gap-2.5">
          {/* 连续天数：常驻徽章，语义反馈「今天亮没亮」而非常挂红。
              已点亮 → --ok 绿（今天已达成，火苗点燃）；未点亮 → 中性引导（火苗待燃）。
              红从这个常驻态撤出，只留给「进入专注」CTA 与 live 点，回到 ≤2 处/屏。 */}
          {litToday ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--ok)_28%,transparent)] bg-[var(--ok-soft)] px-2.5 py-1 text-[12px] text-[var(--ink2)]">
              <Flame size={12} weight="fill" className="text-[var(--ok)]" />
              已连续
              <span className="mono num-pop font-bold text-[var(--ok)]">{streak}</span>
              天
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-1 text-[12px] text-[var(--ink3)]">
              <Flame size={12} weight="regular" className="text-[var(--ink4)]" />
              已连续
              <span className="mono num-pop font-bold text-[var(--ink2)]">{streak}</span>
              天
            </span>
          )}
          {/* 今日点亮态提示：已点亮显达成，未点亮做中性引导 */}
          {litToday ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--ok)_28%,transparent)] bg-[var(--ok-soft)] px-2.5 py-1 text-[12px] font-medium text-[var(--ok)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" />
              今天已点亮
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-1 text-[12px] text-[var(--ink3)]">
              <span className="h-1.5 w-1.5 rounded-full border border-[var(--border2)]" />
              今天还没点亮，来学一课
            </span>
          )}
        </div>
      </section>

      {/* ============ 1.5 本周周报（留存回路：一周回望 + 分享）============ */}
      <div style={{ "--i": 1 } as CSSProperties}>
        <WeeklyReportBanner report={weeklyReport} />
      </div>

      {/* ============ 2. 中央大输入框「今天想学点什么？」（ChatGPT 首屏感）============ */}
      <section
        className="studio-lightup flex flex-col items-center text-center"
        style={{ "--i": 2 } as CSSProperties}
      >
        <p className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink4)]">
          STUDY DESK
        </p>
        {/* 中央输入是转化主入口，作绝对视觉重心：一屏最大字号 28/32 */}
        <h2 className="mt-3 text-[28px] font-bold leading-[1.15] tracking-[-0.015em] text-[var(--ink)] sm:text-[32px]">
          今天想学点什么？
        </h2>
        <p className="mt-2 text-[13px] leading-[1.6] text-[var(--ink3)]">
          说出你的需求，帮你造一门课，或直接找到现成的。
        </p>

        {/* 输入框：主材质卡 + 内顶高光，聚焦时红柔光提示这是主入口 */}
        <form
          onSubmit={onSubmit}
          className="studio-sweep group relative mt-6 w-full max-w-[620px] overflow-hidden rounded-[var(--radius-card-sm)] border border-[var(--border2)] bg-[var(--surface)] p-2 shadow-[var(--card),var(--inner-hi)] outline-none transition-shadow focus-within:border-[var(--red-soft-border)] focus-within:shadow-[var(--red-glow),var(--inner-hi)] focus-within:outline-none"
        >
          <div className="flex items-center gap-2">
            <Sparkle
              size={18}
              weight="fill"
              className="ml-3 shrink-0 text-[var(--red)]"
            />
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="例如：想练面试英语口语 / 30 分钟学会做番茄炒蛋"
              maxLength={200}
              className="min-w-0 flex-1 bg-transparent py-3 text-[15px] text-[var(--ink)] placeholder:text-[var(--ink4)] focus:outline-none"
            />
            <button
              type="submit"
              disabled={!value.trim()}
              aria-label="开始"
              className="studio-press cta-glow inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[12px] bg-[var(--red)] text-white transition-colors hover:bg-[var(--red-hover)] disabled:cursor-not-allowed disabled:bg-[var(--surface-inset)] disabled:text-[var(--ink4)] disabled:shadow-none"
            >
              <PaperPlaneRight size={17} weight="fill" />
            </button>
          </div>
        </form>

        {/* 快捷需求胶囊：hover 抬色引导 */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {["面试英语口语", "用 AI 做周报", "给爸妈的智能手机课"].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                router.push(`/create?prompt=${encodeURIComponent(s)}`);
              }}
              className="studio-press rounded-full border border-[var(--border)] bg-[var(--surface2)] px-3 py-1.5 text-[12px] text-[var(--ink2)] transition-colors hover:border-[var(--border2)] hover:bg-[var(--surface)] hover:text-[var(--ink)]"
            >
              {s}
            </button>
          ))}
        </div>
      </section>

      {/* ============ 3. 学习中（断点续学，最多 3 门：主卡 + 降权行）============ */}
      {resume && (
        <section
          className="space-y-3"
          style={{ "--i": 3 } as CSSProperties}
        >
          <div className="flex items-baseline justify-between">
            <h2 className="text-[17px] font-bold tracking-[-0.01em] text-[var(--ink)]">学习中</h2>
            {deskItems.length > 1 && (
              <span className="mono text-[11px] text-[var(--ink4)]">
                {deskItems.length} 门进行中
              </span>
            )}
          </div>
          {/* 主卡：最近一门，深色续学缩略 + 材质分级 + hover 抬升 */}
          <Link
            href={continueHref(resume)}
            className="studio-lift hover-sheen group relative overflow-hidden flex items-center gap-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card),var(--inner-hi)]"
          >
            {/* 深色续学缩略：--video-grad 渐变 + 顶部高光，弃死黑平面 */}
            <div
              className="relative flex h-[64px] w-[112px] shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-card-sm)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
              style={{ background: "var(--video-grad)" }}
            >
              <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-white/15 backdrop-blur-sm transition-transform group-hover:scale-110">
                <Play size={15} weight="fill" className="ml-0.5 text-white" />
              </div>
              <div className="absolute inset-x-0 bottom-0 h-1 bg-white/12">
                <div
                  className="h-full rounded-r-full bg-[var(--red)]"
                  style={{ width: `${resume.progressPct}%` }}
                />
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="mono text-[11px] text-[var(--ink4)]">
                从上次继续 · {resume.courseTitle}
              </p>
              <p className="mt-1 truncate text-[14px] font-semibold text-[var(--ink)]">
                {resume.lessonTitle}
              </p>
              <p className="mono mt-1 text-[11px] text-[var(--ink3)]">
                {resume.remainText}
              </p>
            </div>
            <span className="mono num-pop shrink-0 text-[15px] font-bold text-[var(--red)]">
              {resume.progressPct}%
            </span>
            <ArrowRight
              size={16}
              weight="bold"
              className="shrink-0 text-[var(--ink4)] transition-transform group-hover:translate-x-0.5"
            />
          </Link>
          {/* 降权行：其余学习中课程，圆环进度 */}
          {secondaryResumes.map((r) => (
            <Link
              key={r.lessonId}
              href={continueHref(r)}
              className="studio-lift group flex items-center gap-3 rounded-[var(--radius-card-sm)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-[var(--card)]"
            >
              <span className="relative grid h-8 w-8 shrink-0 place-items-center">
                <svg viewBox="0 0 36 36" className="h-8 w-8 -rotate-90">
                  <circle
                    cx="18"
                    cy="18"
                    r="15"
                    fill="none"
                    stroke="var(--surface-inset)"
                    strokeWidth="4"
                  />
                  <circle
                    cx="18"
                    cy="18"
                    r="15"
                    fill="none"
                    stroke="var(--red)"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray={`${(r.progressPct / 100) * 94.2} 94.2`}
                  />
                </svg>
                <span className="mono absolute text-[9px] font-bold text-[var(--ink3)]">
                  {r.progressPct}
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-[var(--ink)]">
                  {r.lessonTitle}
                </p>
                <p className="mono text-[11px] text-[var(--ink4)]">
                  {r.courseTitle} · {r.remainText}
                </p>
              </div>
              <ArrowRight
                size={14}
                weight="bold"
                className="shrink-0 text-[var(--ink4)] transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          ))}
        </section>
      )}

      {/* ============ 4. 我的书桌（横排 3 卡，材质分级 + hover 抬升 + 数字 num-pop）============ */}
      <section style={{ "--i": 4 } as CSSProperties}>
        <h2 className="mb-3 text-[17px] font-bold tracking-[-0.01em] text-[var(--ink)]">我的书桌</h2>
        <div className="stagger grid gap-4 md:grid-cols-3">
          {/* 我的课：红做「学习主战场」信号 */}
          <Link
            href="/me/courses"
            style={{ "--i": 0 } as CSSProperties}
            className="studio-lift group flex flex-col rounded-[var(--radius-card-sm)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card),var(--inner-hi)]"
          >
            <div className="flex h-[38px] w-[38px] items-center justify-center rounded-[var(--radius-card-sm)] border border-[var(--red-soft-border)] bg-[var(--red-soft)] text-[var(--red)] transition-transform group-hover:scale-105">
              <BookOpen size={18} weight="fill" />
            </div>
            <p className="mt-4 flex items-baseline gap-1.5">
              <span className="mono num-pop text-[26px] font-bold leading-none text-[var(--ink)]">
                {myCourseCount}
              </span>
              <span className="text-[12px] text-[var(--ink3)]">门我的课</span>
            </p>
            <p className="mt-auto flex items-center gap-1 pt-3 text-[12px] text-[var(--ink3)]">
              AI 造课与导入的课程
              <ArrowRight
                size={12}
                weight="bold"
                className="text-[var(--ink4)] transition-transform group-hover:translate-x-0.5"
              />
            </p>
          </Link>

          {/* 最近笔记：与卡1/卡3 同构统计卡（icon + 大数字 + 标签），--info 蓝做「记录/信息」语义。
              数字为最近笔记条数；最新一条摘要下沉为卡内一行极简预览，不再在网格里塞列表+虚线空盒。 */}
          <Link
            href="/notes"
            style={{ "--i": 1 } as CSSProperties}
            className="studio-lift group flex flex-col rounded-[var(--radius-card-sm)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card),var(--inner-hi)]"
          >
            <div className="flex h-[38px] w-[38px] items-center justify-center rounded-[var(--radius-card-sm)] border border-[color-mix(in_srgb,var(--info)_22%,transparent)] bg-[var(--info-soft)] text-[var(--info)] transition-transform group-hover:scale-105">
              <NotePencil size={18} weight="fill" />
            </div>
            <p className="mt-4 flex items-baseline gap-1.5">
              <span
                className={
                  recentNotes.length > 0
                    ? "mono num-pop text-[26px] font-bold leading-none text-[var(--info)]"
                    : "mono num-pop text-[26px] font-bold leading-none text-[var(--ink)]"
                }
              >
                {recentNotes.length}
              </span>
              <span className="text-[12px] text-[var(--ink3)]">条最近笔记</span>
            </p>
            <p className="mt-auto flex items-center gap-1 pt-3 text-[12px] text-[var(--ink3)]">
              {recentNotes.length > 0 ? (
                <span className="truncate">{recentNotes[0].title}</span>
              ) : (
                "还没有笔记，边看边记"
              )}
              <ArrowRight
                size={12}
                weight="bold"
                className="shrink-0 text-[var(--ink4)] transition-transform group-hover:translate-x-0.5"
              />
            </p>
          </Link>

          {/* 待复习卡 → 复习室：--warn 暖黄做「待办/警示」语义，红仅在有到期时强调数字 */}
          <Link
            href="/review"
            style={{ "--i": 2 } as CSSProperties}
            className="studio-lift group flex flex-col rounded-[var(--radius-card-sm)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card),var(--inner-hi)]"
          >
            <div
              className={
                dueReviewCount > 0
                  ? "flex h-[38px] w-[38px] items-center justify-center rounded-[var(--radius-card-sm)] border border-[color-mix(in_srgb,var(--warn)_28%,transparent)] bg-[var(--warn-soft)] text-[var(--warn)] transition-transform group-hover:scale-105"
                  : "flex h-[38px] w-[38px] items-center justify-center rounded-[var(--radius-card-sm)] border border-[color-mix(in_srgb,var(--ok)_24%,transparent)] bg-[var(--ok-soft)] text-[var(--ok)] transition-transform group-hover:scale-105"
              }
            >
              <Cards size={18} weight="fill" />
            </div>
            <p className="mt-4 flex items-baseline gap-1.5">
              <span
                className={
                  dueReviewCount > 0
                    ? "mono num-pop text-[26px] font-bold leading-none text-[var(--warn)]"
                    : "mono num-pop text-[26px] font-bold leading-none text-[var(--ink)]"
                }
              >
                {dueReviewCount}
              </span>
              <span className="text-[12px] text-[var(--ink3)]">张待复习</span>
            </p>
            <p className="mt-auto pt-3 text-[12px] text-[var(--ink3)]">
              {dueReviewCount > 0 ? "趁热复习，记得更牢" : "全部复习完，节奏很稳"}
            </p>
          </Link>
        </div>
      </section>

      {/* ============ 5. AI 今日建议（深色卡，专属 --ai-grad 智能材质，与视频缩略材质区隔）============ */}
      <section
        style={{ "--i": 5 } as CSSProperties}
        className="relative overflow-hidden rounded-[var(--radius-card)] p-5 text-white shadow-[var(--lift)]"
      >
        {/* 专属 AI 智能材质：冷靛蓝基底（比视频缩略更暗更冷），营造「AI 在思考」的独特气场 */}
        <div
          className="absolute inset-0 -z-10"
          style={{ background: "var(--ai-grad)" }}
        />
        {/* 斜向红紫智性流光：从左下漫上右上，比单颗右上光晕更有「思绪流动」感 */}
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{ background: "radial-gradient(120% 90% at 8% 108%, rgba(150,40,220,0.20), transparent 52%), radial-gradient(90% 80% at 104% -8%, rgba(252,1,26,0.24), transparent 58%)" }}
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-px bg-[var(--hairline-on-dark)]" />
        <div className="flex items-start gap-3.5">
          <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[var(--radius-card-sm)] border border-[var(--hairline-on-dark)] bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
            <Sparkle size={18} weight="fill" className="text-[var(--red)]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-on-dark-3)]">
              AI 今日建议
            </p>
            <p className="mt-1.5 text-[14px] font-semibold leading-[1.6] text-white">
              {advice}
            </p>
          </div>
          <Link
            href={
              resume
                ? `/courses/${resume.courseSlug}/learn/${resume.lessonId}`
                : "/courses"
            }
            className="studio-press mt-0.5 hidden shrink-0 items-center gap-1.5 rounded-[var(--radius-card-sm)] border border-[var(--hairline-on-dark)] bg-white/12 px-3.5 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-white/22 sm:inline-flex"
          >
            去执行
            <ArrowRight size={13} weight="bold" />
          </Link>
        </div>
      </section>

      {/* ============ 6. 自习室氛围条（live 红点呼吸）============ */}
      <section
        style={{ "--i": 6 } as CSSProperties}
        className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface2)] px-5 py-4 shadow-[var(--card)]"
      >
        <div className="flex items-center gap-2.5">
          {/* live 呼吸点：红仅用于「此刻在线」这个实时信号 */}
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-[var(--red)] opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--red)]" />
          </span>
          <p className="text-[13px] text-[var(--ink2)]">
            此刻{" "}
            <span className="mono font-semibold text-[var(--ink)]">
              {onlineCount.toLocaleString("en-US")}
            </span>{" "}
            人在自习
          </p>
        </div>
        <Link
          href={focusHref}
          className="studio-press cta-glow inline-flex items-center gap-2 rounded-[var(--radius-card-sm)] bg-[var(--red)] px-4 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-[var(--red-hover)]"
        >
          <Lightning size={15} weight="fill" />
          进入专注
        </Link>
      </section>
    </div>
  );
}
