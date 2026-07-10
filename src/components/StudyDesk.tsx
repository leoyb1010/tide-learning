"use client";

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
  MagicWand,
  Books,
} from "@phosphor-icons/react/dist/ssr";
import { WeeklyReportBanner } from "./WeeklyReportBanner";
import { DeskShelf } from "./DeskShelf";
import { BeamFrame } from "./ui/BeamFrame";
import type { WeeklyReport } from "@/lib/weekly-report";

/**
 * §1 自习桌 Dashboard —— 登录后首页主体（v3.1 视觉深度重设计）。
 *
 * 服务端在 page.tsx 计算好所有 SSR 稳定的派生数据，作为纯 props 传入；
 * 本组件为 client 组件，只负责中央输入框的交互与整体渲染。
 *
 * v3.1 重构叙事（让用户一眼喜欢上）：
 * - 「今天想学」= 绝对主角：hero 级超大输入框放最顶最大位置，材质精致
 *   （inner-hi 内顶高光 + 聚焦红光环 + cta-glow 造课按钮 + 灵感胶囊），是书桌的心跳。
 * - 学习回望（日/周/月）从常驻大横幅 → 一排紧凑可点小卡（见 WeeklyReportBanner），
 *   点击弹出详情 modal，不再喧宾夺主。
 * - 学习进度（学习中）紧凑化：精致水平卡片，占比缩小，不铺满。
 * - 三卡 + AI 建议 + 在线人数：材质分级、层次清晰、留白呼吸，一处红点睛。
 *
 * 材质/动效编排：整页 .stagger 递延进场（子 section 设 --i）；主卡 --card + --inner-hi；
 * 深色展示区（续学缩略、AI 建议）用 --video-grad / --ai-grad；关键数字 .num-pop；
 * 主 CTA .cta-glow；状态语义走功能色。圆角两阶：大容器 var(--radius-card)(18)、
 * 小卡/输入/胶囊 var(--radius-card-sm)(14)。所有动效尊重 prefers-reduced-motion。
 * 触达 ≥44px；零 em-dash。
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
  shelfCount: number; // 书架藏书总册数（服务端 count 派生，供书架入口角标；书架明细弹层按需拉）
}

// 快捷灵感胶囊（造课主入口的示范需求）。
const SPARKS = ["面试英语口语", "用 AI 做周报", "给爸妈的智能手机课", "30 分钟学会番茄炒蛋"] as const;

// 复合搜索联想：只取 course 域（平台课程库），与 /api/search 契约一致的最小子集。
interface DeskSuggestion {
  type: "course";
  id: string;
  title: string;
  snippet: string;
  href: string;
}
const SUGGEST_MIN = 2; // 输入达到该长度才触发联想（避免单字刷接口/被限流）
const SUGGEST_DEBOUNCE_MS = 300; // 与 /api/search 30 次/60s 限流匹配的节流

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
  shelfCount,
}: StudyDeskProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState("");
  // 从集市「去书架」/造课「查看我的书架」带 ?shelf=1 进来时，自动展开书架弹层（含全五层，collected 在此可见）。
  const [shelfOpen, setShelfOpen] = useState(searchParams.get("shelf") === "1");

  // 复合搜索框（问题③）：输入框既能「找现成课程」也能「AI 造课」。输入 ≥2 字 debounce 打
  // /api/search 拉平台课程库联想，下拉面板上区展示课程结果、底部固定「AI 造一门」动作。
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<DeskSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const reqSeq = useRef(0);
  const query = value.trim();
  const panelOpen = focused && query.length >= SUGGEST_MIN;

  // 输入 ≥2 字 → debounce 300ms 联搜课程库（只采纳最后一次请求，丢弃过期响应）。
  useEffect(() => {
    if (query.length < SUGGEST_MIN) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    const seq = ++reqSeq.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=6`, {
          headers: { Accept: "application/json" },
        });
        const json = (await res.json()) as {
          ok: boolean;
          data?: { results: Array<DeskSuggestion & { type: string }> };
        };
        if (seq !== reqSeq.current) return; // 过期响应丢弃
        const courses = (json.data?.results ?? [])
          .filter((r): r is DeskSuggestion => r.type === "course")
          .slice(0, 6);
        setSuggestions(courses);
      } catch {
        if (seq !== reqSeq.current) return;
        setSuggestions([]);
      } finally {
        if (seq === reqSeq.current) setSearching(false);
      }
    }, SUGGEST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // 反馈②「点击输入框部分位置无法激活」：容器是带内边距 + 前置图标 + 按钮的 flex 行，
  // 点在图标/内边距/间隙上会落到容器而非 <input>。这里把非按钮点击统一转焦到输入框。
  function focusInput(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    if (target === inputRef.current || target.closest("button")) return;
    e.preventDefault();
    inputRef.current?.focus();
  }

  // Enter 兜底：保留原「三合一」启发式——短查询走课程库搜索，否则带 prompt 去造课。
  function go() {
    const q = value.trim();
    if (!q) return;
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
  // 显式选择：点课程结果直达详情；点「AI 造一门」带 prompt 去造课。
  function pickCourse(href: string) {
    setFocused(false);
    router.push(href);
  }
  function createFromQuery() {
    setFocused(false);
    router.push(`/create?prompt=${encodeURIComponent(query)}`);
  }

  // 断点续播链接：学习页按 userId+lessonId 查该章节已存的 progressSec 自动定位。
  function continueHref(r: DeskResume): string {
    return `/courses/${r.courseSlug}/learn/${r.lessonId}`;
  }

  const deskItems = resumeList ?? [];
  const secondaryResumes = deskItems.slice(1);

  return (
    <div className="stagger mx-auto flex max-w-[960px] flex-col gap-12 md:gap-14">
      {/* ============================================================
          1. HERO —— 「今天想学点什么」绝对主角（问候 + 超大输入 + 灵感）
          ============================================================ */}
      <section
        className="studio-lightup flex flex-col items-center pt-3 text-center sm:pt-6"
        style={{ "--i": 0 } as CSSProperties}
      >
        {/* 问候 + 今日状态：小徽章，只做招呼，不抢 hero 焦点 */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="text-[13px] font-medium text-[var(--ink3)]">
            {greeting}，{nickname}
          </span>
          {litToday ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--ok)_28%,transparent)] bg-[var(--ok-soft)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--ok)]">
              <Flame size={11} weight="fill" />
              已连续
              <span className="mono num-pop font-bold">{streak}</span>天
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-1 text-[11.5px] text-[var(--ink3)]">
              <Flame size={11} weight="regular" className="text-[var(--ink4)]" />
              连续
              <span className="mono num-pop font-bold text-[var(--ink2)]">{streak}</span>天 · 今天来点亮
            </span>
          )}
        </div>

        {/* 主标题：一屏最大字号，绝对视觉重心 */}
        <h1 className="mt-5 text-[30px] font-bold leading-[1.12] tracking-[-0.02em] text-[var(--ink)] sm:text-[40px]">
          今天想学点什么？
        </h1>
        <p className="mt-3 text-[14px] leading-[1.6] text-[var(--ink3)] sm:text-[15px]">
          说出想学的，AI 帮你造一门课；或直接找到现成的。
        </p>

        {/* Hero 复合输入框（问题③）：既搜平台课程库、又能 AI 造课。动态边框光束包一圈；
            输入 ≥2 字弹课程库联想面板，底部固定「AI 造一门」。 */}
        <BeamFrame className="mt-7 w-full max-w-[640px] rounded-[18px]" radius={18} variant="line">
        <form
          onSubmit={onSubmit}
          onMouseDown={focusInput}
          className="group relative w-full cursor-text overflow-hidden rounded-[18px] border border-[color-mix(in_srgb,var(--border)_50%,transparent)] bg-[var(--surface)] p-2.5 shadow-[var(--lift),var(--inner-hi)] outline-none transition-shadow duration-300 focus-within:shadow-[var(--lift),var(--inner-hi),0_0_22px_-4px_rgba(252,1,26,0.22)]"
        >
          <div className="flex items-center gap-2.5">
            <Sparkle size={20} weight="fill" className="ml-2.5 shrink-0 text-[var(--red)]" />
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="搜课程，或说出想学的让 AI 造一门…"
              maxLength={200}
              aria-label="搜索课程或描述想学的"
              className="min-w-0 flex-1 bg-transparent py-2.5 text-[15px] text-[var(--ink)] placeholder:text-[var(--ink4)] outline-none focus:outline-none focus-visible:outline-none sm:text-[16px]"
            />
            <button
              type="submit"
              disabled={!value.trim()}
              className="studio-press cta-glow inline-flex h-[46px] shrink-0 items-center gap-1.5 rounded-[13px] bg-[var(--red)] px-4 text-[14px] font-bold text-white transition-colors hover:bg-[var(--red-hover)] disabled:cursor-not-allowed disabled:bg-[var(--surface-inset)] disabled:text-[var(--ink4)] disabled:shadow-none"
            >
              <MagicWand size={17} weight="fill" className="hidden sm:block" />
              <span className="hidden sm:inline">造课</span>
              <PaperPlaneRight size={16} weight="fill" className="sm:hidden" />
            </button>
          </div>
        </form>

        {/* 联想面板：绝对定位于 BeamFrame（position:relative）下方，覆盖其后内容。
            面板按钮 onMouseDown preventDefault 保持输入框焦点，使 onClick 前面板不因 blur 收起。 */}
        {panelOpen && (
          <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-20 overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)] text-left shadow-[var(--lift)]">
            {suggestions.length > 0 && (
              <div className="max-h-[300px] overflow-y-auto py-1.5">
                <p className="px-3.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink4)]">
                  课程库
                </p>
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickCourse(s.href)}
                    className="group flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--surface2)]"
                  >
                    <BookOpen size={16} weight="fill" className="mt-0.5 shrink-0 text-[var(--red)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-semibold text-[var(--ink)]">{s.title}</span>
                      {s.snippet && (
                        <span className="mt-0.5 block truncate text-[12px] text-[var(--ink4)]">{s.snippet}</span>
                      )}
                    </span>
                    <ArrowRight
                      size={13}
                      weight="bold"
                      className="mt-0.5 shrink-0 text-[var(--ink4)] opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  </button>
                ))}
              </div>
            )}
            {suggestions.length === 0 && (
              <p className="px-3.5 py-2.5 text-[12px] text-[var(--ink4)]">
                {searching ? "搜索课程库中…" : "课程库暂无匹配，试试让 AI 造一门"}
              </p>
            )}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={createFromQuery}
              className="flex w-full items-center gap-2.5 border-t border-[var(--border)] bg-[var(--surface2)] px-3.5 py-3 text-left transition-colors hover:bg-[var(--surface-inset)]"
            >
              <Sparkle size={16} weight="fill" className="shrink-0 text-[var(--red)]" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ink2)]">
                用 AI 造一门「<span className="font-semibold text-[var(--ink)]">{query}</span>」的课
              </span>
              <ArrowRight size={13} weight="bold" className="shrink-0 text-[var(--ink3)]" />
            </button>
          </div>
        )}
        </BeamFrame>

        {/* 快捷灵感胶囊 */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <span className="text-[11px] text-[var(--ink4)]">试试</span>
          {SPARKS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => router.push(`/create?prompt=${encodeURIComponent(s)}`)}
              className="studio-press rounded-full border border-[var(--border)] bg-[var(--surface2)] px-3 py-1.5 text-[12px] text-[var(--ink2)] transition-colors hover:border-[var(--border2)] hover:bg-[var(--surface)] hover:text-[var(--ink)]"
            >
              {s}
            </button>
          ))}
        </div>

        {/* 学习回望：日/周/月三小卡（紧贴 hero 下方，紧凑不喧宾夺主，点击弹详情） */}
        <div className="mt-8 w-full max-w-[640px]">
          <WeeklyReportBanner report={weeklyReport} />
        </div>
      </section>

      {/* ============================================================
          2. 学习中（断点续学）—— 紧凑水平卡片，占比缩小
          ============================================================ */}
      {resume && (
        <section className="space-y-2.5" style={{ "--i": 1 } as CSSProperties}>
          <div className="flex items-baseline justify-between">
            <h2 className="text-[15px] font-bold tracking-[-0.01em] text-[var(--ink)]">继续学习</h2>
            {deskItems.length > 1 && (
              <span className="mono text-[11px] text-[var(--ink4)]">{deskItems.length} 门进行中</span>
            )}
          </div>
          {/* 主卡：最近一门，深色续学缩略 + 材质分级 + hover 抬升 */}
          <Link
            href={continueHref(resume)}
            className="studio-lift hover-sheen group relative flex items-center gap-3.5 overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--card),var(--inner-hi)]"
          >
            {/* 深色续学缩略：--video-grad 渐变 + 顶部高光 */}
            <div
              className="relative flex h-[56px] w-[96px] shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-card-sm)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
              style={{ background: "var(--video-grad)" }}
            >
              <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-white/15 backdrop-blur-sm transition-transform group-hover:scale-110">
                <Play size={13} weight="fill" className="ml-0.5 text-white" />
              </div>
              <div className="absolute inset-x-0 bottom-0 h-1 bg-white/12">
                <div className="h-full rounded-r-full bg-[var(--red)]" style={{ width: `${resume.progressPct}%` }} />
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="mono text-[10.5px] text-[var(--ink4)]">从上次继续 · {resume.courseTitle}</p>
              <p className="mt-0.5 truncate text-[13.5px] font-semibold text-[var(--ink)]">{resume.lessonTitle}</p>
              <p className="mono mt-0.5 text-[10.5px] text-[var(--ink3)]">{resume.remainText}</p>
            </div>
            <span className="mono num-pop shrink-0 text-[14px] font-bold text-[var(--red)]">{resume.progressPct}%</span>
            <ArrowRight size={15} weight="bold" className="shrink-0 text-[var(--ink4)] transition-transform group-hover:translate-x-0.5" />
          </Link>
          {/* 降权行：其余学习中课程，圆环进度 */}
          {secondaryResumes.map((r) => (
            <Link
              key={r.lessonId}
              href={continueHref(r)}
              className="studio-lift group flex items-center gap-3 rounded-[var(--radius-card-sm)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 shadow-[var(--card)]"
            >
              <span className="relative grid h-8 w-8 shrink-0 place-items-center">
                <svg viewBox="0 0 36 36" className="h-8 w-8 -rotate-90">
                  <circle cx="18" cy="18" r="15" fill="none" stroke="var(--surface-inset)" strokeWidth="4" />
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
                <span className="mono absolute text-[9px] font-bold text-[var(--ink3)]">{r.progressPct}</span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-[var(--ink)]">{r.lessonTitle}</p>
                <p className="mono text-[10.5px] text-[var(--ink4)]">{r.courseTitle} · {r.remainText}</p>
              </div>
              <ArrowRight size={14} weight="bold" className="shrink-0 text-[var(--ink4)] transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </section>
      )}

      {/* ============================================================
          3. 我的书桌（横排 3 卡，材质分级 + hover 抬升 + 数字 num-pop）
          ============================================================ */}
      <section style={{ "--i": 2 } as CSSProperties}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-bold tracking-[-0.01em] text-[var(--ink)]">我的书桌</h2>
          {/* ⑨ 精致「我的书架」入口：干净克制的胶囊，去网格纹理，改单层 surface 材质 + 内顶高光。
              图标随 hover 轻微书本翻起（.shelf-entry-icon），整卡 studio-lift 抬升，融入书桌节奏不突兀。
              点击召唤 DeskShelf 抽屉（按需拉书架明细）。藏书总数角标点睛。 */}
          <button
            type="button"
            onClick={() => setShelfOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={shelfOpen}
            aria-label={`打开我的书架，共 ${shelfCount} 册`}
            className="shelf-entry studio-lift group relative inline-flex h-11 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] pl-2.5 pr-3.5 text-[13px] font-semibold text-[var(--ink2)] shadow-[var(--card),var(--inner-hi)] transition-colors hover:text-[var(--ink)]"
          >
            <span className="shelf-entry-icon flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--red-soft-border)] bg-[var(--red-soft)] text-[var(--red)]">
              <Books size={15} weight="fill" />
            </span>
            <span>我的书架</span>
            {shelfCount > 0 && (
              <span className="mono num inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[var(--red)] px-1.5 text-[10.5px] font-bold leading-none text-white">
                {shelfCount > 99 ? "99+" : shelfCount}
              </span>
            )}
            <ArrowRight
              size={13}
              weight="bold"
              className="text-[var(--ink4)] transition-transform group-hover:translate-x-0.5"
            />
          </button>
        </div>
        <div className="stagger grid gap-3.5 sm:grid-cols-3">
          {/* 我的课：红做「学习主战场」信号 */}
          <Link
            href="/me/courses"
            style={{ "--i": 0 } as CSSProperties}
            className="studio-lift group flex flex-col rounded-[var(--radius-card-sm)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card),var(--inner-hi)]"
          >
            <div className="flex h-[36px] w-[36px] items-center justify-center rounded-[var(--radius-card-sm)] border border-[var(--red-soft-border)] bg-[var(--red-soft)] text-[var(--red)] transition-transform group-hover:scale-105">
              <BookOpen size={17} weight="fill" />
            </div>
            <p className="mt-3.5 flex items-baseline gap-1.5">
              <span className="mono num-pop text-[24px] font-bold leading-none text-[var(--ink)]">{myCourseCount}</span>
              <span className="text-[12px] text-[var(--ink3)]">门我的课</span>
            </p>
            <p className="mt-auto flex items-center gap-1 pt-3 text-[11.5px] text-[var(--ink3)]">
              AI 造课与导入
              <ArrowRight size={12} weight="bold" className="text-[var(--ink4)] transition-transform group-hover:translate-x-0.5" />
            </p>
          </Link>

          {/* 最近笔记：--info 蓝做「记录/信息」语义 */}
          <Link
            href="/notes"
            style={{ "--i": 1 } as CSSProperties}
            className="studio-lift group flex flex-col rounded-[var(--radius-card-sm)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card),var(--inner-hi)]"
          >
            <div className="flex h-[36px] w-[36px] items-center justify-center rounded-[var(--radius-card-sm)] border border-[color-mix(in_srgb,var(--info)_22%,transparent)] bg-[var(--info-soft)] text-[var(--info)] transition-transform group-hover:scale-105">
              <NotePencil size={17} weight="fill" />
            </div>
            <p className="mt-3.5 flex items-baseline gap-1.5">
              <span
                className={
                  recentNotes.length > 0
                    ? "mono num-pop text-[24px] font-bold leading-none text-[var(--info)]"
                    : "mono num-pop text-[24px] font-bold leading-none text-[var(--ink)]"
                }
              >
                {recentNotes.length}
              </span>
              <span className="text-[12px] text-[var(--ink3)]">条最近笔记</span>
            </p>
            <p className="mt-auto flex items-center gap-1 pt-3 text-[11.5px] text-[var(--ink3)]">
              {recentNotes.length > 0 ? (
                <span className="truncate">{recentNotes[0].title}</span>
              ) : (
                "还没有笔记，边看边记"
              )}
              <ArrowRight size={12} weight="bold" className="shrink-0 text-[var(--ink4)] transition-transform group-hover:translate-x-0.5" />
            </p>
          </Link>

          {/* 待复习卡 → 复习室：--warn 暖黄做「待办/警示」语义 */}
          <Link
            href="/review"
            style={{ "--i": 2 } as CSSProperties}
            className="studio-lift group flex flex-col rounded-[var(--radius-card-sm)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card),var(--inner-hi)]"
          >
            <div
              className={
                dueReviewCount > 0
                  ? "flex h-[36px] w-[36px] items-center justify-center rounded-[var(--radius-card-sm)] border border-[color-mix(in_srgb,var(--warn)_28%,transparent)] bg-[var(--warn-soft)] text-[var(--warn)] transition-transform group-hover:scale-105"
                  : "flex h-[36px] w-[36px] items-center justify-center rounded-[var(--radius-card-sm)] border border-[color-mix(in_srgb,var(--ok)_24%,transparent)] bg-[var(--ok-soft)] text-[var(--ok)] transition-transform group-hover:scale-105"
              }
            >
              <Cards size={17} weight="fill" />
            </div>
            <p className="mt-3.5 flex items-baseline gap-1.5">
              <span
                className={
                  dueReviewCount > 0
                    ? "mono num-pop text-[24px] font-bold leading-none text-[var(--warn)]"
                    : "mono num-pop text-[24px] font-bold leading-none text-[var(--ink)]"
                }
              >
                {dueReviewCount}
              </span>
              <span className="text-[12px] text-[var(--ink3)]">张待复习</span>
            </p>
            <p className="mt-auto pt-3 text-[11.5px] text-[var(--ink3)]">
              {dueReviewCount > 0 ? "趁热复习，记得更牢" : "全部复习完，节奏很稳"}
            </p>
          </Link>
        </div>
      </section>

      {/* ============================================================
          4. AI 今日建议（深色 --ai-grad 智能材质）+ 在线人数（合为一行呼吸模块）
          ============================================================ */}
      <section className="grid gap-3.5 lg:grid-cols-[1fr_auto]" style={{ "--i": 3 } as CSSProperties}>
        {/* AI 建议卡 */}
        <div className="relative overflow-hidden rounded-[var(--radius-card)] p-4 text-white shadow-[var(--lift)]">
          <div className="absolute inset-0 -z-10" style={{ background: "var(--ai-grad)" }} />
          <div
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              background:
                "radial-gradient(120% 90% at 8% 108%, rgba(150,40,220,0.20), transparent 52%), radial-gradient(90% 80% at 104% -8%, rgba(252,1,26,0.24), transparent 58%)",
            }}
          />
          <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-px bg-[var(--hairline-on-dark)]" />
          <div className="flex items-start gap-3">
            <div className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-[var(--radius-card-sm)] border border-[var(--hairline-on-dark)] bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
              <Sparkle size={17} weight="fill" className="text-[var(--red)]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-on-dark-3)]">AI 今日建议</p>
              <p className="mt-1.5 text-[13.5px] font-semibold leading-[1.6] text-white">{advice}</p>
            </div>
            <Link
              href={resume ? `/courses/${resume.courseSlug}/learn/${resume.lessonId}` : "/courses"}
              className="studio-press mt-0.5 hidden shrink-0 items-center gap-1.5 rounded-[var(--radius-card-sm)] border border-[var(--hairline-on-dark)] bg-white/12 px-3.5 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-white/22 sm:inline-flex"
            >
              去执行
              <ArrowRight size={13} weight="bold" />
            </Link>
          </div>
        </div>

        {/* 在线人数 + 进入专注（右侧竖排卡，与 AI 卡等高呼吸） */}
        <div className="flex flex-col justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface2)] p-4 shadow-[var(--card)] lg:w-[220px]">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--red)] opacity-60 motion-safe:animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--red)]" />
            </span>
            <p className="text-[12.5px] text-[var(--ink2)]">
              此刻 <span className="mono font-semibold text-[var(--ink)]">{onlineCount.toLocaleString("en-US")}</span> 人在自习
            </p>
          </div>
          <Link
            href={focusHref}
            className="studio-press cta-glow inline-flex items-center justify-center gap-2 rounded-[var(--radius-card-sm)] bg-[var(--red)] px-4 py-3 text-[13.5px] font-bold text-white transition-colors hover:bg-[var(--red-hover)]"
          >
            <Lightning size={15} weight="fill" />
            进入专注
          </Link>
        </div>
      </section>

      {/* 书架弹层：受控 open；数据由弹层自身打开时 fetch /api/shelf 按需拉（首屏不拖慢书桌）。 */}
      <DeskShelf open={shelfOpen} onClose={() => setShelfOpen(false)} />
    </div>
  );
}
