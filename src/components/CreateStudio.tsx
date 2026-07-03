"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Sparkle,
  FilePlus,
  MagicWand,
  ArrowRight,
  Lock,
  Check,
  CheckCircle,
  XCircle,
  Cards,
  BookOpen,
  Waves,
  Star,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { track } from "@/lib/analytics-client";

// 赛道选项（与 src/lib/tracks.ts 的 key/label 对齐；这里只取造课常用赛道）
const TRACK_OPTIONS: { key: string; label: string }[] = [
  { key: "ai_skill", label: "AI 技能" },
  { key: "english_oral", label: "口语实战" },
  { key: "english_foundation", label: "听说读写全能" },
  { key: "life", label: "生活实用" },
  { key: "silver_english", label: "银发口语" },
];

// §4 资料升维——导入 Tab 的 6 项收益
const IMPORT_BENEFITS: { Icon: typeof BookOpen; label: string; hint: string }[] = [
  { Icon: BookOpen, label: "结构化章节", hint: "长文自动拆成有序小节" },
  { Icon: MagicWand, label: "自动测验", hint: "每节配单选题即学即测" },
  { Icon: Sparkle, label: "AI 伴侣答疑", hint: "读完全文随时追问" },
  { Icon: FilePlus, label: "笔记锚定", hint: "重点段落一键存笔记" },
  { Icon: Cards, label: "复习卡", hint: "要点沉淀成间隔复习卡" },
  { Icon: Waves, label: "进度可视", hint: "学到哪一目了然" },
];

type Tab = "generate" | "import";

/** 单节写作状态：pending 未开始 / writing 正在写 / done 已完成 / failed 失败可重试 */
type LessonState = "pending" | "writing" | "done" | "failed";

/**
 * 剧场阶段机：
 * - idle：待触发
 * - understand：步骤1 理解需求（瞬时✓）
 * - outline：步骤2 搭建大纲（调后端拿 N 节）
 * - lessons：步骤3 逐节写作
 * - done：完成页（造课清单 / 升维报告）
 */
type Phase = "idle" | "understand" | "outline" | "lessons" | "done";

interface OutlineLesson {
  id: string;
  title: string;
  /** 本节写作状态（前端维护，随逐节生成推进） */
  state?: LessonState;
}

