"use client";

import { useState, type FormEvent } from "react";
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
  Users,
  Lightning,
} from "@phosphor-icons/react/dist/ssr";

/**
 * §1 自习桌 Dashboard —— 登录后首页主体（全新）。
 * 服务端在 page.tsx 计算好所有 SSR 稳定的派生数据，作为纯 props 传入；
 * 本组件为 client 组件，只负责中央输入框的交互与整体渲染。
 * 数字/时长/价格统一用 .mono，卡片 .studio-lift，进场 .studio-rise，
 * 签名动效 .studio-lightup / .studio-sweep 营造「点亮自习室」仪式感。
 */

// —— 传入的纯数据形状（page.tsx 服务端组装，均为可序列化基本值）——
export interface DeskResume {
  courseSlug: string;
  lessonId: string;
  courseTitle: string;
  lessonTitle: string;
  progressPct: number; // 0-100
  remainText: string; // "剩 6 分钟"
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
  myCourseCount: number;
  recentNotes: DeskNote[];
  dueReviewCount: number;
  advice: string; // AI 今日建议（服务端派生）
  onlineCount: number; // 自习室在线人数（静态）
  focusHref: string; // 进入专注按钮目标
}

export function StudyDesk({
  nickname,
  greeting,
  streak,
  litToday,
  resume,
  myCourseCount,
  recentNotes,
  dueReviewCount,
  advice,
  onlineCount,
  focusHref,
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

  return (
    <div className="mx-auto flex max-w-[1060px] flex-col gap-14 md:gap-16">
      {/* ============ 1. 问候 + 今日状态 ============ */}
      <section className="studio-rise flex flex-col gap-1.5 pt-2">
        <h1 className="text-[24px] font-bold leading-[1.35] text-[var(--ink)] sm:text-[27px]">
          {greeting}，{nickname}
        </h1>
        <p className="mono flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--ink3)]">
          <span>
            已连续 <span className="font-semibold text-[var(--red)]">{streak}</span> 天
          </span>
          <span className="text-[var(--ink4)]">·</span>
          {litToday ? (
            <span className="inline-flex items-center gap-1.5 text-[var(--ink2)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--red)]" />
              今天已点亮
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[var(--ink3)]">
              <span className="h-1.5 w-1.5 rounded-full border border-[var(--border2)]" />
              今天还没点亮
            </span>
          )}
        </p>
      </section>

      {/* ============ 2. 中央大输入框「今天想学点什么？」（ChatGPT 首屏感）============ */}
      <section className="studio-lightup flex flex-col items-center text-center">
        <p className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink4)]">
          STUDY DESK
        </p>
        <h2 className="mt-3 text-[22px] font-bold text-[var(--ink)] sm:text-[26px]">
          今天想学点什么？
        </h2>
        <p className="mt-2 text-[13px] text-[var(--ink3)]">
          说出你的需求 —— 帮你造一门课，或直接找到现成的。
        </p>

        <form
          onSubmit={onSubmit}
          className="studio-sweep group relative mt-6 w-full max-w-[620px] overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-2 shadow-[var(--card)] transition-colors focus-within:border-[var(--red-soft-border)] focus-within:shadow-[var(--lift)]"
        >
          <div className="flex items-center gap-2">
            <Sparkle
              size={18}
              weight="fill"
              className="ml-3 shrink-0 text-[var(--red)]"
            />
            <input
              autoFocus
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
              className="studio-press inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[13px] bg-[var(--ink)] text-[var(--surface)] transition-opacity hover:opacity-90 disabled:opacity-30"
            >
              <PaperPlaneRight size={17} weight="fill" />
            </button>
          </div>
        </form>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {["面试英语口语", "用 AI 做周报", "给爸妈的智能手机课"].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                router.push(`/create?prompt=${encodeURIComponent(s)}`);
              }}
              className="studio-press rounded-full border border-[var(--border)] bg-[var(--surface2)] px-3 py-1.5 text-[12px] text-[var(--ink2)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)]"
            >
              {s}
            </button>
          ))}
        </div>
      </section>

      {/* ============ 3. 继续学习卡（断点续学）============ */}
      {resume && (
        <section className="studio-rise">
          <p className="mono mb-3 text-[10px] uppercase tracking-[0.14em] text-[var(--ink4)]">
            CONTINUE
          </p>
          <Link
            href={`/courses/${resume.courseSlug}/learn/${resume.lessonId}`}
            className="studio-lift group flex items-center gap-4 rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]"
          >
            {/* 深色续播缩略 */}
            <div
              className="relative flex h-[64px] w-[112px] shrink-0 items-center justify-center overflow-hidden rounded-[11px]"
              style={{ background: "linear-gradient(140deg,#232935 0%,#141821 100%)" }}
            >
              <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-white/15 backdrop-blur-sm">
                <Play size={15} weight="fill" className="ml-0.5 text-white" />
              </div>
              <div className="absolute inset-x-0 bottom-0 h-1 bg-white/15">
                <div
                  className="h-full bg-[var(--red)]"
                  style={{ width: `${resume.progressPct}%` }}
                />
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="mono text-[11px] text-[var(--ink3)]">继续学习 · {resume.courseTitle}</p>
              <p className="mt-1 truncate text-[14px] font-semibold text-[var(--ink)]">
                {resume.lessonTitle}
              </p>
              <p className="mono mt-1 text-[11px] text-[var(--ink3)]">{resume.remainText}</p>
            </div>
            <span className="mono shrink-0 text-[14px] font-semibold text-[var(--red)]">
              {resume.progressPct}%
            </span>
            <ArrowRight
              size={16}
              weight="bold"
              className="shrink-0 text-[var(--ink4)] transition-transform group-hover:translate-x-0.5"
            />
          </Link>
        </section>
      )}

      {/* ============ 4. 我的书桌（横排 3 卡）============ */}
      <section>
        <p className="mono mb-3 text-[10px] uppercase tracking-[0.14em] text-[var(--ink4)]">
          MY DESK · 我的书桌
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          {/* 我的课 */}
          <Link
            href="/me/courses"
            className="studio-lift flex flex-col rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)]"
          >
            <div className="flex h-[38px] w-[38px] items-center justify-center rounded-[11px] bg-[var(--red-soft)] text-[var(--red)]">
              <BookOpen size={18} weight="fill" />
            </div>
            <p className="mt-4 flex items-baseline gap-1.5">
              <span className="mono text-[24px] font-bold text-[var(--ink)]">{myCourseCount}</span>
              <span className="text-[12px] text-[var(--ink3)]">门我的课</span>
            </p>
            <p className="mt-auto pt-3 text-[12px] text-[var(--ink3)]">
              AI 造课与导入的课程
            </p>
          </Link>

          {/* 最近笔记 */}
          <Link
            href="/notes"
            className="studio-lift flex flex-col rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)]"
          >
            <div className="flex h-[38px] w-[38px] items-center justify-center rounded-[11px] bg-[var(--surface-inset)] text-[var(--ink)]">
              <NotePencil size={18} weight="fill" />
            </div>
            <p className="mt-4 text-[12px] font-semibold text-[var(--ink)]">最近笔记</p>
            {recentNotes.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1.5">
                {recentNotes.map((n) => (
                  <li key={n.id} className="flex items-center gap-2">
                    <span className="h-1 w-1 shrink-0 rounded-full bg-[var(--red)]" />
                    <span className="truncate text-[12px] text-[var(--ink2)]">{n.title}</span>
                    <span className="mono ml-auto shrink-0 text-[10px] text-[var(--ink4)]">
                      {n.relativeTime}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[12px] text-[var(--ink3)]">还没有笔记，边看边记吧。</p>
            )}
          </Link>

          {/* 待复习卡 */}
          <Link
            href="/notes"
            className="studio-lift flex flex-col rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)]"
          >
            <div className="flex h-[38px] w-[38px] items-center justify-center rounded-[11px] bg-[var(--red-soft)] text-[var(--red)]">
              <Cards size={18} weight="fill" />
            </div>
            <p className="mt-4 flex items-baseline gap-1.5">
              <span className="mono text-[24px] font-bold text-[var(--ink)]">{dueReviewCount}</span>
              <span className="text-[12px] text-[var(--ink3)]">张待复习</span>
            </p>
            <p className="mt-auto pt-3 text-[12px] text-[var(--ink3)]">
              {dueReviewCount > 0 ? "趁热复习，记得更牢" : "暂无到期卡片"}
            </p>
          </Link>
        </div>
      </section>

      {/* ============ 5. AI 今日建议（静态智能文案）============ */}
      <section className="studio-rise overflow-hidden rounded-[16px] bg-[var(--video-bg)] p-5 text-white">
        <div className="flex items-start gap-3.5">
          <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] bg-white/10">
            <Sparkle size={18} weight="fill" className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="mono text-[10px] uppercase tracking-[0.14em] text-white/50">
              AI 今日建议
            </p>
            <p className="mt-1.5 text-[14px] font-semibold leading-[1.6] text-white">{advice}</p>
          </div>
          <Link
            href={resume ? `/courses/${resume.courseSlug}/learn/${resume.lessonId}` : "/courses"}
            className="studio-press mt-0.5 hidden shrink-0 items-center gap-1.5 rounded-[11px] bg-white/12 px-3.5 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-white/20 sm:inline-flex"
          >
            去执行
            <ArrowRight size={13} weight="bold" />
          </Link>
        </div>
      </section>

      {/* ============ 6. 自习室氛围条 ============ */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-[16px] border border-[var(--border)] bg-[var(--surface2)] px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--red)] opacity-60" />
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
          className="studio-press inline-flex items-center gap-2 rounded-[13px] bg-[var(--ink)] px-4 py-2.5 text-[13px] font-bold text-[var(--surface)] transition-opacity hover:opacity-90"
        >
          <Lightning size={15} weight="fill" />
          进入专注
        </Link>
      </section>
    </div>
  );
}
