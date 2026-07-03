"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  XCircle,
  Confetti,
  BookOpen,
  Cards,
  Exam as ExamIcon,
  CircleNotch,
  Sparkle,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { SPRING_TIDE } from "@/components/motion";
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
 * 复习室 · 引擎B —— 模拟考试全流程承载：
 *   出卷表单（范围/题量/难度）→ 生成 → 答题（一题一屏 + 进度点）→ 成绩单（逐题回顾 + 溯源 + 错题转复习卡）。
 * page 仅负责 Tab 切换并挂载本组件，主逻辑集中在此，减少与协作 agent 的改动冲突。
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
    setFormError(null);
  }

  if (needLogin) {
    return (
      <div className="studio-rise flex flex-col items-center gap-4 rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-10 text-center shadow-[var(--card)]">
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
            <ExamReport report={report} onRetake={reset} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ============ 出卷表单 ============ */
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
  const SCOPES: { value: ScopeType; label: string; hint: string }[] = [
    { value: "all", label: "综合", hint: "最近学过的课" },
    { value: "course", label: "按课程", hint: "选一门课" },
    { value: "notebook", label: "按笔记本", hint: "选一个笔记本" },
  ];
  const needPick = scopeType === "course" || scopeType === "notebook";

  return (
    <div className="studio-rise rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-7 shadow-[var(--card)]">
      <div className="mb-6 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-[var(--red-soft)] text-[var(--red)]">
          <ExamIcon size={18} weight="fill" />
        </div>
        <div>
          <h2 className="text-[16px] font-bold text-[var(--ink)]">出一套模拟考</h2>
          <p className="text-[12.5px] text-[var(--ink3)]">用你学过的内容，AI 现场命题</p>
        </div>
      </div>

      {/* 范围 */}
      <div className="mb-5">
        <label className="mb-2 block text-[12px] font-semibold text-[var(--ink3)]">出题范围</label>
        <div className="grid grid-cols-3 gap-2.5">
          {SCOPES.map((s) => {
            const active = scopeType === s.value;
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => setScopeType(s.value)}
                className={`studio-press rounded-[12px] border px-3 py-3 text-center transition-colors ${
                  active
                    ? "border-[var(--red-soft-border)] bg-[var(--red-soft)]"
                    : "border-[var(--border)] bg-[var(--surface2)] hover:border-[var(--border2)]"
                }`}
              >
                <div className={`text-[13.5px] font-semibold ${active ? "text-[var(--red)]" : "text-[var(--ink2)]"}`}>
                  {s.label}
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--ink4)]">{s.hint}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 具体范围选择器 */}
      {needPick && (
        <div className="mb-5">
          <label className="mb-2 block text-[12px] font-semibold text-[var(--ink3)]">
            {scopeType === "course" ? "选择课程" : "选择笔记本"}
          </label>
          {scopeOptions.length === 0 ? (
            <div className="rounded-[12px] border border-dashed border-[var(--border2)] bg-[var(--surface-inset)] px-4 py-4 text-[13px] text-[var(--ink3)]">
              {scopeType === "course" ? "暂无学习记录，先去学几节课。" : "还没有笔记本，去笔记馆建一个。"}
            </div>
          ) : (
            <div className="grid gap-2">
              {scopeOptions.map((o) => {
                const active = scopeId === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setScopeId(o.id)}
                    className={`studio-press flex items-center justify-between rounded-[12px] border px-4 py-3 text-left transition-colors ${
                      active
                        ? "border-[var(--red-soft-border)] bg-[var(--red-soft)]"
                        : "border-[var(--border)] bg-[var(--surface2)] hover:border-[var(--border2)]"
                    }`}
                  >
                    <span className={`text-[13.5px] font-semibold ${active ? "text-[var(--red)]" : "text-[var(--ink2)]"}`}>
                      {o.title}
                    </span>
                    {o.meta && <span className="text-[11.5px] text-[var(--ink4)]">{o.meta}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 题量 + 难度 */}
      <div className="mb-6 grid grid-cols-2 gap-5">
        <div>
          <label className="mb-2 block text-[12px] font-semibold text-[var(--ink3)]">题量</label>
          <div className="flex gap-2">
            {[5, 10, 15].map((n) => {
              const active = count === n;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCount(n)}
                  className={`studio-press mono flex-1 rounded-[12px] border py-2.5 text-[14px] font-semibold transition-colors ${
                    active
                      ? "border-[var(--red-soft-border)] bg-[var(--red-soft)] text-[var(--red)]"
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
          <label className="mb-2 block text-[12px] font-semibold text-[var(--ink3)]">难度</label>
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
                  className={`studio-press flex-1 rounded-[12px] border py-2.5 text-[13.5px] font-semibold transition-colors ${
                    active
                      ? "border-[var(--red-soft-border)] bg-[var(--red-soft)] text-[var(--red)]"
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

      {error && (
        <div className="mb-4 rounded-[12px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-4 py-2.5 text-[13px] text-[var(--red)]">
          {error}
        </div>
      )}

      <Button full onClick={onGenerate} disabled={generating} loading={generating}>
        {generating ? "AI 命题中…" : "生成试卷"}
      </Button>
      <p className="mt-3 text-center text-[11.5px] text-[var(--ink4)]">AI 依据材料命题，约消耗少量积分</p>
    </div>
  );
}

/* ============ 答题（一题一屏） ============ */
function ExamTaking({
  paper,
  answers,
  setAnswer,
  cursor,
  setCursor,
  submitting,
  onSubmit,
  error,
}: {
  paper: ExamPaper;
  answers: Record<string, string>;
  setAnswer: (qid: string, val: string) => void;
  cursor: number;
  setCursor: (n: number) => void;
  submitting: boolean;
  onSubmit: () => void;
  error: string | null;
}) {
  const total = paper.questions.length;
  const q = paper.questions[cursor];
  const isLast = cursor >= total - 1;
  const answeredCount = useMemo(
    () => paper.questions.filter((x) => (answers[x.id] ?? "").trim() !== "").length,
    [paper.questions, answers],
  );
  const current = answers[q.id] ?? "";

  return (
    <div className="space-y-5">
      {/* 进度点 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {paper.questions.map((x, i) => {
          const answered = (answers[x.id] ?? "").trim() !== "";
          const isCur = i === cursor;
          return (
            <button
              key={x.id}
              type="button"
              onClick={() => setCursor(i)}
              aria-label={`第 ${i + 1} 题`}
              className={`h-2.5 rounded-full transition-all ${
                isCur
                  ? "w-6 bg-[var(--red)]"
                  : answered
                    ? "w-2.5 bg-[var(--ink3)]"
                    : "w-2.5 bg-[var(--surface2)] ring-1 ring-inset ring-[var(--border)]"
              }`}
            />
          );
        })}
        <span className="mono ml-auto text-[12px] font-semibold text-[var(--ink3)]">
          <span className="text-[var(--red)]">{cursor + 1}</span> / {total}
        </span>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={q.id}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ ...SPRING_TIDE, type: "spring" }}
          className="studio-rise rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-7 shadow-[var(--card)]"
        >
          <div className="mb-4 flex items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-[var(--surface2)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink3)]">
              {q.type === "single" ? "单选" : q.type === "judge" ? "判断" : "简答"}
            </span>
            <span className="mono text-[11px] text-[var(--ink4)]">第 {cursor + 1} 题</span>
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
              className="w-full resize-y rounded-[12px] border border-[var(--border)] bg-[var(--surface-inset)] px-4 py-3 text-[15px] leading-[1.7] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--ink3)]"
            />
          ) : (
            <div className="space-y-2.5">
              {(q.type === "judge" ? JUDGE_OPTIONS : (q.options ?? []).map((label, i) => ({ value: String(i), label }))).map(
                (opt) => {
                  const selected = current === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setAnswer(q.id, opt.value)}
                      className={`studio-press flex w-full items-center gap-3 rounded-[12px] border px-4 py-3.5 text-left transition-colors ${
                        selected
                          ? "border-[var(--red-soft-border)] bg-[var(--red-soft)]"
                          : "border-[var(--border)] bg-[var(--surface2)] hover:border-[var(--border2)]"
                      }`}
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${
                          selected
                            ? "border-[var(--red)] bg-[var(--red)] text-[var(--surface)]"
                            : "border-[var(--border2)] text-[var(--ink4)]"
                        }`}
                      >
                        {selected ? <CheckCircle size={13} weight="fill" /> : ""}
                      </span>
                      <span className={`text-[14.5px] leading-[1.6] ${selected ? "text-[var(--red)]" : "text-[var(--ink2)]"}`}>
                        {opt.label}
                      </span>
                    </button>
                  );
                },
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {error && (
        <div className="rounded-[12px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-4 py-2.5 text-[13px] text-[var(--red)]">
          {error}
        </div>
      )}

      {/* 导航 */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={cursor === 0}
          onClick={() => setCursor(Math.max(0, cursor - 1))}
          className="studio-press inline-flex items-center gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[14px] font-semibold text-[var(--ink2)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowLeft size={16} weight="bold" /> 上一题
        </button>
        {isLast ? (
          <Button full onClick={onSubmit} disabled={submitting} loading={submitting}>
            {submitting ? "判卷中…" : `交卷（已答 ${answeredCount}/${total}）`}
          </Button>
        ) : (
          <button
            type="button"
            onClick={() => setCursor(Math.min(total - 1, cursor + 1))}
            className="studio-press inline-flex flex-1 items-center justify-center gap-1.5 rounded-[12px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-4 py-3 text-[14px] font-semibold text-[var(--red)] shadow-[var(--card)] transition-colors"
          >
            下一题 <ArrowRight size={16} weight="bold" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ============ 成绩单 ============ */
function ExamReport({ report, onRetake }: { report: Report; onRetake: () => void }) {
  const pct = report.total > 0 ? Math.round((report.score / report.total) * 100) : 0;
  const wrong = report.review.filter((r) => !r.correct);
  const [carding, setCarding] = useState(false);
  const [cardMsg, setCardMsg] = useState<string | null>(null);

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

  const tone = pct >= 80 ? "good" : pct >= 60 ? "mid" : "low";

  return (
    <div className="space-y-6">
      {/* 总分卡 */}
      <div className="studio-rise flex flex-col items-center gap-3 rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-8 text-center shadow-[var(--card)]">
        <div
          className={`flex h-16 w-16 items-center justify-center rounded-full ${
            tone === "good" ? "bg-[var(--red-soft)] text-[var(--red)]" : "bg-[var(--surface2)] text-[var(--ink3)]"
          }`}
        >
          {tone === "good" ? <Confetti size={30} weight="fill" /> : <ExamIcon size={28} weight="fill" />}
        </div>
        <div className="mono text-[40px] font-bold leading-none text-[var(--ink)]">
          {report.score}
          <span className="text-[20px] text-[var(--ink4)]"> / {report.total}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2 w-40 overflow-hidden rounded-full bg-[var(--surface2)]">
            <motion.div
              className="h-full rounded-full bg-[var(--red)]"
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ ...SPRING_TIDE, type: "spring" }}
            />
          </div>
          <span className="mono text-[13px] font-semibold text-[var(--ink2)]">{pct}%</span>
        </div>
        <p className="text-[14px] leading-[1.7] text-[var(--ink2)]">
          {report.examTitle} · 共 {report.review.length} 题
          {wrong.length > 0 ? (
            <>
              ，答错 <span className="font-bold text-[var(--red)]">{wrong.length}</span> 题
            </>
          ) : (
            "，全部答对，漂亮！"
          )}
        </p>

        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          {wrong.length > 0 && (
            <button
              type="button"
              onClick={makeCards}
              disabled={carding}
              className="studio-press inline-flex items-center gap-1.5 rounded-[12px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-4 py-2.5 text-[13px] font-semibold text-[var(--red)] shadow-[var(--card)] transition-colors disabled:opacity-50"
            >
              {carding ? <CircleNotch size={15} className="animate-spin" /> : <Cards size={15} weight="fill" />}
              错题生成复习卡
            </button>
          )}
          <button
            type="button"
            onClick={onRetake}
            className="studio-press inline-flex items-center gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-[13px] font-semibold text-[var(--ink)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)]"
          >
            <Sparkle size={15} weight="fill" /> 再来一套
          </button>
        </div>
        {cardMsg && <p className="text-[12.5px] text-[var(--ink3)]">{cardMsg}</p>}
      </div>

      {/* 逐题回顾 */}
      <div className="space-y-3">
        <h3 className="text-[14px] font-bold text-[var(--ink)]">逐题回顾</h3>
        {report.review.map((r, i) => (
          <ReviewCardItem key={r.id} q={r} index={i} />
        ))}
      </div>
    </div>
  );
}

/* ============ 成绩单 · 逐题项 ============ */
function ReviewCardItem({ q, index }: { q: ReviewQuestion; index: number }) {
  const correctLabel = answerLabel(q, q.answer);
  const userLabel = q.userAnswer.trim() === "" ? "（未作答）" : answerLabel(q, q.userAnswer);

  return (
    <div
      className={`rounded-[14px] border bg-[var(--surface)] p-5 shadow-[var(--card)] ${
        q.correct ? "border-[var(--border)]" : "border-[var(--red-soft-border)]"
      }`}
    >
      <div className="mb-3 flex items-start gap-2.5">
        <span
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
            q.correct ? "bg-[var(--surface2)] text-[var(--ink3)]" : "bg-[var(--red-soft)] text-[var(--red)]"
          }`}
        >
          {q.correct ? <CheckCircle size={14} weight="fill" /> : <XCircle size={14} weight="fill" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="mono text-[11px] text-[var(--ink4)]">第 {index + 1} 题</span>
            <span className="text-[11px] text-[var(--ink4)]">
              {q.type === "single" ? "单选" : q.type === "judge" ? "判断" : "简答"}
            </span>
            <span className="mono ml-auto text-[11.5px] font-semibold text-[var(--ink3)]">
              {q.score}/{q.max}
            </span>
          </div>
          <div
            className="tide-md text-[15px] font-semibold leading-[1.7] text-[var(--ink)]"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(q.stem) }}
          />
        </div>
      </div>

      <div className="space-y-1.5 pl-7 text-[13.5px] leading-[1.7]">
        {q.type === "short" ? (
          <>
            <div className="text-[var(--ink2)]">
              <span className="text-[var(--ink4)]">你的作答：</span>
              {q.userAnswer.trim() === "" ? "（未作答）" : q.userAnswer}
            </div>
            {q.comment && (
              <div className="text-[var(--ink2)]">
                <span className="text-[var(--ink4)]">评语：</span>
                {q.comment}
              </div>
            )}
            <div className="text-[var(--ink2)]">
              <span className="text-[var(--ink4)]">参考答案：</span>
              {q.answer}
            </div>
          </>
        ) : (
          <>
            {!q.correct && (
              <div className="text-[var(--red)]">
                <span className="text-[var(--ink4)]">你的作答：</span>
                {userLabel}
              </div>
            )}
            <div className="text-[var(--ink2)]">
              <span className="text-[var(--ink4)]">正确答案：</span>
              <span className="font-semibold text-[var(--ink)]">{correctLabel}</span>
            </div>
          </>
        )}
        {q.explanation && (
          <div className="mt-1 rounded-[10px] bg-[var(--surface-inset)] px-3 py-2 text-[13px] text-[var(--ink2)]">
            {q.explanation}
          </div>
        )}
        {q.sourceRef && (
          <div className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-[var(--ink4)]">
            <BookOpen size={12} /> 溯源：{q.sourceRef}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============ 工具 ============ */
// 把作答/答案值渲染为可读文本：single=选项文本、judge=正确/错误、short=原文
function answerLabel(q: ReviewQuestion, val: string): string {
  if (q.type === "single") {
    const idx = Number(val);
    if (q.options && Number.isInteger(idx) && idx >= 0 && idx < q.options.length) {
      return `${String.fromCharCode(65 + idx)}. ${q.options[idx]}`;
    }
    return val || "—";
  }
  if (q.type === "judge") return val === "true" ? "正确" : val === "false" ? "错误" : "—";
  return val || "—";
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
