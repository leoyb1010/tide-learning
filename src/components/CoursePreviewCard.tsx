"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  X, ArrowRight, PlayCircle, ListChecks, Clock, Users, Sparkle, CheckCircle,
} from "@phosphor-icons/react";
import { CourseCardFace, type CourseCardData } from "./CourseCard";
import { Spotlight } from "./motion";
import { RatingStars } from "./RatingStars";
import { deriveCourseRating } from "@/lib/course-rating";
import { TRACK_MAP, trackGradientVar, resolveCoverSrc } from "@/lib/tracks";

/* ============================================================
   课程库 · 课程卡两段式预览（client）
   —— 问题⑯①：课程库点一门课先弹「预览气泡卡」（评分星级、简介、N节/时长、
      作者、核心卖点），卡上「进入学习」按钮再进详情/工作台，降低误入、增强预览。
   · 卡本身是 <button>（不是 <Link>），点击开预览浮层；不阻断键盘/无障碍。
   · 浮层 Portal 到 body，避开祖先 transform 造成的堆叠困住（同 Dialog 铁律）。
   · z-index 走 --z-modal 变量；scrim 走 --z-overlay-scrim 语义之上（浮层整体一层）。
   · 响应式：桌面居中浮卡；移动（sm 以下）底部弹层（items-end + 滑起动画）。
   · 触达：关闭键 44px、主 CTA h-11(44px)；reduce-motion 由 CSS 动画类降级。
   · 评分/评价数据（S5 评价系统闭环）：优先读 CourseCardData.ratingScore（数据层聚合，
     有真实评价读真实、零评价占位派生）；字段缺省时兜底 deriveCourseRating。
     UI 据 isPlaceholder 标「示例」，诚实不冒充。
   边界：纯 client，只引 client/纯函数模块，不碰 server 链。
   ============================================================ */
export function CoursePreviewCard({ course }: { course: CourseCardData }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Spotlight className="h-full rounded-[var(--radius-card)]">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="studio-lift group flex h-full w-full flex-col overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)] text-left shadow-[var(--card)]"
        >
          <CourseCardFace course={course} />
        </button>
      </Spotlight>
      <PreviewOverlay course={course} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function PreviewOverlay({
  course, open, onClose,
}: {
  course: CourseCardData;
  open: boolean;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.body);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (!restoreFocusRef.current) {
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") trapFocus(e, panelRef.current);
    };
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(() =>
      panelRef.current?.querySelector<HTMLElement>("[data-autofocus],button,a")?.focus(),
    );
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open) return;
    restoreFocusRef.current?.focus?.();
    restoreFocusRef.current = null;
  }, [open]);

  if (!host || !open) return null;

  // 评分（S5）：优先读数据层已算好的字段（有真实评价读真实、零评价占位派生）；
  // 字段缺省（老调用方未带 rating）时兜底占位派生，保证任何入口都不崩。
  const rating =
    course.ratingScore != null
      ? { score: course.ratingScore, count: course.ratingCount ?? 0, isPlaceholder: course.ratingIsPlaceholder ?? true }
      : deriveCourseRating(course.id, course.learnersCount);
  const track = course.category ? TRACK_MAP[course.category] : undefined;
  // 作者：列表数据不含讲师名（守住 listCourses 契约不扩字段），用赛道语义给一个可信署名，
  // 详情页再展示真实讲师。核心卖点取赛道 blurb + 目标人群，均为真实业务文案。
  const author = track ? `${track.label}教研组` : "潮汐教研组";
  const sellingPoints = buildSellingPoints(course, track?.blurb);
  const detailHref = `/courses/${course.slug}`;

  return createPortal(
    <div
      className="fixed inset-0 flex items-end justify-center sm:items-center sm:p-4"
      style={{ zIndex: "var(--z-modal)" }}
      role="dialog"
      aria-modal="true"
      aria-label={`${course.title} · 课程预览`}
    >
      <div className="dialog-scrim-in absolute inset-0 bg-[color:rgba(20,26,36,.5)]" onClick={onClose} />

      {/* 浮卡：移动端贴底满宽 + 顶圆角 + 滑起；桌面居中 max-w-md + 全圆角 + 涨潮上浮 */}
      <div
        ref={panelRef}
        className="preview-sheet-in sm:dialog-panel-in relative z-[1] w-full max-w-[520px] overflow-hidden rounded-t-[24px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--lift)] sm:max-w-md sm:rounded-[22px]"
      >
        {/* 移动端抓手 */}
        <div className="flex justify-center pt-2.5 sm:hidden">
          <span className="h-1 w-10 rounded-full bg-[var(--border2)]" />
        </div>

        {/* 头图带：赛道封面 + 压暗，标题浮在图上，高级材质 */}
        <div className="relative">
          <div className="hover-sheen relative aspect-[16/8] w-full overflow-hidden">
            <PreviewCover course={course} />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-black/15" />
            {/* 关闭键：命中区 44px */}
            <button
              type="button"
              onClick={onClose}
              title="关闭预览" aria-label="关闭预览"
              className="studio-press absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm ring-1 ring-white/15 transition-colors hover:bg-black/55"
            >
              <X size={18} weight="bold" />
            </button>
            {course.isNew && (
              <span className="absolute left-4 top-3.5 inline-flex items-center gap-1 rounded-full bg-[var(--new-bg)] px-2 py-1 text-[0.66rem] font-semibold uppercase tracking-wide text-[var(--new-ink)]">
                <Sparkle size={11} weight="fill" /> NEW
              </span>
            )}
            <div className="absolute inset-x-0 bottom-0 p-4">
              <span className="mb-1.5 inline-block rounded-full bg-white/18 px-2.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm ring-1 ring-white/15">
                {course.categoryLabel}
              </span>
              <h2 className="text-[19px] font-bold leading-snug tracking-tight text-white [text-shadow:0_1px_10px_rgba(0,0,0,.35)]">
                {course.title}
              </h2>
            </div>
          </div>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-4 sm:max-h-none sm:p-5">
          {/* 评分 + 作者 一行 */}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <RatingStars score={rating.score} count={rating.count} placeholder={rating.isPlaceholder} size={14} />
            <span className="text-[12.5px] text-[var(--ink3)]">{author}</span>
          </div>

          {/* 简介 */}
          {(course.subtitle || track?.blurb) && (
            <p className="mt-2.5 text-[13.5px] leading-[1.7] text-[var(--ink2)]">
              {course.subtitle || track?.blurb}
            </p>
          )}

          {/* 三元指标条：节数 / 时长 / 在学人数 */}
          <div className="mt-3.5 grid grid-cols-3 gap-2 rounded-[14px] border border-[var(--border)] bg-[var(--surface2)] p-3 text-center">
            <Metric icon={<ListChecks size={15} weight="bold" />} value={course.lessonsCount != null ? `${course.lessonsCount} 节` : `${course.freeLessonsCount}+ 节`} label="课时" />
            <Metric icon={<Clock size={15} weight="bold" />} value={course.duration} label="时长" />
            <Metric icon={<Users size={15} weight="bold" />} value={compact(course.learnersCount)} label="在学" />
          </div>

          {/* 核心卖点 */}
          <ul className="mt-3.5 space-y-1.5">
            {sellingPoints.map((p, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px] leading-[1.55] text-[var(--ink2)]">
                <CheckCircle size={15} weight="fill" className="mt-[1px] shrink-0 text-[var(--ok)]" />
                <span>{p}</span>
              </li>
            ))}
          </ul>

          {course.freeLessonsCount > 0 && (
            <div className="mt-3 flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--ink2)]">
              <PlayCircle size={15} weight="fill" className="text-[var(--red-active)]" />
              {course.freeLessonsCount} 节免费试学，先看后订
            </div>
          )}

          {/* 主 CTA：进入学习（进详情/工作台）。h-11 = 44px 触达。 */}
          <div className="mt-4 flex flex-col gap-2">
            <Link
              href={detailHref}
              data-autofocus
              onClick={onClose}
              className="cta-glow group inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-[13px] bg-[var(--red)] text-[14px] font-semibold text-white transition-colors hover:bg-[var(--red-hover)]"
            >
              进入学习
              <ArrowRight size={16} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="studio-press inline-flex h-10 w-full items-center justify-center rounded-[13px] text-[13px] font-medium text-[var(--ink3)] transition-colors hover:text-[var(--ink)]"
            >
              先看看别的
            </button>
          </div>
        </div>
      </div>
    </div>,
    host,
  );
}

