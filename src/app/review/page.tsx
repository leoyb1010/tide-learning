"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowsClockwise,
  CheckCircle,
  XCircle,
  Confetti,
  BookOpen,
  CardsThree,
  Timer,
  Fire,
  Lightning,
  Trophy,
  CalendarCheck,
  Star,
  ArrowRight,
  ArrowLeft,
  ShareNetwork,
} from "@phosphor-icons/react";
import { CalendarCheck as CalendarCheckIcon, Exam as ExamIcon } from "@phosphor-icons/react";
import { EmptyTide } from "@/components/TideIllustration";
import { ErrorState, Button } from "@/components/ui";
import { SharePanel } from "@/components/SharePanel";
import { TidalReveal, SPRING_TIDE, SPRING_FIRM, WaveProgress } from "@/components/motion";
import { renderMarkdown } from "@/lib/markdown";
import { track } from "@/lib/analytics-client";
import dynamic from "next/dynamic";

// 模拟考试引擎按需懒加载：仅在切到「模拟考试」Tab 时才拉这段代码，
// 减小复习室首包（ExamRunner 体量大且非首屏）。宿主为客户端组件，
// 且引擎完全交互驱动，故 ssr:false；等待期给出与设计一致的骨架屏。
const ExamRunner = dynamic(() => import("@/components/ExamRunner"), {
  ssr: false,
  loading: () => <ExamRunnerSkeleton />,
});

type ReviewTab = "daily" | "exam";

/** ExamRunner 懒加载占位：骨架屏在 reduce-motion 下由全局规则自动静止。 */
function ExamRunnerSkeleton() {
  return (
    <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--card)]">
      <div className="skeleton h-4 w-40" />
      <div className="skeleton mt-4 h-24 w-full rounded-[12px]" />
      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="skeleton h-9 w-28 rounded-[10px]" />
        <div className="skeleton h-11 w-32 rounded-[12px]" />
      </div>
    </div>
  );
}

/**
 * 复习室外壳（v2.3 §8）：顶部双 Tab [每日复习][模拟考试]，切换两大引擎。
 * 每日复习沿用下方 DailyReview；模拟考试整体承载在 ExamRunner，减少与协作改动的冲突面。
 * 登录态在外壳统一探测一次，供两个 Tab 复用。
 */