/** 完成页汇总数据（造课 & 升维通用） */
interface DoneSummary {
  slug: string;
  firstLessonId: string;
  total: number; // 节数
  succeeded: number; // 成功节数
  quizzes: number; // 测验数（≈ 每节 1 测）
  cards: number; // 要点卡数（≈ 每节 1 张）
  chars?: number; // 升维报告：原文字数
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * AI 造课交互组件（引擎A/B 前端壳 · 过程剧场版）。
 *
 * §3 备课剧场：点「生成课程」后不跳走，在页内展示分步过程——
 *   步骤1 理解需求(瞬时✓) → 步骤2 搭建大纲(/api/ai/generate-course，大纲逐条浮现)
 *   → 步骤3 逐节写作(对每个 lesson 依次 /api/ai/generate-lesson，实时✓/重试)
 *   → 完成页「这门课包含」清单 + 开始学习。
 * §4 资料升维：导入同样进剧场，完成页为「升维报告」。
 * 支持 ?prompt=xxx 预填输入框（首页输入框带过来）。
 * 权益：canUseLLM=false 时后端返回 402，前端引导订阅。
 */
export function CreateStudio({ canUseLLM }: { canUseLLM: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>("generate");

  // —— 生成课状态 ——
  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState<string>("");

  // —— 导入资料状态 ——
  const [importTitle, setImportTitle] = useState("");
  const [importText, setImportText] = useState("");

  // —— 剧场共享状态（造课 & 导入复用同一套阶段机）——
  const [phase, setPhase] = useState<Phase>("idle");
  const [source, setSource] = useState<"generate" | "import">("generate");
  const [lessons, setLessons] = useState<OutlineLesson[]>([]);
  const [writingIndex, setWritingIndex] = useState(0); // 当前正在写的节下标
  const [summary, setSummary] = useState<DoneSummary | null>(null);

  const busy = phase !== "idle" && phase !== "done";

  // 首页输入框带来的 ?prompt=xxx → 预填生成输入框（仅首次）
  useEffect(() => {
    const q = searchParams.get("prompt");
    if (q && q.trim()) {
      setPrompt(q.trim().slice(0, 500));
      setTab("generate");
    }
    // 仅在挂载时读一次；searchParams 引用稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 未订阅时的统一提示
  const gate = () => {
    toast("AI 造课为订阅会员专享功能", {
      tone: "warn",
      action: { label: "去订阅", onClick: () => router.push("/pricing") },
    });
  };

  // 重置到编辑态（完成页「再造一门」或失败回退）
  function resetTheater() {
    setPhase("idle");
    setLessons([]);
    setWritingIndex(0);
    setSummary(null);
  }

  /**
   * 逐节写作循环（造课与导入共用）：对每个 lesson 依次 POST /api/ai/generate-lesson，
   * 单节失败标 failed 不阻断整体；返回成功节数。
   */
  async function writeLessons(list: OutlineLesson[]): Promise<number> {
    let succeeded = 0;
    for (let i = 0; i < list.length; i++) {
      setWritingIndex(i);
      // 标记本节写作中
      setLessons((prev) => prev.map((l, idx) => (idx === i ? { ...l, state: "writing" } : l)));
      let okThis = false;
      try {
        const r = await fetch("/api/ai/generate-lesson", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lessonId: list[i].id }),
        });
        const lj = await r.json().catch(() => null);
        if (r.status === 402) {
          gate();
          // 权益中途失效：把剩余节标 failed 后结束
          setLessons((prev) => prev.map((l, idx) => (idx >= i ? { ...l, state: "failed" } : l)));
          return succeeded;
        }
        okThis = r.ok && !!lj?.ok;
      } catch {
        okThis = false;
      }
      if (okThis) succeeded++;
      setLessons((prev) => prev.map((l, idx) => (idx === i ? { ...l, state: okThis ? "done" : "failed" } : l)));
      // 轻微节奏感，让逐条✓可被看见（不影响真实请求）
      await delay(80);
    }
    return succeeded;
  }

  /** 单节重试（完成页对 failed 节点重新生成） */
  async function retryLesson(lessonId: string) {
    setLessons((prev) => prev.map((l) => (l.id === lessonId ? { ...l, state: "writing" } : l)));
    let okThis = false;
    try {
      const r = await fetch("/api/ai/generate-lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId }),
      });
      const lj = await r.json().catch(() => null);
      if (r.status === 402) return gate();
      okThis = r.ok && !!lj?.ok;
    } catch {
      okThis = false;
    }
    setLessons((prev) => prev.map((l) => (l.id === lessonId ? { ...l, state: okThis ? "done" : "failed" } : l)));
    if (okThis && summary) {
      // 重试成功 → 更新完成页汇总的成功计数
      setSummary({ ...summary, succeeded: Math.min(summary.total, summary.succeeded + 1) });
      toast("这一节已补齐", { tone: "success" });
    } else if (!okThis) {
      toast("这一节仍未生成，可稍后再试", { tone: "warn" });
    }
  }

