"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  X,
  Books,
  BookOpen,
  Sparkle,
  MagicWand,
  Export,
  Trash,
  PlayCircle,
  ArrowRight,
  ArrowClockwise,
  CircleNotch,
} from "@phosphor-icons/react";
import type { MyShelf, ShelfCategory, ShelfCourse } from "@/lib/shelf";

/**
 * §书桌·书架抽屉（DeskShelf）—— ⑨ 重设计：从书桌入口召唤的「我的书架」侧滑抽屉（client）。
 *
 * 打开方式（⑨）：不再是居中弹窗 + 竖排 3D 书脊堆叠。改为
 * 桌面从右侧平滑推出的抽屉（drawer），移动端从底部滑起的抽屉——丝滑高级、聚焦当下。
 * 内容改「封面卡瀑布」：每门课一张封面卡（真实封面图 + 进度 + 赛道），网格铺陈，
 * 比竖排书脊更易扫读、更现代。
 *
 * hover 聚焦（⑨）：鼠标移到某张卡，该卡放大浮起 + 高光描边，同层其它卡轻微虚化降饱和，
 * 形成「聚光灯」聚焦感（.shelf-grid / .shelf-card 承担，reduce-motion 降级为仅描边反馈）。
 *
 * 数据取舍：书桌首屏不带书架数据（避免拖慢 SSR）。本抽屉打开时才 fetch
 * GET /api/shelf 按需拉全量（requireUser + 越权隔离在服务端做）。首帧显示骨架，
 * 拉到后按五个分类归组渲染。
 *
 * 浮层机制（对齐 Dialog / 旧版）：Portal 逃逸到 body、scrim + 抽屉滑入进场、Esc/点外部关闭、
 * focus trap、滚动锁、关闭还焦。层级用 --z-modal。
 *
 * 分类 Tab：全部 / AI 造课 / 导入的 / 在学中 / 集市淘的 / 已完成。切 Tab 只做前端筛选，不重新请求。
 * hover 操作沿用：继续学（进课程页）/ 分享到集市（自造课）/ 删除（自造课，去管理页）。
 * 空态：该分类无课给引导（去造课 / 去课程库或集市）。
 *
 * 边界铁律：本文件为纯 client，只 import 类型（@/lib/shelf 的 type）与 UI；数据经 fetch 取，
 * 不触任何 server 链（next/headers/session/prisma/queries…）。
 * 动效全部 prefers-reduced-motion 降级。触达 ≥44px。零 em-dash。
 */

/* —— 分类 Tab 定义（顺序即用户要的自定义分类顺序）—— */
type TabKey = "all" | ShelfCategory;
interface TabDef {
  key: TabKey;
  label: string;
}
const TABS: TabDef[] = [
  { key: "all", label: "全部" },
  { key: "ai_created", label: "AI 造课" },
  { key: "imported", label: "导入的" },
  { key: "learning", label: "在学中" },
  { key: "collected", label: "集市淘的" },
  { key: "completed", label: "已完成" },
];

/* —— 分类分组的顺序（「全部」视图下从上到下的分组）与文案 —— */
const SECTION_ORDER: { key: ShelfCategory; label: string; blurb: string }[] = [
  { key: "ai_created", label: "AI 造课", blurb: "我说需求、AI 造出来的课" },
  { key: "imported", label: "导入的", blurb: "从外部导入、归我所有的课" },
  { key: "learning", label: "在学中", blurb: "官方课，学到一半接着学" },
  { key: "collected", label: "集市淘的", blurb: "从集市拿走、正在学的课" },
  { key: "completed", label: "已完成", blurb: "每一节都学完了，值得回看" },
];

/* —— 赛道 → 封面渐变兜底双色（无封面图时用赛道气质的渐变占位；与课程库/书桌视觉统一）—— */
const TRACK_TINT: Record<string, { a: string; b: string }> = {
  ai_skill: { a: "#7b5cf0", b: "#4a2fc0" },
  english_oral: { a: "#2ba578", b: "#166849" },
  english_foundation: { a: "#2ba578", b: "#166849" },
  silver_english: { a: "#e0843c", b: "#b0501f" },
  life: { a: "#3b8dd6", b: "#245a97" },
  default: { a: "#5b6474", b: "#2d3440" },
};
function tintFor(category?: string) {
  return TRACK_TINT[category ?? "default"] ?? TRACK_TINT.default;
}

