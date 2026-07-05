"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CheckCircle,
  XCircle,
  Confetti,
  BookOpen,
  Cards,
  Exam as ExamIcon,
  CircleNotch,
  Sparkle,
  ShareNetwork,
  Gauge,
  ListChecks,
  Lightning,
  Timer,
  Feather,
  PencilSimpleLine,
  Trophy,
  SealCheck,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { SharePanel } from "@/components/SharePanel";
import { SPRING_TIDE, SPRING_FIRM, WaveProgress, ArchiveStamp } from "@/components/motion";
import { renderMarkdown } from "@/lib/markdown";
import { track } from "@/lib/analytics-client";

/* ============ 类型 ============ */
type ScopeType = "course" | "notebook" | "all";
type QType = "single" | "judge" | "short";

interface ScopeOption {
  id: string;
  title: string;
  meta?: string;
}

interface ReviewQuestion {
  id: string;
  type: QType;
  stem: string;
  options: string[] | null;
  answer: string; // single=索引 / judge=true|false / short=参考答案
  explanation: string | null;
  sourceRef: string | null;
  userAnswer: string;
  correct: boolean;
  score: number;
  max: number;
  comment: string | null;
}

interface ExamPaper {
  examId: string;
  title: string;
  questions: {
    id: string;
    type: QType;
    stem: string;
    options: string[] | null;
  }[];
}

interface Report {
  attemptId: string;
  examTitle: string;
  score: number;
  total: number;
  review: ReviewQuestion[];
}

type Phase = "form" | "taking" | "report";

const JUDGE_OPTIONS = [
  { value: "true", label: "正确" },
  { value: "false", label: "错误" },
];

/**
 * 复习室 · 引擎B —— 模拟考试全流程承载（v3.1 视觉深度重设计，对标复习室高规格）：
 *   出卷（准备考试仪式感）→ 生成 → 答题（题目卡堆 + 波浪进度 + 计时器 + 语义色选项）
 *   → 交卷（阅卷中过渡）→ 成绩单（分数揭晓 + confetti + 错题溯源到「第 N 讲」+ 错题转复习卡 + 分享）。
 * page 仅负责 Tab 切换并挂载本组件，主逻辑集中在此，减少与协作 agent 的改动冲突。
 * 所有 API 调用 / 状态机 / 数据契约一律不动，仅把 UI 从「简陋」提到复习室的设计规格。
 */
