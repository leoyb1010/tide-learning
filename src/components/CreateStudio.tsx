"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
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
  ArrowUUpLeft,
  Play,
  Books,
  Export,
  HourglassMedium,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { ArchiveStamp } from "@/components/motion";
import { useToast } from "@/components/Toast";
import { track } from "@/lib/analytics-client";
import { ProgressRing, Spinner, useGenPolling, type GenProgress } from "@/components/GenProgress";

/**
 * 剧场恢复用：由 /create server component 预取的「我正在生成中的课」摘要。
 * 关页面/刷新后回到 /create，用它显示生产中横幅 + 一键回到剧场（水合恢复）。
 */
export interface GeneratingCourse {
  id: string;
  slug: string;
  title: string;
  isImport: boolean;
  total: number;
  done: number;
  firstLessonId: string | null;
}

// 赛道选项（与 src/lib/tracks.ts 的 key/label 对齐；这里只取造课常用赛道）
const TRACK_OPTIONS: { key: string; label: string }[] = [
  { key: "ai_skill", label: "AI 技能" },
  { key: "english_oral", label: "口语实战" },
  { key: "english_foundation", label: "听说读写全能" },
  { key: "life", label: "生活实用" },
  { key: "silver_english", label: "银发口语" },
];

// 造课首屏「试试这些」灵感 chip（与 iOS 端 CreateView 对齐/本地化）：
// 点击即填充 prompt，给空输入框一个明确的启动引导，降冷启动门槛。
const PROMPT_EXAMPLES: string[] = [
  "讲讲 Python 装饰器，我是初学者",
  "30 天练成职场邮件写作",
  "用一周搞懂神经网络是怎么学习的",
  "带我从零开口说英语",
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
  courseId: string; // 完成页「分享到集市」需要（/api/market/share 入参 courseId）
  slug: string;
  firstLessonId: string;
  total: number; // 节数
  succeeded: number; // 成功节数
  quizzes: number; // 测验数（≈ 每节 1 测）
  cards: number; // 要点卡数（≈ 每节 1 张）
  chars?: number; // 升维报告：原文字数
  videos?: number; // v3.1：已发起/就绪的视频课件节数（勾选「生成视频课件」时）
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
export function CreateStudio({
  canUseLLM,
  generatingCourses = [],
}: {
  canUseLLM: boolean;
  /** 服务端预取的「生成中的课」，用于剧场恢复（生产中横幅 + 回到剧场）。 */
  generatingCourses?: GeneratingCourse[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>("generate");

  // —— 剧场恢复：进入正在生成的课，从任意进度水合并轮询 ——
  // recoverCourse 非空即进入「恢复剧场」渲染分支（独立于前端即时驱动的 phase 机）。
  const [recoverCourse, setRecoverCourse] = useState<GeneratingCourse | null>(null);
  // 本次会话中用户主动关掉横幅的课（或已完成的课）——不再打扰。
  const [dismissedGen, setDismissedGen] = useState<Set<string>>(() => new Set());

  // —— 生成课状态 ——
  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState<string>("");
  // v3.1：造课时是否同时生成视频课件（选中 → 逐节写完块课件后，对每节发起视频生成）。
  const [genVideo, setGenVideo] = useState(false);

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
          // 权益中途失效：把剩余节标 failed 后结束（同步写回入参 list，供 requestVideos 判定）
          setLessons((prev) => prev.map((l, idx) => (idx >= i ? { ...l, state: "failed" } : l)));
          for (let k = i; k < list.length; k++) list[k].state = "failed";
          return succeeded;
        }
        okThis = r.ok && !!lj?.ok;
      } catch {
        okThis = false;
      }
      if (okThis) succeeded++;
      // 写回入参 list 的本节状态，让 requestVideos 能据此跳过 failed 节（无块课件无法生成视频）
      list[i].state = okThis ? "done" : "failed";
      setLessons((prev) => prev.map((l, idx) => (idx === i ? { ...l, state: okThis ? "done" : "failed" } : l)));
      // 轻微节奏感，让逐条✓可被看见（不影响真实请求）
      await delay(80);
    }
    return succeeded;
  }

  /**
   * v3.1：对已写好块课件的各节发起视频课件生成（best-effort，框架 + mock）。
   * 逐节 POST /api/ai/generate-video；单节失败不阻断，其余照常。仅在用户勾选「生成视频课件」时调用。
   * 权益中途失效（402）则停止并提示。返回成功发起/就绪的节数（仅统计用）。
   */
  async function requestVideos(list: OutlineLesson[]): Promise<number> {
    let ok = 0;
    for (const l of list) {
      // 只对写作成功的节发起（failed 节尚无块课件，视频生成会 409）
      if (l.state === "failed") continue;
      try {
        const r = await fetch("/api/ai/generate-video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lessonId: l.id }),
        });
        if (r.status === 402) {
          gate();
          return ok;
        }
        const j = await r.json().catch(() => null);
        if (r.ok && j?.ok) ok += 1;
      } catch {
        /* 单节视频发起失败不阻断整体 */
      }
    }
    return ok;
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
      const data = json.data as { courseId: string; slug: string; lessons: OutlineLesson[] };
      const outline = Array.isArray(data.lessons) ? data.lessons : [];
      if (outline.length === 0) throw new Error("大纲为空，请调整需求重试");

      // 大纲逐条浮现（.studio-slide 由渲染层按 index 递延）
      const initial = outline.map((l) => ({ id: l.id, title: l.title, state: "pending" as LessonState }));
      setLessons(initial);
      await delay(360);

      // 步骤3 逐节写作
      setPhase("lessons");
      const succeeded = await writeLessons(initial);

      // v3.1：勾选「生成视频课件」→ 对已写好块课件的各节发起视频生成（框架 + mock）。
      // best-effort：块课件已就绪即可学习，视频异步就绪（学习页出现「视频」Tab）。
      let videos = 0;
      if (genVideo) videos = await requestVideos(initial);

      // 完成页
      setSummary({
        courseId: data.courseId,
        slug: data.slug,
        firstLessonId: outline[0].id,
        total: outline.length,
        succeeded,
        quizzes: succeeded,
        cards: succeeded,
        videos: genVideo ? videos : undefined,
      });
      setPhase("done");
      if (succeeded < outline.length) {
        toast(`已生成 ${succeeded}/${outline.length} 节，个别章节可在完成页重试`, { tone: "warn" });
      } else if (genVideo) {
        toast(videos > 0 ? "课程已生成，视频课件正在就绪" : "课程已生成，视频课件稍后可在学习页查看", { tone: "success" });
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
      const data = json.data as { courseId: string; slug: string; lessons: OutlineLesson[] };
      const outline = Array.isArray(data.lessons) ? data.lessons : [];
      if (outline.length === 0) throw new Error("未能从资料中拆出章节，请调整后重试");

      const initial = outline.map((l) => ({ id: l.id, title: l.title, state: "pending" as LessonState }));
      setLessons(initial);
      await delay(360);

      // 步骤3 逐节写作（导入的课同样需要逐节生成块课件）
      setPhase("lessons");
      const succeeded = await writeLessons(initial);

      setSummary({
        courseId: data.courseId,
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

  // 恢复入口：点「回到剧场」→ 切到恢复分支（水合 + 轮询）。
  const enterRecovery = useCallback((c: GeneratingCourse) => {
    track("gen_recover_enter", { course_id: c.id });
    setRecoverCourse(c);
  }, []);

  // 生产中横幅数据：排除本次会话已关掉的课；剧场进行中(inTheater)或已在恢复分支则不再顶部提示。
  const activeGen = generatingCourses.filter((c) => !dismissedGen.has(c.id));

  // —— 恢复剧场分支：接管整个主体，从服务端进度水合并轮询 ——
  if (recoverCourse) {
    return (
      <RecoveryTheater
        course={recoverCourse}
        onExit={() => setRecoverCourse(null)}
        onDone={(courseId) => {
          // 完成后从横幅候选里移除，回到编辑态时不再提示该课。
          setDismissedGen((prev) => new Set(prev).add(courseId));
        }}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col items-center">
      {/* —— 生产中横幅：有生成中的课时置顶提示，可一键回到剧场（剧场进行中时不重复提示） —— */}
      {!inTheater && activeGen.length > 0 && (
        <div className="mb-5 w-full">
          {activeGen.map((c) => (
            <GeneratingBanner
              key={c.id}
              course={c}
              onEnter={() => enterRecovery(c)}
              onDismiss={() => setDismissedGen((prev) => new Set(prev).add(c.id))}
            />
          ))}
        </div>
      )}

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

      {/* —— 权益预检提示（未订阅时，红只做关键信号） —— */}
      {!canUseLLM && !inTheater && (
        <div className="studio-rise mt-5 flex w-full items-center gap-2.5 rounded-[12px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-4 py-3 text-[13px] text-[var(--ink2)] shadow-[var(--card)]">
          <Lock size={16} weight="fill" className="shrink-0 text-[var(--red)]" />
          <span className="flex-1">AI 造课为订阅会员专享，订阅后即可无限生成专属课程。</span>
          <Button href="/pricing" size="sm" variant="primary">去订阅</Button>
        </div>
      )}

      {/* —— 主体：编辑态 / 剧场态 / 完成态 —— */}
      {phase === "idle" ? (
        <div className="studio-rise mt-5 w-full rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card),var(--inner-hi)] sm:p-6">
          {tab === "generate" ? (
            <div className="flex flex-col gap-4">
              <div className="relative">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={5}
                  maxLength={500}
                  placeholder="描述你想学的，比如：讲讲 Python 装饰器，我是初学者"
                  className="w-full resize-none rounded-[14px] border border-[var(--border2)] bg-[var(--surface-inset)] px-4 py-3.5 text-[16px] leading-relaxed text-[var(--ink)] shadow-[var(--inner-hi)] outline-none transition-[border-color,background-color,box-shadow] duration-200 placeholder:text-[var(--ink4)] focus:border-[var(--red)] focus:bg-[var(--surface)] focus:shadow-[0_0_0_3px_var(--red-soft)]"
                />
                <span className="mono pointer-events-none absolute bottom-3 right-3.5 text-[10px] text-[var(--ink4)]">
                  {prompt.length}/500
                </span>
              </div>

              {/* 「试试这些」灵感 chip：点击即填充 prompt，给空输入框一个启动引导（与 iOS 端一致） */}
              <div className="flex flex-col gap-2">
                <span className="mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ink4)]">试试这些</span>
                <div className="flex flex-wrap gap-2">
                  {PROMPT_EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => setPrompt(ex)}
                      className="studio-press rounded-full border border-[var(--border)] bg-[var(--surface2)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--ink3)] transition-all duration-150 hover:border-[var(--border2)] hover:text-[var(--ink)]"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
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

              {/* v3.1：生成视频课件开关。选中后逐节写完块课件，再把课件转成带旁白的视频课件。 */}
              <button
                type="button"
                role="switch"
                aria-checked={genVideo}
                onClick={() => setGenVideo((v) => !v)}
                className={`studio-press flex min-h-[44px] items-center gap-3 rounded-[14px] border px-4 py-3 text-left transition-colors duration-150 ${
                  genVideo
                    ? "border-[var(--red-soft-border)] bg-[var(--red-soft)]"
                    : "border-[var(--border)] bg-[var(--surface2)] hover:border-[var(--border2)]"
                }`}
              >
                <span
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] ${
                    genVideo ? "bg-[var(--red)] text-white" : "bg-[var(--surface)] text-[var(--ink3)]"
                  }`}
                >
                  <Play size={16} weight="fill" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold text-[var(--ink)]">同时生成视频课件</span>
                  <span className="block text-[12px] leading-snug text-[var(--ink3)]">把每节课件转成带旁白讲解的视频，学习页可切换观看</span>
                </span>
                {/* 开关轨道：reduce-motion 下无位移动画也能看清开合（颜色 + 位置双编码） */}
                <span
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${
                    genVideo ? "bg-[var(--red)]" : "bg-[var(--border2)]"
                  }`}
                  aria-hidden="true"
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-[var(--card)] transition-transform duration-200 ${
                      genVideo ? "translate-x-[22px]" : "translate-x-0.5"
                    }`}
                  />
                </span>
              </button>

              <button
                type="button"
                onClick={handleGenerate}
                className="cta-glow studio-press group inline-flex w-full items-center justify-center gap-2 rounded-[14px] bg-[var(--red)] px-5 py-3.5 text-[15px] font-semibold text-white transition-colors duration-200 hover:bg-[var(--red-hover)]"
              >
                <Sparkle size={17} weight="fill" />
                生成课程
                <ArrowRight size={16} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* §4 导入收益六宫格：stagger 递延进场 + hover 抬升，材质分级到 surface2 */}
              <div className="stagger grid grid-cols-2 gap-2 sm:grid-cols-3">
                {IMPORT_BENEFITS.map((b, i) => (
                  <div
                    key={b.label}
                    style={{ "--i": i } as CSSProperties}
                    className="studio-lift flex cursor-default flex-col gap-1 rounded-[12px] border border-[var(--border)] bg-[var(--surface2)] px-3 py-2.5 shadow-[var(--card)]"
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
                className="w-full rounded-[14px] border border-[var(--border2)] bg-[var(--surface-inset)] px-4 py-3 text-[15px] text-[var(--ink)] shadow-[var(--inner-hi)] outline-none transition-[border-color,background-color,box-shadow] duration-200 placeholder:text-[var(--ink4)] focus:border-[var(--red)] focus:bg-[var(--surface)] focus:shadow-[0_0_0_3px_var(--red-soft)]"
              />
              <div className="relative">
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  rows={8}
                  maxLength={50000}
                  placeholder="把你的学习资料 / PDF 内容 / 文章粘贴进来，AI 帮你整理成可学的课"
                  className="w-full resize-none rounded-[14px] border border-[var(--border2)] bg-[var(--surface-inset)] px-4 py-3.5 text-[15px] leading-relaxed text-[var(--ink)] shadow-[var(--inner-hi)] outline-none transition-[border-color,background-color,box-shadow] duration-200 placeholder:text-[var(--ink4)] focus:border-[var(--red)] focus:bg-[var(--surface)] focus:shadow-[0_0_0_3px_var(--red-soft)]"
                />
                <span className="mono pointer-events-none absolute bottom-3 right-3.5 text-[10px] text-[var(--ink4)]">
                  {importText.length}/50000
                </span>
              </div>
              <button
                type="button"
                onClick={handleImport}
                className="cta-glow studio-press group inline-flex w-full items-center justify-center gap-2 rounded-[14px] bg-[var(--red)] px-5 py-3.5 text-[15px] font-semibold text-white transition-colors duration-200 hover:bg-[var(--red-hover)]"
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
          onViewShelf={() => router.push("/me/courses")}
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
   TypewriterText —— 造课打字机（节标题逐字浮现 + 光标闪烁）
   ------------------------------------------------------------
   备课剧场里当前正在写的节标题逐字打出，把等待变成「看 AI 写作」的表演。
   - 纯客户端、纯计算，无任何 server import；只依赖 React state + 定时器。
   - text 变化（切到下一节）即从头重打。
   - reduce-motion：直接给出完整文字、不显示光标（.tw-caret CSS 已隐藏）。
   - 卸载/文本切换时清定时器，无泄漏。
   ============================================================ */
function TypewriterText({ text, speed = 45 }: { text: string; speed?: number }) {
  const [shown, setShown] = useState("");
  const reduceRef = useRef(false);

  useEffect(() => {
    // 一次性读取用户动效偏好；reduce 时直接落全文，跳过逐字。
    reduceRef.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceRef.current || !text) {
      setShown(text);
      return;
    }

    setShown("");
    let i = 0;
    // 用 Array.from 以码点为单位推进，避免把中文/emoji 拆坏。
    const chars = Array.from(text);
    const timer = window.setInterval(() => {
      i += 1;
      setShown(chars.slice(0, i).join(""));
      if (i >= chars.length) window.clearInterval(timer);
    }, speed);
    return () => window.clearInterval(timer);
  }, [text, speed]);

  const typing = !reduceRef.current && shown.length < Array.from(text).length;

  return (
    <span className="font-semibold text-[var(--ink)]">
      {shown}
      {/* 光标：写作中闪烁，打完自动隐；reduce-motion 下 CSS 直接不显示 */}
      <span className="tw-caret" data-typing={typing} aria-hidden="true" />
    </span>
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
    <div className="studio-rise mt-5 w-full rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card),var(--inner-hi)] sm:p-6">
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
              <span key={doneCount} className="num-pop mono text-[11px] font-semibold text-[var(--ink2)]">
                <span className="text-[var(--ink)]">{doneCount}</span>/{total}
              </span>
            )}
          </div>

          {/* 逐节写作时的当前节提示：节标题逐字浮现（打字机），把等待变成看 AI 写作。
              key=writingIndex 使切到下一节时重挂载、从头重打。 */}
          {phase === "lessons" && writingIndex < total && lessons[writingIndex]?.state === "writing" && (
            <p className="mb-3 text-[13px] text-[var(--ink2)]">
              正在写第 <span key={writingIndex} className="num-pop mono font-semibold text-[var(--red)]">{writingIndex + 1}/{total}</span> 节：
              <TypewriterText key={`tw-${writingIndex}`} text={lessons[writingIndex].title} />
            </p>
          )}

          <ul className="flex flex-col gap-1.5">
            {lessons.map((l, i) => (
              <li
                key={l.id}
                className={`studio-slide flex items-center gap-2.5 rounded-[10px] border px-3 py-2 transition-colors duration-200 ${
                  l.state === "writing"
                    ? // 正在写的这行自己发光：提亮到 surface + 一道红左边框，和顶部「正在写第 N 节」提示形成注意力接力
                      "border-[var(--red-soft-border)] border-l-2 border-l-[var(--red)] bg-[var(--surface)] shadow-[var(--card)]"
                    : "border-[var(--border)] bg-[var(--surface2)]"
                }`}
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
                  <span className="mono shrink-0 rounded-full border border-[var(--warn)]/40 bg-[var(--warn-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ink2)]">
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

      {/* 大纲未回来前的等待态（步骤1/2）：贴合大纲布局的骨架预览，而非孤零一句 */}
      {total === 0 && (
        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <div className="flex items-center gap-2.5">
            <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--red)] border-t-transparent" />
            <span className="text-[13px] font-medium text-[var(--ink2)]">
              {phase === "understand"
                ? source === "import"
                  ? "正在通读你的资料…"
                  : "正在读懂你的需求…"
                : source === "import"
                ? "正在按主题拆分章节…"
                : "正在设计课程大纲…"}
            </span>
          </div>
          {/* 大纲骨架占位（预告即将逐条浮现的章节结构） */}
          <ul className="mt-3.5 flex flex-col gap-1.5" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <li
                key={i}
                className="flex items-center gap-2.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface2)] px-3 py-2"
              >
                <span className="skeleton h-[17px] w-[17px] shrink-0 rounded-full" />
                <span className="skeleton h-3 rounded-full" style={{ width: `${72 - i * 12}%` }} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 单节状态图标：完成 ✓ 用 --ok（绿），失败用 --warn（琥珀），写作中用红（live 生成信号） */
function LessonStateIcon({ state, index }: { state?: LessonState; index: number }) {
  if (state === "done")
    return <CheckCircle key="done" size={17} weight="fill" className="num-pop shrink-0 text-[var(--ok)]" />;
  if (state === "failed")
    return <XCircle size={17} weight="fill" className="shrink-0 text-[var(--warn)]" />;
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
   ShareToMarketInline —— 完成页内联「分享到集市」按钮
   ------------------------------------------------------------
   调现有 /api/market/share（入参 courseId）。分享前服务端 LLM 审核课程标题+简介：
     shared → 已上架；pending → 转人工；rejected → 返回 fail 文案。
   已上架/审核中显示只读态。纯 client fetch，不引任何 server 链。
   ============================================================ */
type ShareStatus = "idle" | "pending" | "shared" | "rejected";

function ShareToMarketInline({ courseId }: { courseId: string }) {
  const { toast } = useToast();
  const [status, setStatus] = useState<ShareStatus>("idle");
  const [loading, setLoading] = useState(false);

  async function share() {
    if (loading || status === "shared" || status === "pending") return;
    setLoading(true);
    try {
      const res = await fetch("/api/market/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; data: { status: string; message: string } }
        | { ok: false; error: string }
        | null;
      if (!json?.ok) {
        // 审核不通过（rejected）或其他错误：标红提示，本地切到 rejected 可重试
        setStatus("rejected");
        toast(json?.error ?? "分享失败，请稍后再试", { tone: "warn" });
        return;
      }
      const next = json.data.status as ShareStatus;
      setStatus(next === "shared" ? "shared" : next === "pending" ? "pending" : "rejected");
      toast(json.data.message, { tone: next === "shared" ? "success" : "info" });
      track("market_share", { course_id: courseId, status: next });
    } catch {
      toast("网络异常，请重试", { tone: "warn" });
    } finally {
      setLoading(false);
    }
  }

  if (status === "shared") {
    return (
      <span className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-[14px] border border-[var(--border)] bg-[var(--surface-inset)] px-4 py-3.5 text-[13.5px] font-semibold text-[var(--ink2)] shadow-[var(--inner-hi)]">
        <CheckCircle size={16} weight="fill" className="text-[var(--red)]" />
        已在集市
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-[14px] border border-[var(--border)] bg-[var(--surface-inset)] px-4 py-3.5 text-[13.5px] font-semibold text-[var(--ink3)] shadow-[var(--inner-hi)]">
        <HourglassMedium size={16} weight="fill" />
        审核中
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={share}
      disabled={loading}
      className="studio-press inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-[14px] border border-[var(--border)] bg-[var(--surface2)] px-4 py-3.5 text-[13.5px] font-semibold text-[var(--ink2)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)] disabled:opacity-50"
    >
      <Export size={16} weight="bold" />
      {loading ? "审核中…" : status === "rejected" ? "重新分享" : "分享到集市"}
    </button>
  );
}

/* ============================================================
   FlyToShelf —— 完成签名动效：课本从剧场「飞入」书架方向（一次性庆祝）
   ------------------------------------------------------------
   一枚课本图标从卡片中心起飞、向右上「书架」方向缩小淡出，落定后自然消失。
   framer-motion 驱动；reduce-motion 直接不渲染（完成态本身即静态可用，零位移零闪现）。
   纯装饰（aria-hidden），pointer-events-none 不挡任何按钮点击。
   ============================================================ */
function FlyToShelf() {
  const reduce = useReducedMotion();
  // reduce-motion：直接跳过，完成态静态显示，不做任何位移/缩放。
  if (reduce) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <motion.span
        className="absolute left-1/2 top-1/2 flex h-11 w-11 items-center justify-center rounded-[12px] bg-[var(--red)] shadow-[var(--red-glow)]"
        initial={{ x: "-50%", y: "-50%", scale: 0.6, opacity: 0 }}
        animate={{
          x: ["-50%", "-50%", "calc(-50% + 180px)"],
          y: ["-50%", "-60%", "calc(-50% - 150px)"],
          scale: [0.6, 1, 0.35],
          opacity: [0, 1, 0],
          rotate: [0, -8, 12],
        }}
        transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1], times: [0, 0.35, 1] }}
      >
        <BookOpen size={22} weight="fill" className="text-white" />
      </motion.span>
    </div>
  );
}

/* ============================================================
   完成面板：造课「这门课包含」清单 / 导入「升维报告」+ 通电点亮课程卡
   闭环：顶部「已放入你的书架」确定感 + 签名飞书动效 + 三按钮去向引导
        （立即开始学 / 查看我的书架 / 分享到集市）。
   ============================================================ */
function DonePanel({
  source,
  summary,
  lessons,
  onStart,
  onViewShelf,
  onRetry,
  onReset,
}: {
  source: "generate" | "import";
  summary: DoneSummary;
  lessons: OutlineLesson[];
  onStart: () => void;
  onViewShelf: () => void;
  onRetry: (lessonId: string) => void;
  onReset: () => void;
}) {
  const reduce = useReducedMotion();
  const failed = lessons.filter((l) => l.state === "failed");
  const isImport = source === "import";

  // 「这门课包含」/「升维报告」条目。
  // 大数字行只放纯数字（保证 18px extrabold 强调档整齐）；「AI 伴侣」不是可数量，
  // 数字槽改用 Check 图标点亮它的「已就位」状态，不再把中文词塞进数字位撑爆节奏。
  const facts: { Icon: typeof BookOpen; num?: number; check?: boolean; label: string }[] = isImport
    ? [
        { Icon: BookOpen, num: summary.total, label: "章" },
        { Icon: MagicWand, num: summary.quizzes, label: "个测验" },
        { Icon: Cards, num: summary.cards, label: "张要点卡" },
        { Icon: Sparkle, check: true, label: "AI 伴侣读完全文" },
      ]
    : [
        { Icon: BookOpen, num: summary.total, label: "节" },
        { Icon: MagicWand, num: summary.quizzes, label: "个测验" },
        { Icon: Cards, num: summary.cards, label: "张要点卡" },
        { Icon: Sparkle, check: true, label: "AI 伴侣" },
      ];

  // v3.1：勾选了生成视频课件 → 追加一格「视频课件」，展示已发起就绪的节数。
  if (typeof summary.videos === "number") {
    facts.push({ Icon: Play, num: summary.videos, label: "节视频课件" });
  }

  return (
    <div className="studio-poweron studio-sweep relative mt-5 w-full overflow-hidden rounded-[18px] border border-[var(--red-soft-border)] bg-[var(--surface)] shadow-[var(--lift)]">
      {/* 签名飞书动效：课本飞向书架方向（一次性庆祝，reduce-motion 不渲染） */}
      <FlyToShelf />

      {/* 顶部：深色通电展示带（--video-grad 渐变，弃死黑平面），成功徽标点亮 */}
      <div
        className="relative flex items-center gap-3 overflow-hidden px-5 py-4 sm:px-6"
        style={{ background: "var(--video-grad)" }}
      >
        {/* 内顶柔光，材质而非平面 */}
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[var(--hairline-on-dark)]" />
        <span className="studio-lightup flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--red)] shadow-[var(--red-glow)]">
          <Star size={20} weight="fill" className="text-white" />
        </span>
        <div className="min-w-0">
          <div className="text-[16px] font-extrabold text-white">
            {isImport ? "升维报告" : "这门课已就绪"}
          </div>
          <div className="text-[12.5px] text-white/65">
            {isImport ? "你的资料已经变成一门可学的课" : "大纲、讲解、测验、伴侣，全部准备好了"}
          </div>
        </div>
      </div>

      {/* 「课有家了」确定感条：明确告知这门课已归入书架，去向不再模糊 */}
      {/* 结算归档（moment 3）：飞书落定后，一枚印章盖下「入册」——与复习结算同一归档语言。 */}
      <div className="relative flex items-center gap-2 border-b border-[var(--red-soft-border)] bg-[var(--red-soft)] px-5 py-2.5 sm:px-6">
        <Books size={15} weight="fill" className="shrink-0 text-[var(--red)]" />
        <span className="text-[12.5px] font-semibold text-[var(--red-ink)]">已放入你的书架</span>
        <span className="text-[11px] font-semibold text-[var(--red)]/70">· {isImport ? "资料升维" : "AI 造课"}</span>
        <ArchiveStamp active={!reduce} label="已入册" className="ml-auto" />
      </div>

      <div className="p-5 sm:p-6">
      {/* 升维报告：字数 → 结构化 转化句 */}
      {isImport && summary.chars ? (
        <p className="rounded-[12px] border border-[var(--border)] bg-[var(--surface-inset)] px-4 py-3 text-[13.5px] leading-relaxed text-[var(--ink2)] shadow-[var(--inner-hi)]">
          你的 <span className="mono font-bold text-[var(--ink)]">{summary.chars.toLocaleString()}</span> 字资料
          <ArrowRight size={13} weight="bold" className="mx-1.5 inline align-middle text-[var(--red)]" />
          <span className="mono font-bold text-[var(--ink)]">{summary.total}</span> 章 ·
          <span className="mono font-bold text-[var(--ink)]"> {summary.quizzes}</span> 测验 ·
          <span className="mono font-bold text-[var(--ink)]"> {summary.cards}</span> 要点卡 · 伴侣已读完全文
        </p>
      ) : (
        <p className="text-[13.5px] font-semibold text-[var(--ink2)]">这门课包含：</p>
      )}

      {/* 事实清单：stagger 递延点亮，数字 .num-pop 强调 */}
      <div className="stagger mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {facts.map((f, i) => (
          <div
            key={f.label}
            style={{ "--i": i } as CSSProperties}
            className="flex flex-col items-center gap-1 rounded-[12px] border border-[var(--border)] bg-[var(--surface2)] px-3 py-3 text-center shadow-[var(--card)]"
          >
            <f.Icon size={18} weight="fill" className="text-[var(--red)]" />
            {f.check ? (
              // 「已就位」用 Check 图标占数字槽——与前三格纯数字同高，不撑爆 18px 数字位
              <span className="num-pop flex h-[22px] items-center leading-none text-[var(--ok)]">
                <Check size={19} weight="bold" />
              </span>
            ) : (
              <span className="num-pop mono text-[18px] font-extrabold leading-none text-[var(--ink)]">{f.num}</span>
            )}
            <span className="text-[11px] leading-snug text-[var(--ink3)]">{f.label}</span>
          </div>
        ))}
      </div>

      {/* 部分失败：可重试的章节（--warn 语义，非红信号） */}
      {failed.length > 0 && (
        <div className="mt-4 rounded-[12px] border border-[var(--warn)]/30 bg-[var(--warn-soft)] px-4 py-3">
          <p className="text-[12.5px] font-semibold text-[var(--ink2)]">
            有 <span className="mono font-bold text-[var(--ink)]">{failed.length}</span> 节暂未写完，可单独重试：
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {failed.map((l) => (
              <li key={l.id} className="flex items-center gap-2">
                <XCircle size={15} weight="fill" className="shrink-0 text-[var(--warn)]" />
                <span className="flex-1 truncate text-[12.5px] text-[var(--ink2)]">{l.title}</span>
                <button
                  type="button"
                  onClick={() => onRetry(l.id)}
                  disabled={l.state === "writing"}
                  className="studio-press mono shrink-0 rounded-full border border-[var(--warn)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink2)] transition-colors hover:bg-[var(--warn)] hover:text-white disabled:opacity-50"
                >
                  {l.state === "writing" ? "写作中…" : "重试"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 主行动 —— 造课完成闭环三去向：立即开始学 / 查看我的书架 / 分享到集市 */}
      <div className="mt-5 flex flex-col gap-2.5">
        {/* 首选：立即开始学（红 CTA，最强引导） */}
        <button
          type="button"
          onClick={onStart}
          className="cta-glow studio-press group inline-flex w-full min-h-[44px] items-center justify-center gap-2 rounded-[14px] bg-[var(--red)] px-5 py-3.5 text-[15px] font-semibold text-white transition-colors duration-200 hover:bg-[var(--red-hover)]"
        >
          <BookOpen size={17} weight="fill" />
          立即开始学
          <ArrowRight size={16} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" />
        </button>

        {/* 次选一行：查看我的书架 + 分享到集市（同权重，克制不抢红） */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onViewShelf}
            className="studio-press inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-[14px] border border-[var(--border)] bg-[var(--surface2)] px-4 py-3.5 text-[13.5px] font-semibold text-[var(--ink2)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)]"
          >
            <Books size={16} weight="fill" />
            查看我的书架
          </button>
          <ShareToMarketInline courseId={summary.courseId} />
        </div>

        {/* 再来一门：弱化为文字入口，不与三去向争夺注意力 */}
        <button
          type="button"
          onClick={onReset}
          className="studio-press mx-auto mt-0.5 inline-flex min-h-[44px] items-center justify-center px-4 py-2.5 text-[13px] font-semibold text-[var(--ink3)] transition-colors hover:text-[var(--ink)]"
        >
          再来一门
        </button>
      </div>
      </div>
    </div>
  );
}

/* ============================================================
   GeneratingBanner —— 生产中横幅（顶部提示 + 回到剧场）
   服务端 after() 关页面也继续跑；这里显示课名 + 进度环 + 回到剧场按钮。
   自身轻量轮询保持进度环随后台推进更新；genStatus=ready 时轮询自然停止。
   ============================================================ */
function GeneratingBanner({
  course,
  onEnter,
  onDismiss,
}: {
  course: GeneratingCourse;
  onEnter: () => void;
  onDismiss: () => void;
}) {
  // 轮询保持横幅进度环最新（复用统一 hook：仅可见时轮询、ready/failed 停）。
  const { progress } = useGenPolling(course.id);
  const total = progress?.total ?? course.total;
  const done = progress?.done ?? course.done;
  const ready = progress?.genStatus === "ready";
  const failed = progress?.genStatus === "failed";

  return (
    <div className="studio-rise flex items-center gap-3.5 rounded-[14px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-4 py-3 shadow-[var(--card)]">
      <ProgressRing done={done} total={total} size={42} stroke={4} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="mono text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--red-ink)]">
            {ready ? "已就绪" : failed ? "部分待续" : "生产中"}
          </span>
          {!ready && !failed && <Spinner size={11} />}
        </div>
        <p className="mt-0.5 truncate text-[14px] font-bold text-[var(--ink)]">{course.title}</p>
        <p className="mono mt-0.5 text-[11px] text-[var(--ink3)]">
          {course.isImport ? "升维" : "生成"}进度 <span className="font-semibold text-[var(--ink2)]">{done}</span>/{total} 节
          {!ready && !failed ? " · 关闭页面也会继续生成" : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onEnter}
          className="studio-press inline-flex items-center gap-1.5 rounded-[11px] bg-[var(--red)] px-3.5 py-2 text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-[var(--red-hover)]"
        >
          <ArrowUUpLeft size={14} weight="bold" />
          回到剧场
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="收起提示"
          className="studio-press grid h-8 w-8 place-items-center rounded-[10px] text-[var(--ink4)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--ink2)]"
        >
          <XCircle size={17} weight="regular" />
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   RecoveryTheater —— 从服务端进度水合恢复的剧场
   进入正在生成的课：拉 gen-progress 得各节 ready 状态，直接渲染到当前进度
   （已完成节标✓、进行中节转圈），并按 3s 轮询（仅页面可见），ready 时停并给出「开始学习」。
   ============================================================ */
function RecoveryTheater({
  course,
  onExit,
  onDone,
}: {
  course: GeneratingCourse;
  onExit: () => void;
  onDone: (courseId: string) => void;
}) {
  const router = useRouter();
  const { progress, loading, error } = useGenPolling(course.id, {
    onReady: () => onDone(course.id),
  });

  const total = progress?.total ?? course.total;
  const done = progress?.done ?? course.done;
  const failed = progress?.failed ?? 0;
  const genStatus = progress?.genStatus ?? "generating";
  const isReady = genStatus === "ready";
  const isFailed = genStatus === "failed";
  const currentLessonId = progress?.currentLessonId ?? null;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  // 章节行：优先用服务端 lessons（含 ready/title）；进度未回来前用预取的节数占位。
  const lessons: { id: string; title: string; ready: boolean }[] =
    progress?.lessons && progress.lessons.length > 0
      ? progress.lessons
      : Array.from({ length: Math.max(total, 1) }, (_, i) => ({
          id: `ph-${i}`,
          title: "",
          ready: i < done,
        }));

  const startHref = course.firstLessonId
    ? `/courses/${course.slug}/learn/${course.firstLessonId}`
    : `/courses/${course.slug}`;

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col items-center">
      {/* 顶部：返回 + 课名 + 进度环 */}
      <div className="mb-4 flex w-full items-center gap-3">
        <button
          type="button"
          onClick={onExit}
          className="studio-press inline-flex shrink-0 items-center gap-1.5 rounded-[11px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] font-semibold text-[var(--ink2)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)]"
        >
          <ArrowUUpLeft size={14} weight="bold" />
          返回造课
        </button>
        <div className="min-w-0 flex-1 text-center">
          <div className="mono text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--red)]">
            {isReady ? "AI STUDIO · 已就绪" : "AI STUDIO · 恢复中"}
          </div>
        </div>
        <div className="w-[92px] shrink-0" aria-hidden="true" />
      </div>

      <div className="studio-rise w-full rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card),var(--inner-hi)] sm:p-6">
        {/* 头部：进度环 + 标题 + 状态句 */}
        <div className="flex items-center gap-4">
          <ProgressRing done={done} total={total} size={56} stroke={5} showLabel={false} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[17px] font-extrabold tracking-tight text-[var(--ink)]">{course.title}</h2>
            <p className="mt-1 flex items-center gap-1.5 text-[13px] text-[var(--ink2)]">
              {isReady ? (
                <>
                  <CheckCircle size={15} weight="fill" className="shrink-0 text-[var(--ok)]" />
                  全部 <span className="mono font-semibold text-[var(--ink)]">{total}</span> 节已生成，随时可学
                </>
              ) : isFailed ? (
                <>
                  <XCircle size={15} weight="fill" className="shrink-0 text-[var(--warn)]" />
                  已生成 <span className="mono font-semibold text-[var(--ink)]">{done}</span>/{total} 节，可在「我的课」继续生成
                </>
              ) : (
                <>
                  <Spinner size={13} />
                  正在逐节生成 <span className="mono font-semibold text-[var(--red)]">{done}</span>/{total} 节，关闭页面也会继续
                </>
              )}
            </p>
          </div>
          <span className="mono shrink-0 self-start text-[13px] font-bold text-[var(--ink2)]">{pct}%</span>
        </div>

        {/* 首帧加载 / 错误态 */}
        {loading && !progress ? (
          <div className="mt-5 flex items-center gap-2.5 border-t border-[var(--border)] pt-4">
            <Spinner size={16} />
            <span className="text-[13px] font-medium text-[var(--ink2)]">正在同步生成进度…</span>
          </div>
        ) : error && !progress ? (
          <div className="mt-5 border-t border-[var(--border)] pt-4">
            <p className="text-[13px] text-[var(--ink2)]">进度暂时拉取失败，页面可见时会自动重试。</p>
          </div>
        ) : (
          <>
            {/* 章节列表：✓ 已完成 / 转圈 进行中 / 序号 待生成 */}
            <div className="mt-5 border-t border-[var(--border)] pt-4">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ink4)]">
                  {course.isImport ? "升维章节" : "课程大纲"} · {total} 节
                </span>
                <span key={done} className="num-pop mono text-[11px] font-semibold text-[var(--ink2)]">
                  <span className="text-[var(--ink)]">{done}</span>/{total}
                </span>
              </div>

              <ul className="flex flex-col gap-1.5">
                {lessons.map((l, i) => {
                  // 进行中节：未 ready 且是 currentLessonId（无 current 时取第一个未 ready）。
                  const firstPendingIdx = lessons.findIndex((x) => !x.ready);
                  const isCurrent =
                    !l.ready &&
                    !isFailed &&
                    (currentLessonId ? l.id === currentLessonId : i === firstPendingIdx);
                  return (
                    <li
                      key={l.id}
                      className={`flex items-center gap-2.5 rounded-[10px] border px-3 py-2 transition-colors duration-200 ${
                        isCurrent
                          ? "border-[var(--red-soft-border)] border-l-2 border-l-[var(--red)] bg-[var(--surface)] shadow-[var(--card)]"
                          : "border-[var(--border)] bg-[var(--surface2)]"
                      }`}
                    >
                      {l.ready ? (
                        <CheckCircle size={17} weight="fill" className="shrink-0 text-[var(--ok)]" />
                      ) : isCurrent ? (
                        <Spinner size={16} />
                      ) : (
                        <span className="mono flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full border border-[var(--border2)] text-[10px] font-semibold text-[var(--ink4)]">
                          {i + 1}
                        </span>
                      )}
                      {isCurrent && l.title ? (
                        // 恢复剧场里当前生成中的节：标题同样逐字浮现。key=l.id 使切到下一节才重打，
                        // 3s 轮询的同节重渲染不重启打字。truncate 会裁掉光标，故此行不截断。
                        <span className="min-w-0 flex-1 text-[13.5px]">
                          <TypewriterText key={`rtw-${l.id}`} text={l.title} />
                        </span>
                      ) : (
                        <span
                          className={`flex-1 truncate text-[13.5px] ${
                            l.ready
                              ? "font-medium text-[var(--ink)]"
                              : isCurrent
                              ? "font-medium text-[var(--ink)]"
                              : "text-[var(--ink3)]"
                          }`}
                        >
                          {l.title || `第 ${i + 1} 节`}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>

              {/* 底部进度条 */}
              <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-[var(--border2)]">
                <div className="h-full rounded-full bg-[var(--red)] transition-all duration-300" style={{ width: `${pct}%` }} />
              </div>
              {failed > 0 && !isReady && (
                <p className="mt-2 text-[11.5px] text-[var(--ink3)]">
                  有 <span className="mono font-semibold text-[var(--ink2)]">{failed}</span> 节暂未写完，可到「我的课」继续生成。
                </p>
              )}
            </div>

            {/* 就绪：开始学习 CTA */}
            {isReady && (
              <button
                type="button"
                onClick={() => router.push(startHref)}
                className="cta-glow studio-press group mt-5 inline-flex w-full items-center justify-center gap-2 rounded-[14px] bg-[var(--red)] px-5 py-3.5 text-[15px] font-semibold text-white transition-colors duration-200 hover:bg-[var(--red-hover)]"
              >
                <BookOpen size={17} weight="fill" />
                开始学习
                <ArrowRight size={16} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