export default function ReviewPage() {
  const [tab, setTab] = useState<ReviewTab>("daily");
  const [needLogin, setNeedLogin] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch("/api/auth/me")
      .then((r) => r.json())
      .then((res) => {
        if (alive) setNeedLogin(!res.data?.user);
      })
      .catch(() => {
        if (alive) setNeedLogin(false); // 探测失败按已登录处理，子组件自身仍有兜底
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-[1120px] space-y-6">
      {/* 顶部双 Tab */}
      <TidalReveal>
        <div className="inline-flex items-center gap-1 rounded-[14px] border border-[var(--border)] bg-[var(--surface2)] p-1 shadow-[var(--card),var(--inner-hi)]">
          <TabButton active={tab === "daily"} onClick={() => setTab("daily")} icon={<CalendarCheckIcon size={16} weight={tab === "daily" ? "fill" : "regular"} />}>
            每日复习
          </TabButton>
          <TabButton active={tab === "exam"} onClick={() => setTab("exam")} icon={<ExamIcon size={16} weight={tab === "exam" ? "fill" : "regular"} />}>
            模拟考试
          </TabButton>
        </div>
      </TidalReveal>

      {tab === "daily" ? (
        <DailyReview />
      ) : (
        <div className="mx-auto max-w-[760px]">
          <ExamRunner needLogin={needLogin === true} />
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`studio-press inline-flex items-center gap-1.5 rounded-[11px] px-4 py-2 text-[13.5px] font-semibold transition-colors ${
        active
          ? "bg-[var(--surface)] text-[var(--ink)] shadow-[var(--card)]"
          : "text-[var(--ink3)] hover:text-[var(--ink2)]"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

interface ReviewCard {
  id: string;
  front: string;
  back: string;
  courseTitle: string | null;
}

interface RoundResult {
  card: ReviewCard;
  remembered: boolean;
  nextDueAt: string | null;
}

const SEC_PER_CARD = 24; // 预计每张约 24s，用于任务卡时长估算

/**
 * §5.4 / v2.3 §4 复习室，从「能用」到「想来」。
 * 三段式：任务卡(task) → 卡堆练习(review) → 结算(done)。
 * 保留 3D 翻面；新增卡堆视觉、评分飞出、连击 combo、水位进度、结算 confetti、加练。
 * 键盘：← 忘了 / → 记得 / 空格翻面。
 */
function DailyReview() {
  const reduce = useReducedMotion();

  const [cards, setCards] = useState<ReviewCard[] | null>(null);
  const [error, setError] = useState(false);
  const [needLogin, setNeedLogin] = useState(false);
  const [dueToday, setDueToday] = useState(0);
  const [streakDays, setStreakDays] = useState(0);
  const [isPractice, setIsPractice] = useState(false);

  // 段位：任务卡尚未开始 → 练习中
  const [started, setStarted] = useState(false);

  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [grading, setGrading] = useState(false);
  const [flyDir, setFlyDir] = useState<0 | 1 | -1>(0); // 1=右飞(记得) -1=左飞(忘了)

  // 连击 & 本轮结果
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [comboBurst, setComboBurst] = useState(false); // ×3/×5 微光触发
  const [results, setResults] = useState<RoundResult[]>([]);

  const load = useCallback(async (practice = false) => {
    setError(false);
    try {
      const url = practice ? "/api/ai/review-card?practice=1" : "/api/ai/review-card";
      const [res, meRes] = await Promise.all([
        fetch(url).then((r) => r.json()),
        fetch("/api/auth/me").then((r) => r.json()),
      ]);
      if (!meRes.data?.user) {
        setNeedLogin(true);
        setCards([]);
        return;
      }
      if (!res.ok) throw new Error();
      setCards((res.data?.cards ?? []) as ReviewCard[]);
      setDueToday(res.data?.dueToday ?? 0);
      setStreakDays(res.data?.streakDays ?? 0);
      setIsPractice(Boolean(res.data?.practice));
      // 重置一轮状态
      setIdx(0);
      setFlipped(false);
      setFlyDir(0);
      setCombo(0);
      setMaxCombo(0);
      setResults([]);
      setStarted(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const current = cards?.[idx];
  const next = cards?.[idx + 1];
  const total = cards?.length ?? 0;
  const reviewed = results.length;
  const done = cards !== null && total > 0 && started && idx >= total;

  // 提交复习结果：更新调度 → 记结果/连击 → 飞出 → 前进
  const grade = useCallback(
    async (remembered: boolean) => {
      if (!current || grading || flipped === false) return;
      setGrading(true);
      setFlyDir(remembered ? 1 : -1);

      // 连击：连续「记得」累加，忘了归零
      let nextCombo = 0;
      setCombo((c) => {
        nextCombo = remembered ? c + 1 : 0;
        setMaxCombo((m) => Math.max(m, nextCombo));
        return nextCombo;
      });
      if (remembered && (nextCombo === 3 || nextCombo === 5 || (nextCombo > 5 && nextCombo % 5 === 0))) {
        setComboBurst(true);
        window.setTimeout(() => setComboBurst(false), 720);
      }

      let nextDueAt: string | null = null;
      try {
        const r = await fetch("/api/ai/review-card", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cardId: current.id, remembered }),
        })
          .then((res) => res.json())
          .catch(() => null);
        nextDueAt = (r?.data?.dueAt as string | undefined) ?? null;
      } catch {
        /* 静默：不阻断练习 */
      }
      track("review_card_grade", { remembered, combo: nextCombo, practice: isPractice });

      const captured = current;
      setResults((rs) => [...rs, { card: captured, remembered, nextDueAt }]);

      // 让飞出动画走一帧再前进（reduced-motion 下即时）
      const advance = () => {
        setFlipped(false);
        setFlyDir(0);
        setIdx((i) => i + 1);
        setGrading(false);
      };
      if (reduce) advance();
      else window.setTimeout(advance, 260);
    },
    [current, grading, flipped, reduce, isPractice],
  );

  // 键盘：← 忘了 / → 记得 / 空格翻面
  useEffect(() => {
    if (!started || done) return;
    function onKey(e: KeyboardEvent) {
      if (e.repeat) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === "ArrowRight" && flipped) {
        e.preventDefault();
        void grade(true);
      } else if (e.key === "ArrowLeft" && flipped) {
        e.preventDefault();
        void grade(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [started, done, flipped, grade]);

  return (
    <div className="space-y-7">
      <TidalReveal>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink4)]">REVIEW · 复习室</div>
            <h1 className="mt-2 text-[26px] font-bold leading-tight text-[var(--ink)]">
              {isPractice ? "加练模式" : "今日复习"}
            </h1>
            <p className="mt-1.5 max-w-[520px] text-[15px] leading-[1.7] text-[var(--ink2)]">
              {isPractice
                ? "提前复习未到期的卡片，趁热打铁把记忆再夯实一层。"
                : "到期的复习卡都在这里。翻面回忆，凭记得或忘了让间隔重复帮你记牢。"}
            </p>
          </div>
          {started && !done && total > 0 && (
            <div className="flex items-center gap-2.5">
              {combo >= 2 && (
                <div
                  className={`mono inline-flex items-center gap-1 rounded-[12px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-3 py-2 text-[13px] font-bold text-[var(--red-ink)] shadow-[var(--card),var(--inner-hi)] ${comboBurst ? "review-combo-pop" : ""}`}
                >
                  <Fire size={15} weight="fill" />×<span key={combo} className="num-pop inline-block">{combo}</span>
                </div>
              )}
              <div className="mono rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-[13px] font-semibold text-[var(--ink2)] shadow-[var(--card),var(--inner-hi)]">
                <span key={idx} className="num-pop inline-block text-[var(--red-ink)]">{Math.min(idx + 1, total)}</span> / {total}
              </div>
            </div>
          )}
        </div>
      </TidalReveal>

      {/* 水位进度线：练习中氛围 */}
      {started && !done && total > 0 && (
        <div className="studio-rise mx-auto max-w-[760px]">
          <WaveProgress value={reviewed / total} height={8} />
        </div>
      )}

      {/* 练习卡区内层居中 760，保持专注；页头/进度随外层 1120 展开 */}
      <div className="mx-auto max-w-[760px]">
      {error ? (
        <ErrorState hint="复习队列加载失败" onRetry={() => void load(isPractice)} />
      ) : cards === null ? (
        <ReviewSkeleton />
      ) : needLogin ? (
        <EmptyTide
          variant="notes"
          description="登录后即可开始今日复习"
          action={<Button href="/login?next=/review">去登录</Button>}
        />
      ) : total === 0 ? (
        <EmptyState onPractice={() => void load(true)} />
      ) : done ? (
        <SettlementState
          results={results}
          maxCombo={maxCombo}
          reduce={Boolean(reduce)}
          onAgain={() => void load(false)}
          onPractice={() => void load(true)}
        />
      ) : !started ? (
        <TaskCard
          dueCount={isPractice ? total : dueToday}
          streakDays={streakDays}
          isPractice={isPractice}
          reduce={Boolean(reduce)}
          onStart={() => {
            setStarted(true);
            track("review_start", { count: total, practice: isPractice });
          }}
        />
      ) : current ? (
        <ReviewStage
          current={current}
          next={next ?? null}
          flipped={flipped}
          grading={grading}
          flyDir={flyDir}
          comboBurst={comboBurst}
          reduce={Boolean(reduce)}
          onFlip={() => setFlipped((f) => !f)}
          onGrade={grade}
        />
      ) : null}
      </div>
    </div>
  );
}

/* ============================================================
   入场：今日任务卡，N 张到期 · 预计 N 分钟 · 连续复习 N 天
   点「开始」牌堆扇形展开进入练习。
   ============================================================ */
function TaskCard({
  dueCount,
  streakDays,
  isPractice,
  reduce,
  onStart,
}: {
  dueCount: number;
  streakDays: number;
  isPractice: boolean;
  reduce: boolean;
  onStart: () => void;
}) {
  const [spread, setSpread] = useState(false);
  const minutes = Math.max(1, Math.round((dueCount * SEC_PER_CARD) / 60));

  function handleStart() {
    if (reduce) {
      onStart();
      return;
    }
    setSpread(true);
    window.setTimeout(onStart, 460); // 扇形展开动效后进入
  }

  // 扇形展开的三张「牌」角度
  const fan = [
    { rot: -9, x: -26, delay: 0 },
    { rot: 0, x: 0, delay: 0.04 },
    { rot: 9, x: 26, delay: 0.08 },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING_TIDE, type: "spring" }}
      className="studio-rise overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card),var(--inner-hi)]"
    >
      {/* 深色展示带：牌堆浮于渐变之上，仪式感入口而非死白平面 */}
      <div
        className="relative flex h-[188px] items-center justify-center overflow-hidden rounded-t-[18px]"
        style={{ background: "var(--video-grad)" }}
      >
        {/* 顶部柔光高光，深色区材质 */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-24"
          style={{ background: "radial-gradient(120% 90% at 50% -20%, rgba(255,255,255,.10), transparent 70%)" }}
          aria-hidden
        />
        {/* 牌堆缩略：静止叠放，开始时扇形展开 */}
        <div className="relative h-[120px] w-[180px]">
          {fan.map((f, i) => (
            <motion.div
              key={i}
              className="absolute inset-0 rounded-[14px] border border-white/10 bg-white/[0.06] shadow-[0_8px_24px_-8px_rgba(0,0,0,.45)] backdrop-blur-[2px]"
              initial={false}
              animate={
                spread
                  ? { rotate: f.rot, x: f.x, y: -8, opacity: 0, scale: 0.92 }
                  : { rotate: (i - 1) * 4, x: (i - 1) * 6, y: (i - 1) * 3, opacity: 1, scale: 1 }
              }
              transition={{ ...SPRING_FIRM, type: "spring", delay: spread ? f.delay : 0 }}
              style={{ transformOrigin: "bottom center", zIndex: 3 - i }}
            >
              <div className="flex h-full items-center justify-center text-white/45">
                <CardsThree size={26} weight="duotone" />
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      <div className="p-8 pt-7">
        <h2 className="text-center text-[20px] font-bold text-[var(--ink)]">
          {isPractice ? "加练队列已就绪" : dueCount > 0 ? "今日待复习" : "今日无到期"}
        </h2>
        <p className="mx-auto mt-2 max-w-[420px] text-center text-[14px] leading-[1.7] text-[var(--ink2)]">
          {isPractice
            ? "这是从未到期卡里抽出的最早 10 张，提前巩固不会打乱调度节奏。"
            : "主动回忆是最有效的记忆方式。准备好了就开始，我们一起把该记的记牢。"}
        </p>

        {/* 三项指标：递延浮现 */}
        <div className="stagger mt-6 grid grid-cols-3 gap-3">
          <TaskStat i={0} icon={<CardsThree size={17} weight="bold" />} value={dueCount} label="张待复习" />
          <TaskStat i={1} icon={<Timer size={17} weight="bold" />} value={minutes} label="分钟 · 预计" />
          <TaskStat
            i={2}
            icon={<Fire size={17} weight="fill" />}
            value={streakDays}
            label="天 · 连续复习"
            highlight={streakDays >= 3}
          />
        </div>

        <button
          type="button"
          onClick={handleStart}
          className="cta-glow studio-press mt-7 flex w-full items-center justify-center gap-2 rounded-[14px] bg-[var(--red)] py-3.5 text-[15px] font-bold text-white transition-colors hover:bg-[var(--red-hover)]"
        >
          <Lightning size={18} weight="fill" /> 开始复习
        </button>
        <p className="mt-3 text-center text-[12px] text-[var(--ink4)]">
          键盘：空格翻面 · <ArrowLeft size={11} className="inline" /> 忘了 · <ArrowRight size={11} className="inline" /> 记得
        </p>
      </div>
    </motion.div>
  );
}

function TaskStat({
  i,
  icon,
  value,
  label,
  highlight,
}: {
  i: number;
  icon: React.ReactNode;
  value: number;
  label: string;
  highlight?: boolean;
}) {
  return (
    <div
      style={{ "--i": i } as React.CSSProperties}
      className={`flex flex-col items-center gap-1 rounded-[14px] border px-2 py-4 text-center shadow-[var(--inner-hi)] ${
        highlight ? "border-[var(--red-soft-border)] bg-[var(--red-soft)]" : "border-[var(--border)] bg-[var(--surface2)]"
      }`}
    >
      <span className={highlight ? "text-[var(--red)]" : "text-[var(--ink3)]"}>{icon}</span>
      <span className="mono text-[22px] font-bold leading-none text-[var(--ink)]">{value}</span>
      <span className="text-[11px] leading-tight text-[var(--ink3)]">{label}</span>
    </div>
  );
}

/* ============================================================
   卡片练习舞台：卡堆视觉(露出下一张) + 3D 翻面 + 评分飞出
   ============================================================ */
function ReviewStage({
  current,
  next,
  flipped,
  grading,
  flyDir,
  comboBurst,
  reduce,
  onFlip,
  onGrade,
}: {
  current: ReviewCard;
  next: ReviewCard | null;
  flipped: boolean;
  grading: boolean;
  flyDir: 0 | 1 | -1;
  comboBurst: boolean;
  reduce: boolean;
  onFlip: () => void;
  onGrade: (remembered: boolean) => void;
}) {
  // 飞出：右飞(记得, +x 上旋) / 左飞(忘了, -x 下旋)
  const exitTransition = reduce
    ? { duration: 0.12 }
    : { ...SPRING_FIRM, type: "spring" as const };

  return (
    <div className="space-y-5">
      <div className="relative">
        {/* 卡堆：下一张露出边缘（在当前卡之后、下方轻微偏移） */}
        {next && !reduce && (
          <motion.div
            aria-hidden
            className="absolute inset-x-0 top-0 -z-0 rounded-[18px] border border-[var(--border)] bg-[var(--surface2)] shadow-[var(--card)]"
            style={{ height: "100%" }}
            initial={false}
            animate={{ y: 12, scale: 0.965, opacity: 0.9 }}
            transition={{ ...SPRING_TIDE, type: "spring" }}
          />
        )}

        {/* 评分后飞出的绿/红轨迹残影 */}
        <AnimatePresence>
          {flyDir !== 0 && !reduce && (
            <motion.div
              key={`trail-${flyDir}`}
              aria-hidden
              className="pointer-events-none absolute inset-0 -z-0 rounded-[18px]"
              style={{
                background:
                  flyDir === 1
                    ? "linear-gradient(90deg, transparent, color-mix(in srgb, var(--ok) 26%, transparent))"
                    : "linear-gradient(270deg, transparent, var(--red-soft))",
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.28 }}
            />
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          <motion.div
            key={current.id}
            className={`relative flip3d ${comboBurst ? "review-combo-glow" : ""}`}
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1, rotate: 0, x: 0 }}
            exit={
              flyDir === 0
                ? { opacity: 0, y: -16, scale: 0.98 }
                : flyDir === 1
                  ? { opacity: 0, x: 460, y: -40, rotate: 16 }
                  : { opacity: 0, x: -460, y: 40, rotate: -16 }
            }
            transition={exitTransition}
          >
            <button
              type="button"
              onClick={onFlip}
              className={`flip3d-inner studio-lift block w-full text-left ${flipped ? "is-flipped" : ""}`}
            >
              {/* 正面 · 问题 */}
              <div className="flip3d-face rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-8 shadow-[var(--card),var(--inner-hi)]">
                <div className="mb-4 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--surface2)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink3)]">
                    问题
                  </span>
                  {current.courseTitle && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-[var(--ink4)]">
                      <BookOpen size={12} /> {current.courseTitle}
                    </span>
                  )}
                </div>
                <div
                  className="tide-md min-h-[92px] text-[18px] font-semibold leading-[1.8] text-[var(--ink)]"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(current.front) }}
                />
                <div className="mt-5 inline-flex items-center gap-1.5 text-[12px] text-[var(--ink4)]">
                  <ArrowsClockwise size={13} /> 点击卡片或按空格翻面看答案
                </div>
              </div>

              {/* 背面 · 答案（3D 预旋 180°） */}
              <div className="flip3d-back rounded-[18px] border border-[var(--red-soft-border)] bg-[var(--surface)] p-8 shadow-[var(--card),var(--inner-hi)]">
                <div className="mb-4 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--red-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--red-ink)]">
                    答案
                  </span>
                  {current.courseTitle && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-[var(--ink4)]">
                      <BookOpen size={12} /> {current.courseTitle}
                    </span>
                  )}
                </div>
                <div
                  className="tide-md min-h-[92px] text-[16px] leading-[1.8] text-[var(--ink)]"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(current.back) }}
                />
                <div className="mt-5 inline-flex items-center gap-1.5 text-[12px] text-[var(--ink4)]">
                  <ArrowsClockwise size={13} /> 用 ← 忘了 / → 记得 评分
                </div>
              </div>
            </button>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* 记得 / 忘了，翻面后才可评分 */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={!flipped || grading}
          onClick={() => onGrade(false)}
          className="studio-press inline-flex items-center justify-center gap-2 rounded-[14px] border border-[var(--warn-soft)] bg-[var(--surface)] py-3.5 text-[14px] font-semibold text-[var(--ink2)] shadow-[var(--card),var(--inner-hi)] transition-colors hover:border-[var(--warn)] hover:text-[var(--warn)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <XCircle size={18} weight="fill" className="text-[var(--warn)]" /> 忘了
          <kbd className="mono ml-1 hidden rounded border border-[var(--border)] px-1 text-[10px] text-[var(--ink4)] sm:inline">←</kbd>
        </button>
        <button
          type="button"
          disabled={!flipped || grading}
          onClick={() => onGrade(true)}
          className="hover-sheen studio-press inline-flex items-center justify-center gap-2 rounded-[14px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] py-3.5 text-[14px] font-semibold text-[var(--red-ink)] shadow-[var(--card),var(--inner-hi)] transition-colors hover:border-[var(--red)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <CheckCircle size={18} weight="fill" /> 记得
          <kbd className="mono ml-1 hidden rounded border border-[var(--red-soft-border)] px-1 text-[10px] text-[var(--red-ink)] sm:inline">→</kbd>
        </button>
      </div>
      {!flipped && (
        <p className="text-center text-[12px] text-[var(--ink4)]">先回忆，再翻面自评。主动回忆才记得牢。</p>
      )}
    </div>
  );
}

/* ============================================================
   结算页：本轮 N 张 · 正确率 · 最难卡 TOP3 · 下次到期预告 · 连击最高 + confetti
   ============================================================ */
function SettlementState({
  results,
  maxCombo,
  reduce,
  onAgain,
  onPractice,
}: {
  results: RoundResult[];
  maxCombo: number;
  reduce: boolean;
  onAgain: () => void;
  onPractice: () => void;
}) {
  const total = results.length;
  const correct = results.filter((r) => r.remembered).length;
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

  // 最难卡：本轮「忘了」的卡（同一张最多出现一次，取前 3）
  const hardest = useMemo(() => results.filter((r) => !r.remembered).map((r) => r.card).slice(0, 3), [results]);

  // 下次到期预告：记得的卡里最近的一次到期
  const nextDue = useMemo(() => {
    const dates = results
      .map((r) => r.nextDueAt)
      .filter((d): d is string => Boolean(d))
      .map((d) => new Date(d))
      .filter((d) => !Number.isNaN(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());
    return dates[0] ?? null;
  }, [results]);

  useEffect(() => {
    track("review_round_complete", { total, correct, accuracy, maxCombo });
  }, [total, correct, accuracy, maxCombo]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING_TIDE, type: "spring" }}
      className="studio-rise relative overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card),var(--inner-hi)]"
    >
      {/* 深色庆祝带：奖章浮于渐变之上，confetti 抛洒其间，仪式收束 */}
      <div
        className="relative flex flex-col items-center overflow-hidden rounded-t-[18px] px-8 pb-7 pt-9 text-center"
        style={{ background: "var(--video-grad)" }}
      >
        {!reduce && <ConfettiLayer />}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-24"
          style={{ background: "radial-gradient(120% 90% at 50% -20%, rgba(255,255,255,.12), transparent 70%)" }}
          aria-hidden
        />
        <motion.div
          initial={reduce ? false : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ ...SPRING_FIRM, type: "spring", delay: 0.08 }}
          className="relative flex h-16 w-16 items-center justify-center rounded-full border border-white/15 bg-[var(--red)] text-white shadow-[var(--red-glow)]"
        >
          <Confetti size={30} weight="fill" />
        </motion.div>
        <h2 className="relative mt-4 text-[20px] font-bold text-white">本轮复习完成</h2>
        <p className="relative mt-1.5 max-w-[440px] text-[14px] leading-[1.7] text-white/70">
          主动回忆一次，记忆就牢一分。坚持每天，间隔重复替你打理长期记忆。
        </p>
      </div>

      <div className="p-8 pt-6">
        {/* 三项指标：递延浮现，正确率用成功绿语义色 */}
        <div className="stagger grid grid-cols-3 gap-3">
          <SettleStat i={0} icon={<CardsThree size={16} weight="bold" />} value={`${total}`} label="本轮张数" />
          <SettleStat i={1} icon={<CheckCircle size={16} weight="fill" />} value={`${accuracy}%`} label="正确率" tone="ok" />
          <SettleStat i={2} icon={<Trophy size={16} weight="fill" />} value={`×${maxCombo}`} label="连击最高" tone={maxCombo >= 3 ? "red" : "muted"} />
        </div>

        {/* 下次到期预告 */}
        {nextDue && (
          <div className="mt-4 flex justify-center">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-[var(--info-soft)] bg-[var(--info-soft)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--info)]">
              <CalendarCheck size={13} />
              下次到期 <span className="mono font-semibold">{formatDue(nextDue)}</span>
            </div>
          </div>
        )}

        {/* 最难卡 TOP3：待复习语义用警示暖色 */}
        {hardest.length > 0 && (
          <div className="mt-6 rounded-[14px] border border-[var(--warn-soft)] bg-[var(--warn-soft)] p-4 text-left shadow-[var(--inner-hi)]">
            <div className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--ink2)]">
              <Star size={14} weight="fill" className="text-[var(--warn)]" /> 最需要再看的 {hardest.length} 张
            </div>
            <ul className="space-y-2">
              {hardest.map((c, i) => (
                <li key={c.id} className="flex items-start gap-2.5">
                  <span className="mono mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full border border-[var(--warn)]/40 bg-[var(--surface)] text-[11px] font-bold text-[var(--ink2)]">
                    {i + 1}
                  </span>
                  <span
                    className="line-clamp-2 text-[13px] leading-[1.6] text-[var(--ink)]"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(c.front) }}
                  />
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] leading-relaxed text-[var(--ink4)]">这些卡已重置为明天再见，明天优先攻克它们。</p>
          </div>
        )}

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onAgain}
            className="studio-press inline-flex items-center gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-[13px] font-semibold text-[var(--ink)] shadow-[var(--card),var(--inner-hi)] transition-colors hover:border-[var(--border2)]"
          >
            <ArrowsClockwise size={15} weight="bold" /> 再检查一遍
          </button>
          <button
            type="button"
            onClick={onPractice}
            className="cta-glow studio-press inline-flex items-center gap-1.5 rounded-[12px] bg-[var(--red)] px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--red-hover)]"
          >
            <Lightning size={15} weight="fill" /> 加练 10 张
          </button>
          {/* 晒成绩：复习收束时晒连续里程碑（streak 服务端按当前用户取 currentStreak/longestStreak） */}
          <SharePanel
            kind="streak"
            title="晒成绩"
            triggerLabel="分享连续学习成绩"
            trigger={
              <span className="studio-press inline-flex items-center gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-[13px] font-semibold text-[var(--ink)] shadow-[var(--card),var(--inner-hi)] transition-colors hover:border-[var(--border2)]">
                <ShareNetwork size={15} weight="bold" /> 晒成绩
              </span>
            }
          />
          <Button href="/notes">回笔记馆</Button>
        </div>
      </div>
    </motion.div>
  );
}

function SettleStat({
  i,
  icon,
  value,
  label,
  tone = "muted",
}: {
  i: number;
  icon: React.ReactNode;
  value: string;
  label: string;
  tone?: "muted" | "ok" | "red";
}) {
  const border =
    tone === "ok" ? "border-[var(--ok-soft)] bg-[var(--ok-soft)]" : tone === "red" ? "border-[var(--red-soft-border)] bg-[var(--red-soft)]" : "border-[var(--border)] bg-[var(--surface2)]";
  const accentInk = tone === "ok" ? "text-[var(--ok)]" : tone === "red" ? "text-[var(--red)]" : "text-[var(--ink3)]";
  return (
    <div
      style={{ "--i": i } as React.CSSProperties}
      className={`flex flex-col items-center gap-1 rounded-[14px] border px-2 py-4 shadow-[var(--inner-hi)] ${border}`}
    >
      <span className={accentInk}>{icon}</span>
      {/* 三个数字统一走 num-pop-seq：按 --i 递延，形成「1…2…3」依次落定，杜绝两跳一静 */}
      <span className="num-pop-seq mono text-[20px] font-bold leading-none text-[var(--ink)]">{value}</span>
      <span className="text-[11px] leading-tight text-[var(--ink3)]">{label}</span>
    </div>
  );
}

/** 一次性 confetti：抛洒后自然消失，reduced-motion 由父层跳过挂载。 */
function ConfettiLayer() {
  const pieces = useRef(
    Array.from({ length: 26 }, (_, i) => {
      // 抛洒于深色庆祝带之上：品牌红 + 成功绿 + 亮白墨点，非彩虹，深底清晰
      const colors = ["var(--red)", "var(--ok)", "rgba(255,255,255,.9)", "rgba(255,255,255,.6)"];
      return {
        left: Math.random() * 100,
        cx: (Math.random() - 0.5) * 220,
        cr: Math.random() * 720 - 360,
        cd: 1.3 + Math.random() * 0.9,
        cdelay: Math.random() * 0.35,
        color: colors[i % colors.length],
        w: 5 + Math.round(Math.random() * 4),
        h: 8 + Math.round(Math.random() * 6),
      };
    }),
  ).current;

  return (
    <div className="confetti-layer" aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={
            {
              left: `${p.left}%`,
              background: p.color,
              width: p.w,
              height: p.h,
              "--cx": `${p.cx}px`,
              "--cr": `${p.cr}deg`,
              "--cd": `${p.cd}s`,
              "--cdelay": `${p.cdelay}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

/* ============================================================
   加载骨架：贴合任务卡布局（深色展示带 + 标题 + 三指标 + 主按钮）
   ============================================================ */
function ReviewSkeleton() {
  return (
    <div className="overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card),var(--inner-hi)]">
      {/* 展示带占位：深色渐变，牌堆轮廓 */}
      <div className="relative flex h-[188px] items-center justify-center overflow-hidden rounded-t-[18px]" style={{ background: "var(--video-grad)" }}>
        <div className="h-[120px] w-[180px] rounded-[14px] border border-white/10 bg-white/[0.05]" />
      </div>
      <div className="p-8 pt-7">
        <div className="mx-auto skeleton h-5 w-40" />
        <div className="mx-auto mt-3 skeleton h-3.5 w-[68%]" />
        <div className="mx-auto mt-2 skeleton h-3.5 w-[52%]" />
        <div className="mt-6 grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col items-center gap-2 rounded-[14px] border border-[var(--border)] bg-[var(--surface2)] px-2 py-4">
              <div className="skeleton h-4 w-4 rounded-full" />
              <div className="skeleton h-5 w-8" />
              <div className="skeleton h-2.5 w-12" />
            </div>
          ))}
        </div>
        <div className="skeleton mt-7 h-12 w-full rounded-[14px]" />
      </div>
    </div>
  );
}

/* ============================================================
   空态：今日无到期，加练 10 张（从未到期卡抽最早 10 张）
   ============================================================ */
function EmptyState({ onPractice }: { onPractice: () => void }) {
  return (
    <EmptyTide
      variant="review"
      description="今日无到期的复习卡。想趁热打铁？加练 10 张提前巩固，或去笔记馆生成新卡。"
      action={
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onPractice}
            className="hover-sheen studio-press inline-flex items-center gap-1.5 rounded-[12px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-4 py-2.5 text-[13px] font-semibold text-[var(--red-ink)] shadow-[var(--card),var(--inner-hi)] transition-colors hover:border-[var(--red)]"
          >
            <Lightning size={15} weight="fill" /> 加练 10 张
          </button>
          <Button href="/notes">去笔记馆</Button>
        </div>
      }
    />
  );
}

/** 到期日友好格式：今天 / 明天 / N 天后 / M月D日 */
function formatDue(d: Date): string {
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000);
  if (diffDays <= 0) return "今天";
  if (diffDays === 1) return "明天";
  if (diffDays <= 7) return `${diffDays} 天后`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