export default function ExamRunner({ needLogin }: { needLogin: boolean }) {
  const [phase, setPhase] = useState<Phase>("form");

  // —— 表单态 ——
  const [scopeType, setScopeType] = useState<ScopeType>("all");
  const [courses, setCourses] = useState<ScopeOption[]>([]);
  const [notebooks, setNotebooks] = useState<ScopeOption[]>([]);
  const [scopeId, setScopeId] = useState<string>("");
  const [count, setCount] = useState<number>(5);
  const [difficulty, setDifficulty] = useState<"basic" | "advanced">("basic");
  const [generating, setGenerating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // —— 答题态 ——
  const [paper, setPaper] = useState<ExamPaper | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  // 本卷起考时间戳，供答题计时器（真实考试环境感，仅展示不参与判分）
  const [startedAt, setStartedAt] = useState<number | null>(null);

  // —— 成绩单态 ——
  const [report, setReport] = useState<Report | null>(null);

  // 拉取可选范围（课程 = 最近学习的课；笔记本 = 本人笔记本）
  useEffect(() => {
    if (needLogin) return;
    void (async () => {
      try {
        const [pRes, nRes] = await Promise.all([
          fetch("/api/progress").then((r) => r.json()),
          fetch("/api/notebooks").then((r) => r.json()),
        ]);
        const seen = new Set<string>();
        const cs: ScopeOption[] = [];
        for (const p of (pRes.data?.progress ?? []) as { course?: { id: string; title: string } }[]) {
          const c = p.course;
          if (c && !seen.has(c.id)) {
            seen.add(c.id);
            cs.push({ id: c.id, title: c.title });
          }
        }
        setCourses(cs);
        setNotebooks(
          ((nRes.data?.notebooks ?? []) as { id: string; title: string; noteCount: number }[]).map((n) => ({
            id: n.id,
            title: n.title,
            meta: `${n.noteCount} 条笔记`,
          })),
        );
      } catch {
        /* 范围加载失败不阻塞，表单仍可用（切到「综合」出卷）*/
      }
    })();
  }, [needLogin]);

  const scopeOptions = scopeType === "course" ? courses : scopeType === "notebook" ? notebooks : [];

  async function generate() {
    if (generating) return;
    setFormError(null);
    if ((scopeType === "course" || scopeType === "notebook") && !scopeId) {
      setFormError(scopeType === "course" ? "请选择一门课程" : "请选择一个笔记本");
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/ai/generate-exam", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scopeType,
          scopeId: scopeType === "all" ? undefined : scopeId,
          count,
          difficulty,
        }),
      }).then((r) => r.json());
      if (!res.ok) {
        setFormError(res.error || "出题失败，请稍后重试");
        return;
      }
      track("exam_generate", { scopeType, count, difficulty });
      await loadPaper(res.data.examId);
    } catch {
      setFormError("网络异常，请稍后重试");
    } finally {
      setGenerating(false);
    }
  }

  // 拉取试卷题目（不含答案），进入答题
  const loadPaper = useCallback(async (examId: string) => {
    const res = await fetch(`/api/exams/${examId}`).then((r) => r.json());
    if (!res.ok) {
      setFormError(res.error || "试卷加载失败");
      return;
    }
    setPaper(res.data as ExamPaper);
    setAnswers({});
    setCursor(0);
    setStartedAt(Date.now());
    setPhase("taking");
  }, []);

  async function submit() {
    if (!paper || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/exams/${paper.examId}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers }),
      }).then((r) => r.json());
      if (!res.ok) {
        setFormError(res.error || "判卷失败，请稍后重试");
        return;
      }
      track("exam_submit", { examId: paper.examId });
      setReport(res.data as Report);
      setPhase("report");
    } catch {
      setFormError("网络异常，判卷失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setPhase("form");
    setPaper(null);
    setReport(null);
    setAnswers({});
    setCursor(0);
    setStartedAt(null);
    setFormError(null);
  }

  if (needLogin) {
    return (
      <div className="studio-rise flex flex-col items-center gap-4 rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-10 text-center shadow-[var(--card),var(--inner-hi)]">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--surface2)] text-[var(--ink3)]">
          <ExamIcon size={26} />
        </div>
        <p className="text-[15px] leading-[1.7] text-[var(--ink2)]">登录后即可用你学过的内容生成模拟考试</p>
        <Button href="/login?next=/review">去登录</Button>
      </div>
    );
  }

  return (
    <div>
      <AnimatePresence mode="wait">
        {phase === "form" && (
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ ...SPRING_TIDE, type: "spring" }}
          >
            <ExamForm
              scopeType={scopeType}
              setScopeType={(t) => {
                setScopeType(t);
                setScopeId("");
                setFormError(null);
              }}
              scopeOptions={scopeOptions}
              scopeId={scopeId}
              setScopeId={setScopeId}
              count={count}
              setCount={setCount}
              difficulty={difficulty}
              setDifficulty={setDifficulty}
              generating={generating}
              error={formError}
              onGenerate={generate}
            />
          </motion.div>
        )}

        {phase === "taking" && paper && (
          <motion.div
            key="taking"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ ...SPRING_TIDE, type: "spring" }}
          >
            <ExamTaking
              paper={paper}
              answers={answers}
              setAnswer={(qid, val) => setAnswers((a) => ({ ...a, [qid]: val }))}
              cursor={cursor}
              setCursor={setCursor}
              startedAt={startedAt}
              submitting={submitting}
              onSubmit={submit}
              error={formError}
            />
          </motion.div>
        )}

        {phase === "report" && report && (
          <motion.div
            key="report"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ ...SPRING_TIDE, type: "spring" }}
          >
            <ExamReport report={report} examId={paper?.examId ?? null} onRetake={reset} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ============================================================
   出卷表单：准备考试的仪式感——深色展示带 + 范围/题量/难度精致选择 + 「开始考试」入场。
   ============================================================ */