  // ——————————————————————————————————————————————
  //  §3 备课剧场：生成课
  // ——————————————————————————————————————————————
  async function handleGenerate() {
    if (busy) return;
    const q = prompt.trim();
    if (!q) {
      toast("先描述一下你想学什么吧", { tone: "info" });
      return;
    }
    if (!canUseLLM) return gate();

    track("hero_cta_click", { source: "create_generate" });
    setSource("generate");
    setSummary(null);
    setLessons([]);
    setWritingIndex(0);

    // 步骤1 理解需求：瞬时✓（给用户"被听懂"的确定感）
    setPhase("understand");
    await delay(520);

    // 步骤2 搭建大纲
    setPhase("outline");
    try {
      const res = await fetch("/api/ai/generate-course", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: q, category: category || undefined }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        if (res.status === 402) {
          resetTheater();
          return gate();
        }
        throw new Error(json?.error || "生成失败");
      }
      const data = json.data as { slug: string; lessons: OutlineLesson[] };
      const outline = Array.isArray(data.lessons) ? data.lessons : [];
      if (outline.length === 0) throw new Error("大纲为空，请调整需求重试");

      // 大纲逐条浮现（.studio-slide 由渲染层按 index 递延）
      const initial = outline.map((l) => ({ id: l.id, title: l.title, state: "pending" as LessonState }));
      setLessons(initial);
      await delay(360);

      // 步骤3 逐节写作
      setPhase("lessons");
      const succeeded = await writeLessons(initial);

      // 完成页
      setSummary({
        slug: data.slug,
        firstLessonId: outline[0].id,
        total: outline.length,
        succeeded,
        quizzes: succeeded,
        cards: succeeded,
      });
      setPhase("done");
      if (succeeded < outline.length) {
        toast(`已生成 ${succeeded}/${outline.length} 节，个别章节可在完成页重试`, { tone: "warn" });
      } else {
        toast("课程已生成，开始学习吧", { tone: "success" });
      }
    } catch (e) {
      resetTheater();
      toast(e instanceof Error ? e.message : "生成失败，请稍后再试", { tone: "warn" });
    }
  }

  // ——————————————————————————————————————————————
  //  §4 资料升维：导入 → 剧场 → 升维报告
  // ——————————————————————————————————————————————
  async function handleImport() {
    if (busy) return;
    const text = importText.trim();
    if (!text) {
      toast("先把你的资料粘贴进来吧", { tone: "info" });
      return;
    }
    if (text.length < 100) {
      toast("资料太短啦，至少 100 字才好拆成课", { tone: "info" });
      return;
    }
    if (!canUseLLM) return gate();

    track("hero_cta_click", { source: "create_import" });
    const chars = text.length;
    setSource("import");
    setSummary(null);
    setLessons([]);
    setWritingIndex(0);

    // 步骤1 读懂资料：瞬时✓
    setPhase("understand");
    await delay(520);

    // 步骤2 拆分章节（后端切章 + 落库空节，返回 lessons）
    setPhase("outline");
    try {
      const res = await fetch("/api/ai/import-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 注意：import-source route 约定字段为 rawText（非 sourceText）
        body: JSON.stringify({ title: importTitle.trim() || undefined, rawText: text }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        if (res.status === 402) {
          resetTheater();
          return gate();
        }
        if (res.status === 404) {
          resetTheater();
          toast("资料整理功能即将上线，敬请期待", { tone: "info" });
          return;
        }
        throw new Error(json?.error || "整理失败");
      }
      const data = json.data as { slug: string; lessons: OutlineLesson[] };
      const outline = Array.isArray(data.lessons) ? data.lessons : [];
      if (outline.length === 0) throw new Error("未能从资料中拆出章节，请调整后重试");

      const initial = outline.map((l) => ({ id: l.id, title: l.title, state: "pending" as LessonState }));
      setLessons(initial);
      await delay(360);

      // 步骤3 逐节写作（导入的课同样需要逐节生成块课件）
      setPhase("lessons");
      const succeeded = await writeLessons(initial);

      setSummary({
        slug: data.slug,
        firstLessonId: outline[0].id,
        total: outline.length,
        succeeded,
        quizzes: succeeded,
        cards: succeeded,
        chars,
      });
      setPhase("done");
      if (succeeded < outline.length) {
        toast(`已升维 ${succeeded}/${outline.length} 章，个别章节可在报告页重试`, { tone: "warn" });
      } else {
        toast("资料已升维成课", { tone: "success" });
      }
    } catch (e) {
      resetTheater();
      toast(e instanceof Error ? e.message : "整理失败，请稍后再试", { tone: "warn" });
    }
  }

  // 步骤条数据（造课 vs 升维文案不同）
  const steps = useMemo(() => {
    if (source === "import") {
      return [
        { key: "understand", label: "读懂你的资料" },
        { key: "outline", label: "拆分主题章节" },
        { key: "lessons", label: "逐章升维写作" },
      ];
    }
    return [
      { key: "understand", label: "理解你的需求" },
      { key: "outline", label: "搭建课程大纲" },
      { key: "lessons", label: "逐节撰写讲解" },
    ];
  }, [source]);

  // 阶段序号（用于步骤条 done/active 判定）
  const phaseOrder: Record<Phase, number> = { idle: 0, understand: 1, outline: 2, lessons: 3, done: 4 };
  const curOrder = phaseOrder[phase];

  const inTheater = phase !== "idle";

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col items-center">
      {/* —— 顶部大标题 —— */}
      <div className="mb-1.5 flex items-center gap-2 rounded-full border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-3 py-1">
        <Sparkle size={13} weight="fill" className="text-[var(--red)]" />
        <span className="mono text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--red)]">AI STUDIO</span>
      </div>
      <h1 className="text-center text-[30px] font-extrabold leading-[1.15] tracking-tight text-[var(--ink)] sm:text-[38px]">
        {tab === "import" ? "把任何资料，变成一门你的课" : "一句话，生成你的专属课"}
      </h1>
      <p className="mt-2.5 max-w-[460px] text-center text-[15px] leading-relaxed text-[var(--ink2)]">
        {tab === "import"
          ? "粘贴文章、笔记、PDF 内容，AI 现场拆章、配测验、装上伴侣，资料立刻能学。"
          : "说出你想学的，AI 现场搭好课程大纲、逐节写好讲解与测验，学完就能用。"}
      </p>

      {/* —— Tab 切换（剧场进行中隐藏，避免误触） —— */}
      {!inTheater && (
        <div className="mt-7 inline-flex gap-1 rounded-full border border-[var(--border)] bg-[var(--surface2)] p-1">
          {[
            { key: "generate" as Tab, label: "AI 生成课", Icon: MagicWand },
            { key: "import" as Tab, label: "导入我的资料", Icon: FilePlus },
          ].map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold transition-all duration-150 ${
                  active ? "bg-[var(--surface)] text-[var(--ink)] shadow-[var(--card)]" : "text-[var(--ink3)] hover:text-[var(--ink)]"
                }`}
              >
                <t.Icon size={15} weight={active ? "fill" : "regular"} />
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      {/* —— 权益不足横幅 —— */}
      {!canUseLLM && !inTheater && (
        <div className="mt-5 flex w-full items-center gap-2.5 rounded-[12px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-4 py-3 text-[13px] text-[var(--ink2)]">
          <Lock size={16} weight="fill" className="shrink-0 text-[var(--red)]" />
          <span className="flex-1">AI 造课为订阅会员专享，订阅后即可无限生成专属课程。</span>
          <Button href="/pricing" size="sm" variant="primary">去订阅</Button>
        </div>
      )}

      {/* —— 主体：编辑态 / 剧场态 / 完成态 —— */}
      {phase === "idle" ? (
        <div className="mt-5 w-full rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)] sm:p-6">
          {tab === "generate" ? (
            <div className="flex flex-col gap-4">
              <div className="relative">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={5}
                  maxLength={500}
                  placeholder="描述你想学的，比如：讲讲 Python 装饰器，我是初学者"
                  className="w-full resize-none rounded-[14px] border border-[var(--border2)] bg-[var(--bg2)] px-4 py-3.5 text-[16px] leading-relaxed text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--red)] focus:bg-[var(--surface)]"
                />
                <span className="mono pointer-events-none absolute bottom-3 right-3.5 text-[10px] text-[var(--ink4)]">
                  {prompt.length}/500
                </span>
              </div>

              {/* 赛道选择（可选） */}
              <div className="flex flex-col gap-2">
                <span className="mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ink4)]">赛道（可选）</span>
                <div className="flex flex-wrap gap-2">
                  {TRACK_OPTIONS.map((t) => {
                    const active = category === t.key;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setCategory(active ? "" : t.key)}
                        className={`studio-press rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-all duration-150 ${
                          active
                            ? "border-[var(--red)] bg-[var(--red-soft)] text-[var(--red)]"
                            : "border-[var(--border)] bg-[var(--surface2)] text-[var(--ink3)] hover:border-[var(--border2)] hover:text-[var(--ink)]"
                        }`}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={handleGenerate}
                className="studio-press group inline-flex w-full items-center justify-center gap-2 rounded-[14px] bg-[var(--red)] px-5 py-3.5 text-[15px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(252,1,26,0.5)] transition-all duration-200 [transition-timing-function:var(--ease-out-expo)] hover:brightness-105"
              >
                <Sparkle size={17} weight="fill" />
                生成课程
                <ArrowRight size={16} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* §4 导入收益六宫格 */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {IMPORT_BENEFITS.map((b) => (
                  <div
                    key={b.label}
                    className="flex flex-col gap-1 rounded-[12px] border border-[var(--border)] bg-[var(--surface2)] px-3 py-2.5"
                  >
                    <div className="flex items-center gap-1.5">
                      <b.Icon size={15} weight="fill" className="shrink-0 text-[var(--red)]" />
                      <span className="text-[12.5px] font-semibold text-[var(--ink)]">{b.label}</span>
                    </div>
                    <span className="text-[11px] leading-snug text-[var(--ink3)]">{b.hint}</span>
                  </div>
                ))}
              </div>

              <input
                value={importTitle}
                onChange={(e) => setImportTitle(e.target.value)}
                maxLength={60}
                placeholder="课程标题（可留空，AI 帮你起）"
                className="w-full rounded-[14px] border border-[var(--border2)] bg-[var(--bg2)] px-4 py-3 text-[15px] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--red)] focus:bg-[var(--surface)]"
              />
              <div className="relative">
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  rows={8}
                  maxLength={50000}
                  placeholder="把你的学习资料 / PDF 内容 / 文章粘贴进来，AI 帮你整理成可学的课"
                  className="w-full resize-none rounded-[14px] border border-[var(--border2)] bg-[var(--bg2)] px-4 py-3.5 text-[15px] leading-relaxed text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--red)] focus:bg-[var(--surface)]"
                />
                <span className="mono pointer-events-none absolute bottom-3 right-3.5 text-[10px] text-[var(--ink4)]">
                  {importText.length}/50000
                </span>
              </div>
              <button
                type="button"
                onClick={handleImport}
                className="studio-press group inline-flex w-full items-center justify-center gap-2 rounded-[14px] bg-[var(--red)] px-5 py-3.5 text-[15px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(252,1,26,0.5)] transition-all duration-200 [transition-timing-function:var(--ease-out-expo)] hover:brightness-105"
              >
                <FilePlus size={17} weight="fill" />
                把资料升维成课
                <ArrowRight size={16} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" />
              </button>
              <p className="text-center text-[11.5px] text-[var(--ink3)]">AI 会把长文拆成章节，配上要点与测验，帮你把资料变成能学的课。</p>
            </div>
          )}
        </div>
      ) : phase === "done" && summary ? (
        <DonePanel
          source={source}
          summary={summary}
          lessons={lessons}
          onStart={() => router.push(`/courses/${summary.slug}/learn/${summary.firstLessonId}`)}
          onRetry={retryLesson}
          onReset={resetTheater}
        />
      ) : (
        <TheaterPanel
          source={source}
          steps={steps}
          curOrder={curOrder}
          phase={phase}
          lessons={lessons}
          writingIndex={writingIndex}
        />
      )}
    </div>
  );
}

/* ============================================================
   剧场进行面板：步骤条 + 大纲逐条浮现 + 逐节写作进度
   ============================================================ */
function TheaterPanel({
  source,
  steps,
  curOrder,
  phase,
  lessons,
  writingIndex,
}: {
  source: "generate" | "import";
  steps: { key: string; label: string }[];
  curOrder: number;
  phase: Phase;
  lessons: OutlineLesson[];
  writingIndex: number;
}) {
  const total = lessons.length;
  const doneCount = lessons.filter((l) => l.state === "done" || l.state === "failed").length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div className="mt-5 w-full rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)] sm:p-6">
      {/* —— 三步步骤条 —— */}
      <ol className="flex flex-col gap-2.5">
        {steps.map((s, i) => {
          const order = i + 1; // 1=understand 2=outline 3=lessons
          const state: "done" | "active" | "todo" = curOrder > order ? "done" : curOrder === order ? "active" : "todo";
          return (
            <li key={s.key} className="flex items-center gap-3">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${
                  state === "done"
                    ? "bg-[var(--red)] text-white"
                    : state === "active"
                    ? "border-2 border-[var(--red)] text-[var(--red)]"
                    : "border border-[var(--border2)] text-[var(--ink4)]"
                }`}
              >
                {state === "done" ? (
                  <Check size={13} weight="bold" />
                ) : state === "active" ? (
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--red)]" />
                ) : (
                  order
                )}
              </span>
              <span
                className={`text-[14px] font-semibold ${
                  state === "todo" ? "text-[var(--ink4)]" : "text-[var(--ink)]"
                }`}
              >
                {s.label}
              </span>
              {state === "active" && order < 3 && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--red)] border-t-transparent" />
              )}
            </li>
          );
        })}
      </ol>

      {/* —— 大纲逐条浮现（.studio-slide 递延入场） —— */}
      {total > 0 && (
        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ink4)]">
              {source === "import" ? "升维章节" : "课程大纲"} · {total} 节
            </span>
            {phase === "lessons" && (
              <span className="mono text-[11px] font-semibold text-[var(--ink2)]">
                {doneCount}/{total}
              </span>
            )}
          </div>

          {/* 逐节写作时的当前节提示 */}
          {phase === "lessons" && writingIndex < total && lessons[writingIndex]?.state === "writing" && (
            <p className="mb-3 text-[13px] text-[var(--ink2)]">
              正在写第 <span className="mono font-semibold text-[var(--ink)]">{writingIndex + 1}/{total}</span> 节：
              <span className="font-semibold text-[var(--ink)]">{lessons[writingIndex].title}</span>
            </p>
          )}

          <ul className="flex flex-col gap-1.5">
            {lessons.map((l, i) => (
              <li
                key={l.id}
                className="studio-slide flex items-center gap-2.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface2)] px-3 py-2"
                style={{ animationDelay: `${Math.min(i, 8) * 55}ms` }}
              >
                <LessonStateIcon state={l.state} index={i} />
                <span
                  className={`flex-1 truncate text-[13.5px] ${
                    l.state === "done"
                      ? "font-medium text-[var(--ink)]"
                      : l.state === "failed"
                      ? "text-[var(--ink2)]"
                      : l.state === "writing"
                      ? "font-medium text-[var(--ink)]"
                      : "text-[var(--ink3)]"
                  }`}
                >
                  {l.title}
                </span>
                {l.state === "failed" && (
                  <span className="mono shrink-0 rounded-full bg-[var(--red-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--red)]">
                    待重试
                  </span>
                )}
              </li>
            ))}
          </ul>

          {/* 底部进度条 */}
          {phase === "lessons" && (
            <div className="mt-4">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border2)]">
                <div
                  className="h-full rounded-full bg-[var(--red)] transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-2 text-[11.5px] text-[var(--ink3)]">生成中请勿关闭页面，全部完成后进入完成页。</p>
            </div>
          )}
        </div>
      )}

      {/* 大纲未回来前的等待态（步骤1/2） */}
      {total === 0 && (
        <div className="mt-5 flex items-center gap-2.5 border-t border-[var(--border)] pt-4">
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--red)] border-t-transparent" />
          <span className="text-[13px] text-[var(--ink2)]">
            {phase === "understand"
              ? source === "import"
                ? "正在通读你的资料…"
                : "正在读懂你的需求…"
              : source === "import"
              ? "正在按主题拆分章节…"
              : "正在设计课程大纲…"}
          </span>
        </div>
      )}
    </div>
  );
}