/* ---------- 预览浮层头图（复用封面决策，client 侧渲染 <img>） ---------- */
function PreviewCover({ course }: { course: CourseCardData }) {
  // 用同一套封面决策（resolveCoverSrc/trackGradientVar 均纯函数，client 可直接引），
  // 保证预览头图与课程卡封面一致。
  const grad = trackGradientVar(course.category ?? "");
  const cover = resolveCoverSrc(course.slug, course.category ?? "", course.id);
  return (
    <>
      <div className="absolute inset-0" style={{ background: grad }} />
      <img src={cover} alt={course.title} decoding="async" className="absolute inset-0 h-full w-full object-cover" />
    </>
  );
}

function Metric({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[var(--ink3)]">{icon}</span>
      <span className="mono text-[13px] font-bold leading-none text-[var(--ink)]">{value}</span>
      <span className="text-[10.5px] text-[var(--ink4)]">{label}</span>
    </div>
  );
}

/* ---------- 辅助（纯函数） ---------- */

/** 核心卖点：赛道 blurb + 通用价值主张（真实业务文案，非编造数据）。 */
function buildSellingPoints(course: CourseCardData, blurb?: string): string[] {
  const pts: string[] = [];
  if (blurb) pts.push(blurb);
  pts.push("订阅解锁本赛道全部课程，随更新持续获得新内容");
  pts.push("边学边记，笔记与截帧永久保留");
  return pts.slice(0, 3);
}

/** 大数字紧凑格式（「万」口径），与详情页 compactCount 一致。 */
function compact(n: number): string {
  if (n < 10000) return String(n);
  const w = n / 10000;
  return `${w >= 10 ? Math.round(w) : w.toFixed(1)}万`;
}

function trapFocus(e: KeyboardEvent, panel: HTMLElement | null) {
  if (!panel) return;
  const f = panel.querySelectorAll<HTMLElement>(
    'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
  );
  if (f.length === 0) return;
  const first = f[0];
  const last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault(); first.focus();
  }
}