function ExamForm({
  scopeType,
  setScopeType,
  scopeOptions,
  scopeId,
  setScopeId,
  count,
  setCount,
  difficulty,
  setDifficulty,
  generating,
  error,
  onGenerate,
}: {
  scopeType: ScopeType;
  setScopeType: (t: ScopeType) => void;
  scopeOptions: ScopeOption[];
  scopeId: string;
  setScopeId: (id: string) => void;
  count: number;
  setCount: (n: number) => void;
  difficulty: "basic" | "advanced";
  setDifficulty: (d: "basic" | "advanced") => void;
  generating: boolean;
  error: string | null;
  onGenerate: () => void;
}) {
  const reduce = useReducedMotion();
  const SCOPES: { value: ScopeType; label: string; hint: string }[] = [
    { value: "all", label: "综合", hint: "最近学过的课" },
    { value: "course", label: "按课程", hint: "选一门课" },
    { value: "notebook", label: "按笔记本", hint: "选一个笔记本" },
  ];
  const needPick = scopeType === "course" || scopeType === "notebook";
  // 预计时长：客观题约 45s/题，给准备阶段一个真实的心理预期
  const estMin = Math.max(1, Math.round((count * 45) / 60));

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING_TIDE, type: "spring" }}
      className="studio-rise overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card),var(--inner-hi)]"
    >
      {/* 深色展示带：准考证式入口，把「出一套模拟考」提为一场仪式而非死白表单 */}
      <div
        className="relative flex flex-col items-center overflow-hidden rounded-t-[18px] px-8 pb-7 pt-9 text-center"
        style={{ background: "var(--video-grad)" }}
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-24"
          style={{ background: "radial-gradient(120% 90% at 50% -20%, rgba(255,255,255,.12), transparent 70%)" }}
          aria-hidden
        />
        <motion.div
          initial={reduce ? false : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ ...SPRING_FIRM, type: "spring", delay: 0.06 }}
          className="relative flex h-16 w-16 items-center justify-center rounded-full border border-white/15 bg-[var(--red)] text-white shadow-[var(--red-glow)]"
        >
          <ExamIcon size={30} weight="fill" />
        </motion.div>
        <div className="relative mono mt-4 text-[10px] uppercase tracking-[0.18em] text-[var(--ink-on-dark-3)]">
          MOCK EXAM · 模拟考场
        </div>
        <h2 className="relative mt-1.5 text-[21px] font-bold text-white">准备考试</h2>
        <p className="relative mt-1.5 max-w-[440px] text-[13.5px] leading-[1.7] text-[var(--ink-on-dark-2)]">
          用你学过的内容，AI 现场命题。挑好范围与难度，进考场一气呵成。
        </p>
      </div>

      <div className="p-7 pt-6">
        {/* 范围 */}
        <div className="mb-5">
          <label className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--ink3)]">
            <ListChecks size={13} weight="bold" /> 出题范围
          </label>
          <div className="grid grid-cols-3 gap-2.5">
            {SCOPES.map((s) => {
              const active = scopeType === s.value;
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setScopeType(s.value)}
                  aria-pressed={active}
                  className={`studio-press min-h-[62px] rounded-[12px] border px-3 py-3 text-center transition-colors ${
                    active
                      ? "border-[var(--red-soft-border)] bg-[var(--red-soft)] shadow-[var(--inner-hi)]"
                      : "border-[var(--border)] bg-[var(--surface2)] hover:border-[var(--border2)]"
                  }`}
                >
                  <div className={`text-[13.5px] font-semibold ${active ? "text-[var(--red-ink)]" : "text-[var(--ink2)]"}`}>
                    {s.label}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--ink4)]">{s.hint}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 具体范围选择器 */}
        <AnimatePresence initial={false}>
          {needPick && (
            <motion.div
              key="picker"
              initial={reduce ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
              transition={{ duration: 0.24 }}
              className="overflow-hidden"
            >
              <div className="mb-5">
                <label className="mb-2 block text-[12px] font-semibold text-[var(--ink3)]">
                  {scopeType === "course" ? "选择课程" : "选择笔记本"}
                </label>
                {scopeOptions.length === 0 ? (
                  <div className="rounded-[12px] border border-dashed border-[var(--border2)] bg-[var(--surface-inset)] px-4 py-4 text-[13px] text-[var(--ink3)]">
                    {scopeType === "course" ? "暂无学习记录，先去学几节课。" : "还没有笔记本，去笔记馆建一个。"}
                  </div>
                ) : (
                  <div className="grid max-h-[220px] gap-2 overflow-y-auto pr-0.5">
                    {scopeOptions.map((o) => {
                      const active = scopeId === o.id;
                      return (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => setScopeId(o.id)}
                          aria-pressed={active}
                          className={`studio-press flex min-h-[48px] items-center justify-between gap-3 rounded-[12px] border px-4 py-3 text-left transition-colors ${
                            active
                              ? "border-[var(--red-soft-border)] bg-[var(--red-soft)] shadow-[var(--inner-hi)]"
                              : "border-[var(--border)] bg-[var(--surface2)] hover:border-[var(--border2)]"
                          }`}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                                active ? "border-[var(--red)] bg-[var(--red)] text-white" : "border-[var(--border2)]"
                              }`}
                            >
                              {active && <CheckCircle size={11} weight="fill" />}
                            </span>
                            <span
                              className={`truncate text-[13.5px] font-semibold ${
                                active ? "text-[var(--red-ink)]" : "text-[var(--ink2)]"
                              }`}
                            >
                              {o.title}
                            </span>
                          </span>
                          {o.meta && <span className="shrink-0 text-[11.5px] text-[var(--ink4)]">{o.meta}</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 题量 + 难度 */}
        <div className="mb-5 grid grid-cols-2 gap-5">
          <div>
            <label className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--ink3)]">
              <Feather size={13} weight="bold" /> 题量
            </label>
            <div className="flex gap-2">
              {[5, 10, 15].map((n) => {
                const active = count === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCount(n)}
                    aria-pressed={active}
                    className={`studio-press mono min-h-[44px] flex-1 rounded-[12px] border text-[14px] font-semibold transition-colors ${
                      active
                        ? "border-[var(--red-soft-border)] bg-[var(--red-soft)] text-[var(--red-ink)] shadow-[var(--inner-hi)]"
                        : "border-[var(--border)] bg-[var(--surface2)] text-[var(--ink2)] hover:border-[var(--border2)]"
                    }`}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--ink3)]">
              <Gauge size={13} weight="bold" /> 难度
            </label>
            <div className="flex gap-2">
              {([
                { v: "basic", l: "基础" },
                { v: "advanced", l: "进阶" },
              ] as const).map((d) => {
                const active = difficulty === d.v;
                return (
                  <button
                    key={d.v}
                    type="button"
                    onClick={() => setDifficulty(d.v)}
                    aria-pressed={active}
                    className={`studio-press min-h-[44px] flex-1 rounded-[12px] border text-[13.5px] font-semibold transition-colors ${
                      active
                        ? "border-[var(--red-soft-border)] bg-[var(--red-soft)] text-[var(--red-ink)] shadow-[var(--inner-hi)]"
                        : "border-[var(--border)] bg-[var(--surface2)] text-[var(--ink2)] hover:border-[var(--border2)]"
                    }`}
                  >
                    {d.l}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 考前速览：本场规格一览，给准备阶段的确定感 */}
        <div className="mb-6 flex items-center justify-center gap-2 rounded-[12px] border border-[var(--border)] bg-[var(--surface2)] px-4 py-3 text-[12.5px] text-[var(--ink2)] shadow-[var(--inner-hi)]">
          <ExamIcon size={14} weight="fill" className="text-[var(--red)]" />
          <span>
            本场 <span className="mono font-bold text-[var(--ink)]">{count}</span> 题
          </span>
          <span className="text-[var(--ink4)]">·</span>
          <span>{difficulty === "advanced" ? "进阶" : "基础"}难度</span>
          <span className="text-[var(--ink4)]">·</span>
          <span className="inline-flex items-center gap-1">
            <Timer size={13} /> 约 <span className="mono font-bold text-[var(--ink)]">{estMin}</span> 分钟
          </span>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-[12px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-4 py-2.5 text-[13px] text-[var(--red-ink)]">
            <XCircle size={15} weight="fill" /> {error}
          </div>
        )}

        <button
          type="button"
          onClick={onGenerate}
          disabled={generating}
          className="cta-glow studio-press flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[14px] bg-[var(--red)] text-[15px] font-bold text-white transition-colors hover:bg-[var(--red-hover)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {generating ? (
            <>
              <CircleNotch size={18} className="animate-spin" /> AI 命题中…
            </>
          ) : (
            <>
              <Lightning size={18} weight="fill" /> 进入考场
            </>
          )}
        </button>
        <p className="mt-3 text-center text-[11.5px] text-[var(--ink4)]">AI 依据材料现场命题，约消耗少量积分</p>
      </div>
    </motion.div>
  );
}

/* ============================================================
   答题（一题一屏 · 卡堆推进）：顶部波浪进度 + 计时器 + 题目卡堆 + 语义色选项。
   ============================================================ */
function ExamTaking({
  paper,
  answers,
  setAnswer,
  cursor,
  setCursor,
  startedAt,
  submitting,
  onSubmit,
  error,
}: {
  paper: ExamPaper;
  answers: Record<string, string>;
  setAnswer: (qid: string, val: string) => void;
  cursor: number;
  setCursor: (n: number) => void;
  startedAt: number | null;
  submitting: boolean;
  onSubmit: () => void;
  error: string | null;
}) {
  const reduce = useReducedMotion();
  const total = paper.questions.length;
  const q = paper.questions[cursor];
  const nextQ = paper.questions[cursor + 1] ?? null;
  const isLast = cursor >= total - 1;
  const answeredCount = useMemo(
    () => paper.questions.filter((x) => (answers[x.id] ?? "").trim() !== "").length,
    [paper.questions, answers],
  );
  const current = answers[q.id] ?? "";
  // 进度以「当前题序」为水位，走到最后一题即满，配合波浪进度的氛围
  const progress = total > 0 ? (cursor + 1) / total : 0;
  // 卡片推进方向：正向/回退，驱动卡堆的进/退动画（reduce 下无位移）
  const [dir, setDir] = useState<1 | -1>(1);
  const go = useCallback(
    (n: number) => {
      setDir(n > cursor ? 1 : -1);
      setCursor(Math.max(0, Math.min(total - 1, n)));
    },
    [cursor, setCursor, total],
  );

  return (
    <div className="space-y-5">
      {/* 考场状态条：计时器 + 已答统计（真实考试环境感） */}
      <div className="flex items-center justify-between gap-3">
        <ExamTimer startedAt={startedAt} />
        <div className="mono inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3.5 py-1.5 text-[12px] font-semibold text-[var(--ink2)] shadow-[var(--card),var(--inner-hi)]">
          <ListChecks size={13} weight="bold" className="text-[var(--ink3)]" />
          已答 <span className="text-[var(--red-ink)]">{answeredCount}</span>
          <span className="text-[var(--ink4)]">/ {total}</span>
        </div>
      </div>

      {/* 顶部波浪进度：复用复习室 WaveProgress，题序即水位 */}
      <div className="space-y-2">
        <WaveProgress value={progress} height={8} />
        {/* 题号索引：小圆点导航（已答实心 / 当前拉长 / 未答描边），可跳题 */}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {paper.questions.map((x, i) => {
            const answered = (answers[x.id] ?? "").trim() !== "";
            const isCur = i === cursor;
            return (
              <button
                key={x.id}
                type="button"
                onClick={() => go(i)}
                aria-label={`第 ${i + 1} 题${answered ? "（已答）" : ""}`}
                aria-current={isCur ? "true" : undefined}
                className={`relative h-2.5 rounded-full transition-all before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] ${
                  isCur
                    ? "w-6 bg-[var(--red)]"
                    : answered
                      ? "w-2.5 bg-[var(--ink3)]"
                      : "w-2.5 bg-[var(--surface2)] ring-1 ring-inset ring-[var(--border)]"
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* 题目卡堆：下一题露出边缘，当前题按方向进/退，像复习室卡堆逐题推进 */}
      <div className="relative">
        {nextQ && !reduce && (
          <motion.div
            aria-hidden
            className="absolute inset-x-0 top-0 -z-0 rounded-[18px] border border-[var(--border)] bg-[var(--surface2)] shadow-[var(--card)]"
            style={{ height: "100%" }}
            initial={false}
            animate={{ y: 12, scale: 0.965, opacity: 0.9 }}
            transition={{ ...SPRING_TIDE, type: "spring" }}
          />
        )}

        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={q.id}
            custom={dir}
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: dir * 40, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: dir * -40, scale: 0.98 }}
            transition={reduce ? { duration: 0.12 } : { ...SPRING_TIDE, type: "spring" }}
            className="studio-rise relative rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-7 shadow-[var(--card),var(--inner-hi)]"
          >
            <div className="mb-4 flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--red-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--red-ink)]">
                <QTypeIcon type={q.type} /> {qTypeLabel(q.type)}
              </span>
              <span className="mono text-[11px] text-[var(--ink4)]">
                第 {cursor + 1} / {total} 题
              </span>
              {current.trim() !== "" && (
                <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--ok)]">
                  <CheckCircle size={13} weight="fill" /> 已作答
                </span>
              )}
            </div>

            <div
              className="tide-md mb-5 text-[17px] font-semibold leading-[1.8] text-[var(--ink)]"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(q.stem) }}
            />

            {/* 作答区 */}
            {q.type === "short" ? (
              <textarea
                value={current}
                onChange={(e) => setAnswer(q.id, e.target.value)}
                rows={5}
                placeholder="写下你的答案…"
                className="w-full resize-y rounded-[12px] border border-[var(--border)] bg-[var(--surface-inset)] px-4 py-3 text-[15px] leading-[1.7] text-[var(--ink)] outline-none transition-[color,border-color,box-shadow] placeholder:text-[var(--ink4)] focus:border-[var(--red)] focus:shadow-[0_0_0_3px_var(--red-soft)]"
              />
            ) : (
              <div className="space-y-2.5">
                {(q.type === "judge"
                  ? JUDGE_OPTIONS
                  : (q.options ?? []).map((label, i) => ({ value: String(i), label }))
                ).map((opt, i) => {
                  const selected = current === opt.value;
                  const glyph = q.type === "judge" ? (opt.value === "true" ? "✓" : "✕") : String.fromCharCode(65 + i);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setAnswer(q.id, opt.value)}
                      aria-pressed={selected}
                      className={`studio-press flex w-full items-center gap-3 rounded-[12px] border px-4 py-3.5 text-left transition-colors ${
                        selected
                          ? "border-[var(--red-soft-border)] bg-[var(--red-soft)] shadow-[var(--inner-hi)]"
                          : "border-[var(--border)] bg-[var(--surface2)] hover:border-[var(--border2)]"
                      }`}
                    >
                      <span
                        className={`mono flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[12px] font-bold transition-colors ${
                          selected
                            ? "border-[var(--red)] bg-[var(--red)] text-white"
                            : "border-[var(--border2)] bg-[var(--surface)] text-[var(--ink3)]"
                        }`}
                      >
                        {glyph}
                      </span>
                      <span
                        className={`text-[14.5px] leading-[1.6] ${selected ? "text-[var(--red-ink)]" : "text-[var(--ink2)]"}`}
                      >
                        {opt.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-[12px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-4 py-2.5 text-[13px] text-[var(--red-ink)]">
          <XCircle size={15} weight="fill" /> {error}
        </div>
      )}

      {/* 导航 */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={cursor === 0}
          onClick={() => go(cursor - 1)}
          className="studio-press inline-flex min-h-[48px] items-center gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 text-[14px] font-semibold text-[var(--ink2)] shadow-[var(--card),var(--inner-hi)] transition-colors hover:border-[var(--border2)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowLeft size={16} weight="bold" /> 上一题
        </button>
        {isLast ? (
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            className="cta-glow studio-press inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-[12px] bg-[var(--red)] px-4 text-[14px] font-bold text-white transition-colors hover:bg-[var(--red-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <>
                <CircleNotch size={16} className="animate-spin" /> 阅卷中…
              </>
            ) : (
              <>
                <SealCheck size={17} weight="fill" /> 交卷（已答 {answeredCount}/{total}）
              </>
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => go(cursor + 1)}
            className="studio-press inline-flex min-h-[48px] flex-1 items-center justify-center gap-1.5 rounded-[12px] bg-[var(--red)] px-4 text-[14px] font-semibold text-white shadow-[var(--card)] transition-colors hover:bg-[var(--red-hover)]"
          >
            下一题 <ArrowRight size={16} weight="bold" />
          </button>
        )}
      </div>
    </div>
  );
}

/** 答题计时器：从起考累加 mm:ss（真实考试环境感，纯展示不参与判分）。reduce-motion 无关，秒进即可。 */
function ExamTimer({ startedAt }: { startedAt: number | null }) {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (startedAt == null) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [startedAt]);
  const elapsed = startedAt == null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return (
    <div className="mono inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3.5 py-1.5 text-[12px] font-semibold text-[var(--ink2)] shadow-[var(--card),var(--inner-hi)]">
      <Timer size={13} weight="bold" className="text-[var(--red)]" />
      <span className="tabular-nums">
        {mm}:{ss}
      </span>
    </div>
  );
}

/* ============================================================
   成绩单：分数揭晓动画 + confetti（及格庆祝）+ 错题溯源 + 错题转复习卡 + 分享。
   ============================================================ */
function ExamReport({ report, examId, onRetake }: { report: Report; examId: string | null; onRetake: () => void }) {
  const reduce = useReducedMotion();
  const pct = report.total > 0 ? Math.round((report.score / report.total) * 100) : 0;
  const wrong = report.review.filter((r) => !r.correct);
  const [carding, setCarding] = useState(false);
  const [cardMsg, setCardMsg] = useState<string | null>(null);

  const passed = pct >= 60;
  const tone = pct >= 80 ? "good" : pct >= 60 ? "mid" : "low";

  // 分数揭晓：从 0 弹到实际百分比（reduce 下直接终值）
  const [shownPct, setShownPct] = useState(reduce ? pct : 0);
  useEffect(() => {
    if (reduce) {
      setShownPct(pct);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const dur = 900;
    const tick = (t: number) => {
      const p = Math.min((t - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setShownPct(Math.round(pct * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pct, reduce]);

  // 错题转复习卡：正面=题干，背面=正解+解析（走 review-card 单卡落库）
  async function makeCards() {
    if (carding || wrong.length === 0) return;
    setCarding(true);
    setCardMsg(null);
    try {
      let done = 0;
      for (const w of wrong) {
        const back = buildCardBack(w);
        const res = await fetch("/api/ai/review-card", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ front: stripMd(w.stem), back }),
        }).then((r) => r.json());
        if (res.ok) done += 1;
      }
      track("exam_wrong_to_cards", { count: done });
      setCardMsg(done > 0 ? `已把 ${done} 道错题加入复习卡` : "复习卡生成失败，请稍后重试");
    } catch {
      setCardMsg("网络异常，请稍后重试");
    } finally {
      setCarding(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* 总分卡：深色庆祝带 + 分数揭晓环 + confetti（及格），仪式收束 */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...SPRING_TIDE, type: "spring" }}
        className="studio-rise relative overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card),var(--inner-hi)]"
      >
        <div
          className="relative flex flex-col items-center overflow-hidden rounded-t-[18px] px-8 pb-7 pt-9 text-center"
          style={{ background: "var(--video-grad)" }}
        >
          {passed && !reduce && <ConfettiLayer />}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-24"
            style={{ background: "radial-gradient(120% 90% at 50% -20%, rgba(255,255,255,.12), transparent 70%)" }}
            aria-hidden
          />

          {/* 分数揭晓环：SVG 进度环随分数弹起，环心是百分比 */}
          <ScoreRing pct={shownPct} tone={tone} reduce={Boolean(reduce)} />

          <div className="relative mt-4 flex items-center justify-center gap-2.5">
            <h2 className="text-[20px] font-bold text-white">
              {tone === "good" ? "考得漂亮" : tone === "mid" ? "顺利通过" : "还需再练"}
            </h2>
            {passed && <ArchiveStamp active={!reduce} label="已通过" className="!border-white/80 !text-white" />}
          </div>
          <p className="relative mt-1.5 max-w-[440px] text-[13.5px] leading-[1.7] text-[var(--ink-on-dark-2)]">
            {report.examTitle} · 共 {report.review.length} 题 ·{" "}
            <span className="mono font-semibold text-white">
              {report.score}/{report.total}
            </span>{" "}
            分
            {wrong.length > 0 ? (
              <>
                ，答错 <span className="font-bold text-[var(--red-ink)]">{wrong.length}</span> 题
              </>
            ) : (
              "，全部答对"
            )}
          </p>
        </div>

        {/* 行动区：错题转复习卡 + 再来一套 + 分享成绩 */}
        <div className="flex flex-wrap items-center justify-center gap-3 p-7 pt-6">
          {wrong.length > 0 && (
            <button
              type="button"
              onClick={makeCards}
              disabled={carding}
              className="hover-sheen studio-press inline-flex min-h-[44px] items-center gap-1.5 rounded-[12px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-4 text-[13px] font-semibold text-[var(--red-ink)] shadow-[var(--card),var(--inner-hi)] transition-colors hover:border-[var(--red)] disabled:opacity-50"
            >
              {carding ? <CircleNotch size={15} className="animate-spin" /> : <Cards size={15} weight="fill" />}
              错题加入复习
            </button>
          )}
          <button
            type="button"
            onClick={onRetake}
            className="studio-press inline-flex min-h-[44px] items-center gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 text-[13px] font-semibold text-[var(--ink)] shadow-[var(--card),var(--inner-hi)] transition-colors hover:border-[var(--border2)]"
          >
            <Sparkle size={15} weight="fill" /> 再来一套
          </button>
          {/* 分享成绩：生成模拟考成绩单图（exam-result 服务端按 examId + 当前用户取最近一次 attempt） */}
          {examId && (
            <SharePanel
              kind="exam-result"
              title="分享成绩"
              params={{ examId }}
              triggerLabel="分享考试成绩"
              trigger={
                <span className="studio-press inline-flex min-h-[44px] items-center gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 text-[13px] font-semibold text-[var(--ink)] shadow-[var(--card),var(--inner-hi)] transition-colors hover:border-[var(--border2)]">
                  <ShareNetwork size={15} weight="bold" /> 分享成绩
                </span>
              }
            />
          )}
          {cardMsg && <p className="w-full text-center text-[12.5px] text-[var(--ink3)]">{cardMsg}</p>}
        </div>
      </motion.div>

      {/* 错题优先：先集中呈现错题 + 溯源，再是全卷回顾 */}
      {wrong.length > 0 && (
        <div className="rounded-[16px] border border-[var(--warn-soft)] bg-[var(--warn-soft)] p-5 shadow-[var(--inner-hi)]">
          <div className="mb-3 flex items-center gap-1.5 text-[13px] font-bold text-[var(--ink)]">
            <Trophy size={15} weight="fill" className="text-[var(--warn)]" /> 本卷 {wrong.length} 道错题 · 溯源攻克
          </div>
          <p className="text-[12px] leading-relaxed text-[var(--ink3)]">
            每道错题标注来源，点「来自第 N 讲」可回到原处重看；也可一键把它们全部加入复习卡，明天巩固。
          </p>
        </div>
      )}

      {/* 逐题回顾（错题在上、答对在下，错题带醒目描边 + 溯源可点回） */}
      <div className="space-y-3">
        <h3 className="flex items-center gap-1.5 text-[14px] font-bold text-[var(--ink)]">
          <ListChecks size={15} weight="bold" className="text-[var(--ink3)]" /> 逐题回顾
        </h3>
        {orderReview(report.review).map((r, i) => (
          <ReviewCardItem key={r.id} q={r} index={r.__origIndex} order={i} />
        ))}
      </div>
    </div>
  );
}

/** 分数揭晓环：SVG 进度环随分数扫出，环心百分比 num-pop 落定。reduce 下直接终态。 */
function ScoreRing({ pct, tone, reduce }: { pct: number; tone: "good" | "mid" | "low"; reduce: boolean }) {
  const R = 34;
  const C = 2 * Math.PI * R;
  const ringColor = tone === "good" ? "var(--ok)" : tone === "mid" ? "var(--info)" : "var(--red)";
  return (
    <div className="relative flex h-[92px] w-[92px] items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 80 80" aria-hidden>
        <circle cx="40" cy="40" r={R} fill="none" stroke="rgba(255,255,255,.16)" strokeWidth="7" />
        <motion.circle
          cx="40"
          cy="40"
          r={R}
          fill="none"
          stroke={ringColor}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={C}
          initial={reduce ? false : { strokeDashoffset: C }}
          animate={{ strokeDashoffset: C * (1 - pct / 100) }}
          transition={reduce ? { duration: 0 } : { ...SPRING_TIDE, type: "spring", delay: 0.1 }}
        />
      </svg>
      <div className="relative flex items-center justify-center">
        {tone === "good" ? (
          <span className="absolute -top-[38px] text-white/90">
            <Confetti size={20} weight="fill" />
          </span>
        ) : null}
        <span className={`mono text-[28px] font-bold leading-none text-white ${reduce ? "" : "num-pop"}`} key={pct}>
          {pct}
          <span className="text-[15px] text-[var(--ink-on-dark-2)]">%</span>
        </span>
      </div>
    </div>
  );
}

/* ============================================================
   成绩单 · 逐题项：错题醒目描边 + 你的作答/正确答案对照 + 解析 + 溯源可点回原处。
   ============================================================ */
function ReviewCardItem({ q, index, order }: { q: ReviewQuestion; index: number; order: number }) {
  const correctLabel = answerLabel(q, q.answer);
  const userLabel = q.userAnswer.trim() === "" ? "（未作答）" : answerLabel(q, q.userAnswer);
  // 溯源：把 sourceRef 里的「第 N 讲」提炼为醒目标签；点击到课程搜索定位原处（sourceRef 无稳定 ID，用关键词回溯）
  const lecture = q.sourceRef ? extractLecture(q.sourceRef) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING_TIDE, type: "spring", delay: Math.min(order * 0.03, 0.24) }}
      className={`rounded-[14px] border bg-[var(--surface)] p-5 shadow-[var(--card),var(--inner-hi)] ${
        q.correct ? "border-[var(--border)]" : "border-[var(--red-soft-border)]"
      }`}
    >
      <div className="mb-3 flex items-start gap-2.5">
        <span
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
            q.correct ? "bg-[var(--ok-soft)] text-[var(--ok)]" : "bg-[var(--red-soft)] text-[var(--red)]"
          }`}
        >
          {q.correct ? <CheckCircle size={15} weight="fill" /> : <XCircle size={15} weight="fill" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="mono text-[11px] text-[var(--ink4)]">第 {index + 1} 题</span>
            <span className="inline-flex items-center gap-1 text-[11px] text-[var(--ink4)]">
              <QTypeIcon type={q.type} /> {qTypeLabel(q.type)}
            </span>
            <span
              className={`mono ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                q.correct ? "bg-[var(--ok-soft)] text-[var(--ok)]" : "bg-[var(--red-soft)] text-[var(--red-ink)]"
              }`}
            >
              {q.score}/{q.max}
            </span>
          </div>
          <div
            className="tide-md text-[15px] font-semibold leading-[1.7] text-[var(--ink)]"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(q.stem) }}
          />
        </div>
      </div>

      <div className="space-y-2 pl-[34px] text-[13.5px] leading-[1.7]">
        {q.type === "short" ? (
          <>
            <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface2)] px-3 py-2 text-[var(--ink2)]">
              <span className="text-[var(--ink4)]">你的作答：</span>
              {q.userAnswer.trim() === "" ? "（未作答）" : q.userAnswer}
            </div>
            {q.comment && (
              <div className="text-[var(--ink2)]">
                <span className="text-[var(--ink4)]">评语：</span>
                {q.comment}
              </div>
            )}
            <div className="rounded-[10px] border border-[var(--ok-soft)] bg-[var(--ok-soft)] px-3 py-2 text-[var(--ink2)]">
              <span className="text-[var(--ink4)]">参考答案：</span>
              {q.answer}
            </div>
          </>
        ) : (
          <>
            {!q.correct && (
              <div className="flex items-center gap-1.5 rounded-[10px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-3 py-2 text-[var(--red-ink)]">
                <XCircle size={14} weight="fill" className="shrink-0" />
                <span>
                  <span className="text-[var(--ink4)]">你的作答：</span>
                  {userLabel}
                </span>
              </div>
            )}
            <div className="flex items-center gap-1.5 rounded-[10px] border border-[var(--ok-soft)] bg-[var(--ok-soft)] px-3 py-2 text-[var(--ink2)]">
              <CheckCircle size={14} weight="fill" className="shrink-0 text-[var(--ok)]" />
              <span>
                <span className="text-[var(--ink4)]">正确答案：</span>
                <span className="font-semibold text-[var(--ink)]">{correctLabel}</span>
              </span>
            </div>
          </>
        )}
        {q.explanation && (
          <div className="rounded-[10px] bg-[var(--surface-inset)] px-3 py-2 text-[13px] text-[var(--ink2)]">
            <span className="text-[var(--ink4)]">解析：</span>
            {q.explanation}
          </div>
        )}
        {/* 错题溯源：来自第 N 讲，可点回原处（sourceRef 无稳定 lesson ID，用其文本到课程搜索定位） */}
        {q.sourceRef && (
          <a
            href={`/courses?q=${encodeURIComponent(q.sourceRef)}`}
            className="studio-press inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-[var(--info-soft)] bg-[var(--info-soft)] px-3 py-1.5 text-[11.5px] font-semibold text-[var(--info)] transition-colors hover:border-[var(--info)]"
            title={`回到原处：${q.sourceRef}`}
          >
            <BookOpen size={13} weight="fill" />
            {lecture ? `来自${lecture}` : `来自：${q.sourceRef}`}
            <ArrowUpRight size={12} weight="bold" />
          </a>
        )}
      </div>
    </motion.div>
  );
}

/** 一次性 confetti：抛洒后自然消失，reduce-motion 由父层跳过挂载（对齐复习室结算庆祝）。 */
function ConfettiLayer() {
  const pieces = useRef(
    Array.from({ length: 26 }, (_, i) => {
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

/* ============ 小部件 ============ */
function QTypeIcon({ type }: { type: QType }) {
  if (type === "single") return <ListChecks size={12} weight="bold" />;
  if (type === "judge") return <CheckCircle size={12} weight="bold" />;
  return <PencilSimpleLine size={12} weight="bold" />;
}
function qTypeLabel(type: QType): string {
  return type === "single" ? "单选" : type === "judge" ? "判断" : "简答";
}

/* ============ 工具 ============ */
// 把作答/答案值渲染为可读文本：single=选项文本、judge=正确/错误、short=原文
function answerLabel(q: ReviewQuestion, val: string): string {
  if (q.type === "single") {
    const idx = Number(val);
    if (q.options && Number.isInteger(idx) && idx >= 0 && idx < q.options.length) {
      return `${String.fromCharCode(65 + idx)}. ${q.options[idx]}`;
    }
    return val || "未作答";
  }
  if (q.type === "judge") return val === "true" ? "正确" : val === "false" ? "错误" : "未作答";
  return val || "未作答";
}

// 错题复习卡背面：正解 + 解析（+溯源）
function buildCardBack(q: ReviewQuestion): string {
  const parts: string[] = [];
  parts.push(`正确答案：${answerLabel(q, q.answer)}`);
  if (q.explanation) parts.push(q.explanation);
  if (q.sourceRef) parts.push(`（来源：${q.sourceRef}）`);
  return parts.join("\n\n");
}

// 去 markdown 标记，作复习卡正面纯文本
function stripMd(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// 从 sourceRef 文本里提炼「第 N 讲」样式的讲次标签；无匹配返回 null（回退展示原始 sourceRef）
function extractLecture(ref: string): string | null {
  const m = ref.match(/第\s*[0-9〇零一二三四五六七八九十百]+\s*[讲课节章]/);
  return m ? m[0].replace(/\s+/g, "") : null;
}

// 逐题回顾排序：错题优先在上、答对在下，各自保持原题序；附带原始题序号供展示「第 N 题」
function orderReview(review: ReviewQuestion[]): (ReviewQuestion & { __origIndex: number })[] {
  const withIdx = review.map((r, i) => ({ ...r, __origIndex: i }));
  const wrong = withIdx.filter((r) => !r.correct);
  const right = withIdx.filter((r) => r.correct);
  return [...wrong, ...right];
}