/** 单节状态图标 */
function LessonStateIcon({ state, index }: { state?: LessonState; index: number }) {
  if (state === "done")
    return <CheckCircle size={17} weight="fill" className="shrink-0 text-[var(--red)]" />;
  if (state === "failed")
    return <XCircle size={17} weight="fill" className="shrink-0 text-[var(--ink4)]" />;
  if (state === "writing")
    return <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--red)] border-t-transparent" />;
  // pending：显示序号
  return (
    <span className="mono flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full border border-[var(--border2)] text-[10px] font-semibold text-[var(--ink4)]">
      {index + 1}
    </span>
  );
}

/* ============================================================
   完成面板：造课「这门课包含」清单 / 导入「升维报告」+ 通电点亮课程卡
   ============================================================ */
function DonePanel({
  source,
  summary,
  lessons,
  onStart,
  onRetry,
  onReset,
}: {
  source: "generate" | "import";
  summary: DoneSummary;
  lessons: OutlineLesson[];
  onStart: () => void;
  onRetry: (lessonId: string) => void;
  onReset: () => void;
}) {
  const failed = lessons.filter((l) => l.state === "failed");
  const isImport = source === "import";

  // 「这门课包含」/「升维报告」条目
  const facts: { Icon: typeof BookOpen; num: number | string; label: string }[] = isImport
    ? [
        { Icon: BookOpen, num: summary.total, label: "章" },
        { Icon: MagicWand, num: summary.quizzes, label: "个测验" },
        { Icon: Cards, num: summary.cards, label: "张要点卡" },
        { Icon: Sparkle, num: "已就位", label: "伴侣读完全文" },
      ]
    : [
        { Icon: BookOpen, num: summary.total, label: "节" },
        { Icon: MagicWand, num: summary.quizzes, label: "个测验" },
        { Icon: Cards, num: summary.cards, label: "张要点卡" },
        { Icon: Sparkle, num: "已就位", label: "AI 伴侣" },
      ];

  return (
    <div className="studio-poweron studio-sweep relative mt-5 w-full overflow-hidden rounded-[18px] border border-[var(--red-soft-border)] bg-[var(--surface)] p-5 shadow-[var(--lift)] sm:p-6">
      {/* 顶部：成功徽标 */}
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--red-soft)]">
          <Star size={18} weight="fill" className="text-[var(--red)]" />
        </span>
        <div>
          <div className="text-[16px] font-extrabold text-[var(--ink)]">
            {isImport ? "升维报告" : "这门课已就绪"}
          </div>
          <div className="text-[12.5px] text-[var(--ink3)]">
            {isImport ? "你的资料已经变成一门可学的课" : "大纲、讲解、测验、伴侣，全部准备好了"}
          </div>
        </div>
      </div>

      {/* 升维报告：字数 → 结构化 转化句 */}
      {isImport && summary.chars ? (
        <p className="mt-4 rounded-[12px] border border-[var(--border)] bg-[var(--surface-inset)] px-4 py-3 text-[13.5px] leading-relaxed text-[var(--ink2)]">
          你的 <span className="mono font-bold text-[var(--ink)]">{summary.chars.toLocaleString()}</span> 字资料
          <ArrowRight size={13} weight="bold" className="mx-1.5 inline align-middle text-[var(--red)]" />
          <span className="mono font-bold text-[var(--ink)]">{summary.total}</span> 章 ·
          <span className="mono font-bold text-[var(--ink)]"> {summary.quizzes}</span> 测验 ·
          <span className="mono font-bold text-[var(--ink)]"> {summary.cards}</span> 要点卡 · 伴侣已读完全文
        </p>
      ) : (
        <p className="mt-4 text-[13.5px] text-[var(--ink2)]">这门课包含：</p>
      )}

      {/* 事实清单（数字用 .mono） */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {facts.map((f) => (
          <div
            key={f.label}
            className="flex flex-col items-center gap-1 rounded-[12px] border border-[var(--border)] bg-[var(--surface2)] px-3 py-3 text-center"
          >
            <f.Icon size={18} weight="fill" className="text-[var(--red)]" />
            <span className="mono text-[18px] font-extrabold leading-none text-[var(--ink)]">{f.num}</span>
            <span className="text-[11px] leading-snug text-[var(--ink3)]">{f.label}</span>
          </div>
        ))}
      </div>

      {/* 部分失败：可重试的章节 */}
      {failed.length > 0 && (
        <div className="mt-4 rounded-[12px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-4 py-3">
          <p className="text-[12.5px] font-semibold text-[var(--ink2)]">
            有 {failed.length} 节暂未写完，可单独重试：
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {failed.map((l) => (
              <li key={l.id} className="flex items-center gap-2">
                <XCircle size={15} weight="fill" className="shrink-0 text-[var(--ink4)]" />
                <span className="flex-1 truncate text-[12.5px] text-[var(--ink2)]">{l.title}</span>
                <button
                  type="button"
                  onClick={() => onRetry(l.id)}
                  disabled={l.state === "writing"}
                  className="studio-press mono shrink-0 rounded-full border border-[var(--red)] px-2.5 py-1 text-[11px] font-semibold text-[var(--red)] transition-colors hover:bg-[var(--red)] hover:text-white disabled:opacity-50"
                >
                  {l.state === "writing" ? "写作中…" : "重试"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 主行动 */}
      <div className="mt-5 flex items-center gap-2.5">
        <button
          type="button"
          onClick={onStart}
          className="studio-press group inline-flex flex-1 items-center justify-center gap-2 rounded-[14px] bg-[var(--red)] px-5 py-3.5 text-[15px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(252,1,26,0.5)] transition-all duration-200 [transition-timing-function:var(--ease-out-expo)] hover:brightness-105"
        >
          <BookOpen size={17} weight="fill" />
          开始学习
          <ArrowRight size={16} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" />
        </button>
        <button
          type="button"
          onClick={onReset}
          className="studio-press shrink-0 rounded-[14px] border border-[var(--border)] bg-[var(--surface2)] px-4 py-3.5 text-[13.5px] font-semibold text-[var(--ink2)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)]"
        >
          再来一门
        </button>
      </div>
    </div>
  );
}