/* —— API 返回形状（对齐 /api/shelf 的 ok({ shelf, total })）—— */
type ShelfResponse =
  | { ok: true; data: { shelf: MyShelf; total: number } }
  | { ok: false; error: string };

type LoadState = "idle" | "loading" | "ready" | "error";

export function DeskShelf({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [shelf, setShelf] = useState<MyShelf | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const [tab, setTab] = useState<TabKey>("all");
  const panelRef = useRef<HTMLDivElement>(null);
  // 打开前的焦点锚点：关闭时还原，避免焦点落回 body（WCAG 2.4.3 焦点顺序）。
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.body);
  }, []);

  /* 打开时按需拉数据（只在首次打开或上次出错时请求；成功后缓存到关闭）。 */
  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch("/api/shelf", { headers: { accept: "application/json" } });
      const json = (await res.json()) as ShelfResponse;
      if (!json.ok) {
        setState("error");
        return;
      }
      setShelf(json.data.shelf);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    if (open && (state === "idle" || state === "error")) {
      void load();
    }
    // 仅在 open 变 true 时触发拉取；state 作条件不作依赖，避免重复请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, load]);

  /* Esc 关闭 + focus trap + 滚动锁（对齐 Dialog）。 */
  useEffect(() => {
    if (!open) return;
    // 仅在 open 转真时记录一次锚点（onClose 变更导致 effect 重跑时不覆盖成浮层内按钮）。
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
      panelRef.current
        ?.querySelector<HTMLElement>("[data-autofocus],button,a,input")
        ?.focus(),
    );
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  /* 关闭（open 转假）时还原焦点并清空锚点，为下次打开重新记录做准备。 */
  useEffect(() => {
    if (open) return;
    restoreFocusRef.current?.focus?.();
    restoreFocusRef.current = null;
  }, [open]);

  /* 打开时把 Tab 复位到「全部」，让每次召唤都从总览开始。 */
  useEffect(() => {
    if (open) setTab("all");
  }, [open]);

  /* 当前 Tab 下要展示的分组（「全部」= 全部非空分类；单类 = 只该类）。 */
  const sections = useMemo(() => {
    if (!shelf) return [];
    const wanted = tab === "all" ? SECTION_ORDER : SECTION_ORDER.filter((s) => s.key === tab);
    return wanted
      .map((s) => ({ ...s, items: shelf[s.key] }))
      .filter((s) => tab !== "all" || s.items.length > 0);
  }, [shelf, tab]);

  const total = useMemo(() => {
    if (!shelf) return 0;
    return (
      shelf.ai_created.length +
      shelf.imported.length +
      shelf.learning.length +
      shelf.collected.length +
      shelf.completed.length
    );
  }, [shelf]);

  if (!host || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-stretch justify-end"
      style={{ zIndex: "var(--z-modal)" }}
      role="dialog"
      aria-modal="true"
      aria-label="我的书架"
    >
      {/* scrim：点外部关闭 */}
      <div className="dialog-scrim-in absolute inset-0 bg-ink-950/55 backdrop-blur-[2px]" onClick={onClose} />

      {/* 抽屉面板：桌面从右滑入贴右缘、移动从底滑起占满宽。丝滑推出 = .shelf-drawer-in。 */}
      <div
        ref={panelRef}
        className="shelf-drawer-in relative ml-auto flex h-full w-full max-w-[560px] flex-col overflow-hidden border-l border-[var(--border2)] bg-[var(--bg2)] shadow-[var(--lift)]"
      >
        {/* 头部：标题 + 总册数 + 关闭 */}
        <header className="relative flex shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3.5 shadow-[var(--inner-hi)] sm:px-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] text-[var(--red)]">
            <Books size={18} weight="fill" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-bold leading-tight tracking-[-0.01em] text-[var(--ink)]">我的书架</h2>
            <p className="mono text-[11px] leading-tight text-[var(--ink4)]">
              {state === "ready" ? (
                <>
                  共 <span className="num font-semibold text-[var(--ink2)]">{total}</span> 册藏书
                </>
              ) : (
                "整理你的每一门课"
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            title="关闭书架" aria-label="关闭书架"
            className="studio-press flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--ink3)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--ink)]"
          >
            <X size={18} weight="bold" />
          </button>
        </header>

        {/* 分类 Tab：横向可滚动，当前项红点睛。 */}
        <nav
          aria-label="书架分类"
          className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 [scrollbar-width:none] sm:px-4"
        >
          {TABS.map((t) => {
            const count =
              state === "ready" && shelf
                ? t.key === "all"
                  ? total
                  : shelf[t.key].length
                : null;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                aria-pressed={active}
                className={
                  active
                    ? "studio-press inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-3.5 text-[13px] font-semibold text-[var(--red)]"
                    : "studio-press inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3.5 text-[13px] text-[var(--ink2)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)]"
                }
              >
                {t.label}
                {count != null && count > 0 && (
                  <span
                    className={
                      active
                        ? "mono num text-[11px] font-bold"
                        : "mono num text-[11px] font-semibold text-[var(--ink4)]"
                    }
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* 抽屉主体：封面卡瀑布。 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5 sm:py-5">
          {state === "loading" && <ShelfSkeleton />}
          {state === "error" && <ShelfError onRetry={load} />}
          {state === "ready" && shelf && (
            <>
              {total === 0 ? (
                <EmptyGuide kind="all" onNavigate={onClose} />
              ) : sections.length === 0 ? (
                <EmptyGuide kind={tab === "all" ? "all" : (tab as ShelfCategory)} onNavigate={onClose} />
              ) : (
                <div className="stagger flex flex-col gap-6">
                  {sections.map((s, i) => (
                    <ShelfSection
                      key={s.key}
                      cat={s.key}
                      label={s.label}
                      blurb={s.blurb}
                      items={s.items}
                      indexBase={i}
                      onNavigate={onClose}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    host,
  );
}

/* ============================================================
   一组分类：分组标题 + 封面卡瀑布（.shelf-grid：hover 聚光，非 hover 卡虚化）
   ============================================================ */
function ShelfSection({
  cat,
  label,
  blurb,
  items,
  indexBase,
  onNavigate,
}: {
  cat: ShelfCategory;
  label: string;
  blurb: string;
  items: ShelfCourse[];
  indexBase: number;
  onNavigate: () => void;
}) {
  // 单类空态（仅在「全部」视图不会走到这，因为空类已被过滤；单类筛选时由上层 EmptyGuide 接管）。
  if (items.length === 0) return null;

  return (
    <section aria-label={`${label}`} className="flex flex-col" style={{ "--i": indexBase } as CSSProperties}>
      <div className="mb-2.5 flex items-end justify-between gap-3 px-0.5">
        <div className="flex items-center gap-2.5">
          <span className="h-4 w-1.5 rounded-full bg-[var(--red)]" aria-hidden />
          <div className="flex flex-col">
            <h3 className="text-[14px] font-bold leading-tight tracking-tight text-[var(--ink)]">{label}</h3>
            <span className="text-[11.5px] leading-tight text-[var(--ink3)]">{blurb}</span>
          </div>
        </div>
        <span className="mono shrink-0 text-[11px] tracking-wide text-[var(--ink4)]">
          <span className="num font-semibold text-[var(--ink2)]">{items.length}</span> 册
        </span>
      </div>

      {/* 卡瀑布：hover 某卡聚焦、同组其它卡虚化（.shelf-grid 承接聚光逻辑）。 */}
      <div className="shelf-grid grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {items.map((c, idx) => (
          <ShelfCard key={c.id} course={c} cat={cat} index={idx} onNavigate={onNavigate} />
        ))}
      </div>
    </section>
  );
}

/* ============================================================
   单张封面卡：真实封面图 + 进度 + 赛道，hover 浮起高光 + 悬浮操作
   ============================================================ */
function ShelfCard({
  course,
  cat,
  index,
  onNavigate,
}: {
  course: ShelfCourse;
  cat: ShelfCategory;
  index: number;
  onNavigate: () => void;
}) {
  const tint = tintFor(course.category);
  // 自造/导入课可分享与删除（去管理页）；其余（在学/淘的/已完成）不给这两个操作。
  const owned = cat === "ai_created" || cat === "imported";
  // 生成态：generating（生成中）/ failed（部分待续）→ 卡上标「生成中/待续」，主操作转「查看进度」。
  const generating = course.genStatus === "generating";
  const genFailed = course.genStatus === "failed";
  const notReady = generating || genFailed;
  const genPct = course.lessonsCount > 0 ? Math.round((course.genDone / course.lessonsCount) * 100) : 0;

  return (
    <div className="shelf-card group/card relative" style={{ "--i": index } as CSSProperties}>
      {/* 卡主体：整块可点 = 进课程页。 */}
      <Link
        href={`/courses/${course.slug}`}
        onClick={onNavigate}
        aria-label={`${course.title}，${course.categoryLabel}，${course.lessonsCount} 节，进度 ${course.progress}%`}
        className="shelf-card-body block overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card),var(--inner-hi)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red-soft-border)]"
      >
        {/* 封面：真实封面图，赛道渐变兜底。已完成星标 / 生成态旗标叠在封面上。 */}
        <div
          className="relative aspect-[16/10] w-full overflow-hidden"
          style={{ background: `linear-gradient(150deg, ${tint.a}, ${tint.b})` }}
        >
          <img
            src={course.coverSrc}
            alt=""
            loading="lazy"
            decoding="async"
            className="shelf-card-cover h-full w-full object-cover"
          />
          {/* 底部暗角，保证角标可读 */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
          {/* 赛道标（左上） */}
          <span className="absolute left-2 top-2 rounded-full bg-black/35 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-white/90 backdrop-blur-sm">
            {course.categoryLabel}
          </span>
          {/* 生成态旗标 / 已完成星标（右上） */}
          {notReady ? (
            <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5 text-[9.5px] font-bold text-white backdrop-blur-sm">
              {generating && <CircleNotch size={9} weight="bold" className="animate-spin" />}
              {generating ? `生成中 ${course.genDone}/${course.lessonsCount}` : `待续 ${course.genDone}/${course.lessonsCount}`}
            </span>
          ) : (
            course.progress >= 100 && (
              <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-[var(--red)] text-white shadow-[0_2px_6px_-1px_rgba(252,1,26,0.5)]">
                <Sparkle size={12} weight="fill" />
              </span>
            )
          )}
          {/* 课时数（左下） */}
          <span className="mono absolute bottom-2 left-2 text-[10px] font-semibold text-white/90">
            {course.lessonsCount} 节
          </span>
          {/* 进度%（右下） */}
          <span className="mono absolute bottom-2 right-2 text-[10.5px] font-bold text-white">
            {notReady ? `${genPct}%` : `${course.progress}%`}
          </span>
        </div>

        {/* 卡底：标题 + 进度条 */}
        <div className="p-2.5">
          <p className="line-clamp-2 min-h-[2.4em] text-[12.5px] font-semibold leading-[1.2] tracking-tight text-[var(--ink)]">
            {course.title}
          </p>
          <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-[var(--surface-inset)]">
            <div
              className="h-full rounded-full bg-[var(--red)]"
              style={{ width: `${notReady ? genPct : course.progress}%` }}
            />
          </div>
        </div>
      </Link>

      {/* hover / focus 悬浮操作面板：从卡顶浮出。
          continue = 主操作（卡本身已可点，这里给显式按钮 + 进度环）；
          自造课额外给 分享到集市 / 删除（去 /me/courses 管理页，不在书桌直接删）。 */}
      <div className="shelf-card-actions pointer-events-none absolute left-1/2 top-1.5 z-10 w-[calc(100%-12px)] max-w-[220px] -translate-x-1/2 opacity-0 transition-opacity duration-200 group-hover/card:pointer-events-auto group-hover/card:opacity-100 group-focus-within/card:pointer-events-auto group-focus-within/card:opacity-100">
        <div className="elev-3 flex flex-col gap-1.5 rounded-[13px] p-2">
          {/* 标题 + 进度环 */}
          <div className="flex items-center gap-2 px-0.5">
            <ProgressRing pct={notReady ? genPct : course.progress} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold text-[var(--ink)]">{course.title}</p>
              <p className="mono text-[10px] text-[var(--ink4)]">
                {notReady
                  ? generating
                    ? `生成中 · ${course.genDone}/${course.lessonsCount} 节`
                    : `待续 · ${course.genDone}/${course.lessonsCount} 节`
                  : `${course.categoryLabel} · ${course.lessonsCount} 节`}
              </p>
            </div>
          </div>
          {/* 主操作：生成中/待续 → 去造课页看进度；否则继续学/再看。 */}
          {notReady ? (
            <Link
              href="/create"
              onClick={onNavigate}
              className="studio-press inline-flex h-11 items-center justify-center gap-1.5 rounded-[10px] bg-[var(--red)] px-3 text-[12.5px] font-bold text-white transition-colors hover:bg-[var(--red-hover)]"
            >
              {generating ? <CircleNotch size={14} weight="bold" className="animate-spin" /> : <ArrowClockwise size={14} weight="bold" />}
              {generating ? "查看进度" : "继续生成"}
            </Link>
          ) : (
            <Link
              href={`/courses/${course.slug}`}
              onClick={onNavigate}
              className="studio-press inline-flex h-11 items-center justify-center gap-1.5 rounded-[10px] bg-[var(--red)] px-3 text-[12.5px] font-bold text-white transition-colors hover:bg-[var(--red-hover)]"
            >
              {course.progress >= 100 ? (
                <>
                  <ArrowClockwise size={14} weight="bold" />
                  再看一遍
                </>
              ) : (
                <>
                  <PlayCircle size={15} weight="fill" />
                  {course.progress > 0 ? "继续学" : "开始学"}
                </>
              )}
            </Link>
          )}
          {/* 自造/导入课：分享到集市 + 删除（去管理页操作，边界内不建删除端点） */}
          {owned && (
            <div className="flex items-center gap-1.5">
              <Link
                href="/me/courses"
                onClick={onNavigate}
                aria-label={`到管理页分享《${course.title}》到集市`}
                className="studio-press inline-flex h-11 flex-1 items-center justify-center gap-1 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] text-[12px] font-semibold text-[var(--ink2)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)]"
              >
                <Export size={13} weight="bold" />
                分享
              </Link>
              <Link
                href="/me/courses"
                onClick={onNavigate}
                title={`到管理页删除《${course.title}》`} aria-label={`到管理页删除《${course.title}》`}
                className="studio-press inline-flex h-11 w-11 items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink3)] transition-colors hover:border-[color-mix(in_srgb,var(--red)_35%,transparent)] hover:text-[var(--red)]"
              >
                <Trash size={14} weight="bold" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 悬浮操作面板里的进度环（SVG，reduce-motion 无影响：纯静态描边）。 */
function ProgressRing({ pct }: { pct: number }) {
  const r = 13;
  const c = 2 * Math.PI * r;
  const done = Math.min(100, Math.max(0, pct));
  return (
    <span className="relative grid h-9 w-9 shrink-0 place-items-center">
      <svg viewBox="0 0 34 34" className="h-9 w-9 -rotate-90">
        <circle cx="17" cy="17" r={r} fill="none" stroke="var(--surface-inset)" strokeWidth="3.5" />
        <circle
          cx="17"
          cy="17"
          r={r}
          fill="none"
          stroke="var(--red)"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={`${(done / 100) * c} ${c}`}
        />
      </svg>
      <span className="mono absolute text-[9px] font-bold text-[var(--ink2)]">{done}</span>
    </span>
  );
}

/* ============================================================
   空态引导：该分类无课 → 去造课 / 去课程库或集市
   ============================================================ */
function EmptyGuide({ kind, onNavigate }: { kind: "all" | ShelfCategory; onNavigate: () => void }) {
  const copy: Record<"all" | ShelfCategory, { title: string; sub: string }> = {
    all: { title: "书架还空着", sub: "说出你想学的，让 AI 造第一门课；或去课程库逛逛。" },
    ai_created: { title: "还没有 AI 造的课", sub: "说一句想学什么，AI 帮你现造一门。" },
    imported: { title: "还没有导入的课", sub: "把外部内容导入，沉淀成你自己的课。" },
    learning: { title: "还没有在学的官方课", sub: "去课程库挑一门官方课开始学。" },
    collected: { title: "集市里还没淘到课", sub: "去集市看看别人分享的好课，拿来就学。" },
    completed: { title: "还没有学完的课", sub: "先把在学的课学完，这里会留下你的足迹。" },
  };
  const c = copy[kind];
  const goMarket = kind === "collected";

  return (
    <div className="elev-1 mx-auto flex max-w-[420px] flex-col items-center rounded-[18px] px-6 py-14 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface2)]">
        <Books size={26} weight="light" className="text-[var(--ink3)]" aria-hidden />
      </span>
      <p className="mt-4 text-[15px] font-bold text-[var(--ink)]">{c.title}</p>
      <p className="mt-1.5 text-[13px] leading-[1.6] text-[var(--ink3)]">{c.sub}</p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
        <Link
          href="/create"
          onClick={onNavigate}
          className="studio-press cta-glow inline-flex h-11 items-center gap-1.5 rounded-[12px] bg-[var(--red)] px-4 text-[13px] font-bold text-white transition-colors hover:bg-[var(--red-hover)]"
        >
          <MagicWand size={15} weight="fill" />
          去造课
        </Link>
        <Link
          href={goMarket ? "/market" : "/courses"}
          onClick={onNavigate}
          className="studio-press inline-flex h-11 items-center gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 text-[13px] font-semibold text-[var(--ink2)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)]"
        >
          <BookOpen size={15} weight="bold" />
          {goMarket ? "去集市" : "去课程库"}
        </Link>
      </div>
    </div>
  );
}

/* ============================================================
   加载骨架 + 错误态
   ============================================================ */
function ShelfSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-live="polite" aria-busy="true">
      <span className="sr-only">正在打开书架</span>
      {[0, 1].map((row) => (
        <div key={row} className="flex flex-col gap-2.5">
          <div className="h-4 w-32 rounded-full bg-[var(--surface-inset)]" />
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((b) => (
              <div
                key={b}
                className="deskshelf-skel-book overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface)]"
              >
                <div className="aspect-[16/10] w-full bg-[var(--surface-inset)]" />
                <div className="space-y-2 p-2.5">
                  <div className="h-3 w-4/5 rounded-full bg-[var(--surface-inset)]" />
                  <div className="h-[3px] w-full rounded-full bg-[var(--surface-inset)]" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ShelfError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="elev-1 mx-auto flex max-w-[380px] flex-col items-center rounded-[18px] px-6 py-14 text-center">
      <p className="text-[15px] font-bold text-[var(--ink)]">书架没打开</p>
      <p className="mt-1.5 text-[13px] text-[var(--ink3)]">网络好像有点问题，再试一次。</p>
      <button
        onClick={onRetry}
        className="studio-press mt-5 inline-flex h-11 items-center gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 text-[13px] font-semibold text-[var(--ink2)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)]"
      >
        <ArrowClockwise size={14} weight="bold" />
        重试
      </button>
    </div>
  );
}

/* focus trap（对齐 Dialog.trapFocus）。 */
function trapFocus(e: KeyboardEvent, panel: HTMLElement | null) {
  if (!panel) return;
  const focusables = panel.querySelectorAll<HTMLElement>(
    'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
  );
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
