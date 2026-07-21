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
  FileArrowUp,
  FilePdf,
  FileDoc,
  FileText,
  SlidersHorizontal,
  Pause,
  Plus,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { TemplateModelPicker } from "@/components/TemplateModelPicker";
import { ArchiveStamp } from "@/components/motion";
import { useToast } from "@/components/Toast";
import { track } from "@/lib/analytics-client";
import Link from "next/link";
import { ProgressRing, Spinner, useAutoGoCountdown, useGenPolling, type GenProgress } from "@/components/GenProgress";
import { GenStage, TypewriterText, type GenStageLesson, type GenStageLessonState } from "@/components/GenStage";
import { CoursewareManager } from "@/components/CoursewareManager";
import { OutlineCheckpoint } from "@/components/OutlineCheckpoint";
import { trackLabel } from "@/lib/tracks";

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

/**
 * L2 大纲检查点恢复：由 /create server component 预取的「最近一份未确认大纲草稿」。
 * 用户离开检查点后回到 /create，用它把检查点重新打开（否则 outline_draft 无客户端入口）。
 */
export interface DraftCheckpoint {
  courseId: string;
  slug: string;
  title: string;
  lessons: { id: string; title: string }[];
  isImport?: boolean;
}

// 赛道选项（只取造课常用赛道；label 从 lib/tracks.ts 单一真源派生，避免两处手抄漂移）。
const TRACK_OPTIONS: { key: string; label: string }[] = [
  "ai_skill",
  "english_oral",
  "english_foundation",
  "life",
  "silver_english",
].map((key) => ({ key, label: trackLabel(key) }));

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

type Tab = "generate" | "import" | "manual";

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
type Phase = "idle" | "understand" | "outline" | "checkpoint" | "lessons" | "done";

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

export interface ManualCourseState {
  id: string;
  slug: string;
  title: string;
  lessons: { id: string; title: string }[];
}

/** 不调用 AI 的手工建课入口：先建课程与首张空白画布，再交给统一内容块管理器。 */
function ManualCourseBuilder({ canUseLLM, initialCourse = null }: { canUseLLM: boolean; initialCourse?: ManualCourseState | null }) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [category, setCategory] = useState("ai_skill");
  const [busy, setBusy] = useState(false);
  const [course, setCourse] = useState<ManualCourseState | null>(initialCourse);

  async function createManualCourse() {
    const cleanTitle = title.trim();
    if (!cleanTitle || busy) {
      if (!cleanTitle) toast("先给课程起个名字吧", { tone: "info" });
      return;
    }
    setBusy(true);
    try {
      const courseRes = await fetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ title: cleanTitle, subtitle: subtitle.trim() || undefined, category }),
      });
      const courseJson = await courseRes.json().catch(() => null);
      if (!courseRes.ok || !courseJson?.ok || !courseJson.data?.course?.id) {
        throw new Error(courseJson?.error || "创建课程失败");
      }
      const created = courseJson.data.course as { id: string; slug: string; title: string };
      const lessonRes = await fetch("/api/lessons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ courseId: created.id, title: "第一节 · 开始创作" }),
      });
      const lessonJson = await lessonRes.json().catch(() => null);
      const firstLesson = lessonRes.ok && lessonJson?.ok && lessonJson.data?.lesson?.id
        ? [{ id: lessonJson.data.lesson.id as string, title: lessonJson.data.lesson.title as string }]
        : [];
      setCourse({ ...created, lessons: firstLesson });
      track("course_manual_workspace_open", { course_id: created.id });
      toast(firstLesson.length ? "课程和第一张空白画布已创建" : "课程已创建，可在下方新增课节", { tone: "success" });
    } catch (e) {
      toast(e instanceof Error ? e.message : "创建失败，请稍后再试", { tone: "warn" });
    } finally {
      setBusy(false);
    }
  }

  if (course) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-[14px] border border-[var(--ok)]/25 bg-[var(--ok-soft)] px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[var(--surface)] text-[var(--ok)]"><Check size={17} weight="bold" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold text-[var(--ink)]">《{course.title}》已建立</p>
              <p className="mt-0.5 text-[12px] text-[var(--ink3)]">内容、结构与课节数量都由你决定；保存内容块后系统会自动生成可学习课件。</p>
            </div>
            <Link href="/me/courses" className="shrink-0 text-[12px] font-semibold text-[var(--ink2)] hover:text-[var(--ink)]">查看我的课</Link>
          </div>
        </div>
        <CoursewareManager courseId={course.id} lessons={course.lessons} isSubscriber={canUseLLM} allowAddLesson />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="mono mb-1.5 block text-[11px] uppercase tracking-[0.14em] text-[var(--ink4)]">课程标题</span>
          <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 120))} placeholder="比如：我的产品设计方法课" className="w-full rounded-[14px] border border-[var(--border2)] bg-[var(--surface-inset)] px-4 py-3 text-[15px] outline-none focus:border-[var(--red)] focus:bg-[var(--surface)]" />
        </label>
        <label>
          <span className="mono mb-1.5 block text-[11px] uppercase tracking-[0.14em] text-[var(--ink4)]">课程方向</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="min-h-[46px] w-full rounded-[14px] border border-[var(--border2)] bg-[var(--surface-inset)] px-4 text-[14px] outline-none focus:border-[var(--red)]">
            {TRACK_OPTIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </label>
        <label>
          <span className="mono mb-1.5 block text-[11px] uppercase tracking-[0.14em] text-[var(--ink4)]">一句话说明 · 可选</span>
          <input value={subtitle} onChange={(e) => setSubtitle(e.target.value.slice(0, 180))} placeholder="这门课帮助谁解决什么问题" className="min-h-[46px] w-full rounded-[14px] border border-[var(--border2)] bg-[var(--surface-inset)] px-4 text-[14px] outline-none focus:border-[var(--red)]" />
        </label>
      </div>
      <div className="rounded-[12px] border border-dashed border-[var(--border2)] bg-[var(--surface2)] px-4 py-3">
        <p className="text-[13px] font-semibold text-[var(--ink)]">从真正的空白开始</p>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--ink3)]">创建后可新增任意课节，并自由插入概念、场景、对话、代码、公式、图示、测验等 18 类内容块。整个过程不消耗 AI 额度。</p>
      </div>
      <button type="button" onClick={() => void createManualCourse()} disabled={busy || !title.trim()} className="studio-press inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-[14px] bg-[var(--ink)] px-5 text-[15px] font-semibold text-[var(--surface)] disabled:opacity-50">
        {busy ? <Spinner size={15} /> : <Plus size={17} weight="bold" />}
        {busy ? "正在建立空白课程" : "创建空白课程"}
      </button>
    </div>
  );
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
  draftCheckpoint = null,
  initialManualCourse = null,
}: {
  canUseLLM: boolean;
  /** 服务端预取的「生成中的课」，用于剧场恢复（生产中横幅 + 回到剧场）。 */
  generatingCourses?: GeneratingCourse[];
  /** L2 服务端预取的「未确认大纲草稿」，用于回到 /create 时重开检查点。 */
  draftCheckpoint?: DraftCheckpoint | null;
  /** 从“我的课”回来继续编辑的手工课程。 */
  initialManualCourse?: ManualCourseState | null;
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
  // v6：空值表示自由导演；只有用户在专业模式明确选中时才把某种创作偏好传给模型。
  const [template, setTemplate] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [qualityTier, setQualityTier] = useState<"standard" | "premium">("standard");
  // L2 专业模式：开则造课先停在大纲检查点（outline_draft），由用户确认后再扇出逐节生成。
  const [proMode, setProMode] = useState(false);
  // L1 课程蓝图（专业模式展开）：受众/口吻/篇幅/块偏好/参考资料,透传进生成 prompt + grounding。
  const [bpAudience, setBpAudience] = useState<string>("");
  const [bpTone, setBpTone] = useState<string>("");
  const [bpLength, setBpLength] = useState<string>("");
  const [bpBlockPrefs, setBpBlockPrefs] = useState<string[]>([]);
  const [bpReference, setBpReference] = useState<string>("");
  // 大纲检查点数据（generate-course 返回 checkpoint:true 时填充；确认后清空进剧场）。
  const [checkpoint, setCheckpoint] = useState<{ courseId: string; slug: string; title: string; lessons: OutlineLesson[]; isImport: boolean } | null>(null);
  // P1-1：AI 是否可用（服务端配了可用模型）。默认 true 避免加载态闪禁用；TemplateModelPicker
  // 拉到 defaultModel=null（未配 key）时置 false，据此禁用生成 CTA 并显示维护横幅，
  // 避免用户填完表单点生成才收到 503。
  const [aiAvailable, setAiAvailable] = useState(true);

  // —— 导入资料状态 ——
  const [importTitle, setImportTitle] = useState("");
  const [importText, setImportText] = useState("");
  const [importCheckpoint, setImportCheckpoint] = useState(true);
  // 文件导入：拖拽高亮态 + 隐藏 file input 引用（点击整卡触发选择）。
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // —— 剧场共享状态（造课 & 导入复用同一套阶段机）——
  const [phase, setPhase] = useState<Phase>("idle");
  const [source, setSource] = useState<"generate" | "import">("generate");
  const [lessons, setLessons] = useState<OutlineLesson[]>([]);
  const [writingIndex, setWritingIndex] = useState(0); // 当前正在写的节下标
  const [summary, setSummary] = useState<DoneSummary | null>(null);

  const busy = phase !== "idle" && phase !== "done";

  // 首页输入框带来的 ?prompt=xxx → 预填生成输入框；?tab=import → 直落导入 Tab（仅首次）
  useEffect(() => {
    const q = searchParams.get("prompt");
    if (q && q.trim()) {
      setPrompt(q.trim().slice(0, 500));
      setTab("generate");
    } else if (searchParams.get("manual")) {
      setTab("manual");
    } else if (searchParams.get("tab") === "import") {
      setTab("import");
    }
    // 仅在挂载时读一次；searchParams 引用稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // L2 大纲检查点恢复：?draft=<courseId> 且匹配预取的草稿 → 直接打开检查点（从「我的课·去确认大纲」深链进入）。
  useEffect(() => {
    if (draftCheckpoint && searchParams.get("draft") === draftCheckpoint.courseId) {
      setSource(draftCheckpoint.isImport ? "import" : "generate");
      if (draftCheckpoint.isImport) setTab("import");
      setCheckpoint({
        courseId: draftCheckpoint.courseId,
        slug: draftCheckpoint.slug,
        title: draftCheckpoint.title,
        lessons: draftCheckpoint.lessons.map((l) => ({ id: l.id, title: l.title })),
        isImport: draftCheckpoint.isImport === true,
      });
      setPhase("checkpoint");
    }
    // 仅挂载时读一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // AI 可用性探测：模板/模型选择器已迁进专业模式面板（默认不挂载），故不能再靠它上报可用性。
  // 这里独立探一次 /api/ai/models：defaultModel 为空=服务端未配可用模型 → 禁用生成 CTA + 显示维护横幅，
  // 避免用户填完表单点生成才收到 503。
  useEffect(() => {
    let alive = true;
    fetch("/api/ai/models")
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j?.ok) return;
        setAiAvailable(Boolean(j.data?.defaultModel));
      })
      .catch(() => {
        /* 网络异常不误判为不可用，保持默认 true */
      });
    return () => {
      alive = false;
    };
  }, []);

  // 组装 L1 蓝图对象（专业模式）：空字段省略,全空返回 undefined。
  function buildBlueprint(): Record<string, unknown> | undefined {
    const bp: Record<string, unknown> = {};
    if (bpAudience) bp.audience = bpAudience;
    if (bpTone) bp.tone = bpTone;
    if (bpLength) bp.length = bpLength;
    if (bpBlockPrefs.length) bp.blockPrefs = bpBlockPrefs;
    if (bpReference.trim()) bp.referenceText = bpReference.trim();
    return Object.keys(bp).length ? bp : undefined;
  }

  // 打开一份草稿的检查点（横幅「继续编辑」调用）。
  function openDraft(d: DraftCheckpoint) {
    setSource(d.isImport ? "import" : "generate");
    if (d.isImport) setTab("import");
    setCheckpoint({ courseId: d.courseId, slug: d.slug, title: d.title, lessons: d.lessons.map((l) => ({ id: l.id, title: l.title })), isImport: d.isImport === true });
    setPhase("checkpoint");
  }

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
    setCheckpoint(null);
  }

  // L2 检查点「确认开工」后：服务端已扇出，前端进入逐节剧场（writeLessons 与后台幂等并跑）。
  async function proceedFromCheckpoint(confirmedLessons: { id: string; title: string }[]) {
    if (!checkpoint) return;
    const cp = checkpoint;
    const initial = confirmedLessons.map((l) => ({ id: l.id, title: l.title, state: "pending" as LessonState }));
    setLessons(initial);
    setCheckpoint(null);
    setLiveGen({
      id: cp.courseId,
      slug: cp.slug,
      title: cp.title,
      isImport: cp.isImport,
      total: initial.length,
      done: 0,
      firstLessonId: initial[0]?.id ?? "",
    });
    setPhase("lessons");
    const succeeded = await writeLessons(initial);
    setSummary({
      courseId: cp.courseId,
      slug: cp.slug,
      firstLessonId: initial[0]?.id ?? "",
      total: initial.length,
      succeeded,
      quizzes: succeeded,
      cards: succeeded,
    });
    setLiveGen(null);
    setPhase("done");
    if (succeeded < initial.length) {
      toast(`已生成 ${succeeded}/${initial.length} 节，个别章节可在完成页重试`, { tone: "warn" });
    } else {
      toast("课程已生成，开始学习吧", { tone: "success" });
    }
  }

  // —— 造课发起后的「已落库课」引用：用于「可退出」时把它加进生产中横幅，退出不丢记录 ——
  // 大纲一回来即记下（课此刻已是 DB 里的 generating 态课），退出剧场后顶部横幅据此显示进度。
  const [liveGen, setLiveGen] = useState<GeneratingCourse | null>(null);

  /**
   * 可退出：在逐节写作途中主动离开剧场。
   * 关键契约——服务端 after() 已在响应返回后接管逐节生成（与前端 writeLessons 幂等并跑），
   * 故退出只是「停止在前端围观」，后台照常把课写完；课早已落库为 generating 态，绝不丢记录。
   * 退出后回到编辑态，顶部「生产中横幅」接手显示进度（liveGen 注入 activeGen）。
   */
  function exitTheater() {
    if (liveGen) {
      track("gen_theater_exit", { course_id: liveGen.id, source });
      // 从已关闭集合里移除（若之前关过），确保横幅能重新出现。
      setDismissedGen((prev) => {
        const next = new Set(prev);
        next.delete(liveGen.id);
        return next;
      });
    }
    resetTheater();
    toast("已转入后台生成，可在此查看进度", { tone: "info" });
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
        body: JSON.stringify({
          prompt: q,
          category: category || undefined,
          template: template || undefined,
          model: model || undefined,
          qualityTier,
          checkpoint: proMode,
          // L1 蓝图仅在专业模式下随请求带上（服务端白名单校验，空对象忽略）。
          blueprint: proMode ? buildBlueprint() : undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        if (res.status === 402) {
          resetTheater();
          return gate();
        }
        throw new Error(json?.error || "生成失败");
      }
      const data = json.data as { courseId: string; slug: string; title?: string; checkpoint?: boolean; lessons: OutlineLesson[] };
      const outline = Array.isArray(data.lessons) ? data.lessons : [];
      if (outline.length === 0) throw new Error("大纲为空，请调整需求重试");

      // L2 检查点模式：大纲已落库为 outline_draft，停在检查点让用户增删改排序，确认后才扇出。
      if (data.checkpoint) {
        setCheckpoint({ courseId: data.courseId, slug: data.slug, title: data.title || outline[0]?.title || data.slug, lessons: outline, isImport: false });
        setPhase("checkpoint");
        return;
      }

      // 课此刻已落库为 generating 态（generate-course 事务已建 Course + 空节 + course_gen job，
      // 且 after() 后台已接管生成）。记下它，供「可退出」后顶部横幅接手显示进度、绝不丢记录。
      setLiveGen({
        id: data.courseId,
        slug: data.slug,
        title: data.title || outline[0]?.title || data.slug,
        isImport: false,
        total: outline.length,
        done: 0,
        firstLessonId: outline[0].id,
      });

      // 大纲逐条浮现（GenStage 内 .gen-row-in 按 index 递延）
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
      setLiveGen(null); // 已到完成页：闭环由完成页「已放入书架」接管，撤下顶部生产中横幅候选
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
  /**
   * 导入剧场共用核心：粘贴与文件导入都走「读懂→切章→逐节写作→报告」同一阶段机，
   * 差异只在 outline() 打哪个接口。outline() 须返回 { courseId, slug, title?, charCount?, lessons }。
   */
  async function runImportTheater(opts: { outline: () => Promise<Response>; fallbackTitle: string }) {
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
      const res = await opts.outline();
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
      const data = json.data as {
        courseId: string;
        slug: string;
        title?: string;
        charCount?: number;
        lessons: OutlineLesson[];
        checkpoint?: boolean;
        directReady?: boolean;
        faithfulKind?: "presentation" | "scorm";
      };
      const outline = Array.isArray(data.lessons) ? data.lessons : [];
      if (outline.length === 0) throw new Error("未能从资料中拆出章节，请调整后重试");

      // 忠实 PPT/Keynote/SCORM 已直接生成可播放课件，严禁再走逐节 AI 改写覆盖原版式。
      if (data.directReady) {
        const ready = outline.map((lesson) => ({ ...lesson, state: "done" as LessonState }));
        setLessons(ready);
        setSummary({
          courseId: data.courseId, slug: data.slug, firstLessonId: outline[0].id,
          total: outline.length, succeeded: outline.length, quizzes: 0, cards: 0, chars: data.charCount ?? 0,
        });
        setPhase("done");
        toast(data.faithfulKind === "scorm" ? "SCORM 课程已在安全沙箱中就绪" : "演示文稿已按一页一屏忠实导入", { tone: "success" });
        return;
      }

      if (data.checkpoint) {
        setCheckpoint({
          courseId: data.courseId, slug: data.slug,
          title: data.title || opts.fallbackTitle || outline[0]?.title || data.slug,
          lessons: outline, isImport: true,
        });
        setPhase("checkpoint");
        return;
      }

      // 导入的课同样已落库为 generating 态 + after() 后台接管；记下供「可退出」横幅接手。
      setLiveGen({
        id: data.courseId,
        slug: data.slug,
        title: data.title || opts.fallbackTitle || outline[0]?.title || data.slug,
        isImport: true,
        total: outline.length,
        done: 0,
        firstLessonId: outline[0].id,
      });

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
        chars: data.charCount ?? 0,
      });
      setLiveGen(null); // 已到完成页：闭环由完成页「已放入书架」接管，撤下顶部生产中横幅候选
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

  // 粘贴文本导入
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
    await runImportTheater({
      // 注意：import-source route 约定字段为 rawText（非 sourceText）
      outline: () =>
        fetch("/api/ai/import-source", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: importTitle.trim() || undefined, rawText: text, template: template || undefined, model: model || undefined, qualityTier, checkpoint: importCheckpoint }),
        }),
      fallbackTitle: importTitle.trim(),
    });
  }

  // 支持的文件格式（前端与后端 EXT_KIND 对齐）
  const ACCEPT_EXT = ".pdf,.docx,.txt,.md,.markdown,.pptx,.key,.scorm,.zip";

  // 文件导入（拖拽 / 点击选择均走这里）
  async function handleFileImport(file: File) {
    if (busy) return;
    if (!canUseLLM) return gate();
    if (!/\.(pdf|docx|txt|md|markdown|text|pptx|key|scorm|zip)$/i.test(file.name)) {
      toast("支持 PDF / DOCX / TXT / Markdown / PPTX / Keynote / SCORM", { tone: "warn" });
      return;
    }
    const richPackage = /\.(pptx|key|scorm|zip)$/i.test(file.name);
    if (file.size > (richPackage ? 100_000_000 : 15_000_000)) {
      toast(richPackage ? "演示文稿或 SCORM 上限 100MB" : "文本文档上限 15MB", { tone: "warn" });
      return;
    }
    if (file.size === 0) {
      toast("文件内容为空", { tone: "warn" });
      return;
    }

    track("hero_cta_click", { source: "create_import_file" });
    const fd = new FormData();
    fd.append("file", file);
    if (importTitle.trim()) fd.append("title", importTitle.trim());
    if (template) fd.append("template", template);
    fd.append("qualityTier", qualityTier);
    fd.append("checkpoint", String(importCheckpoint));
    if (model) fd.append("model", model);
    await runImportTheater({
      outline: () => fetch("/api/ai/import-file", { method: "POST", body: fd }),
      fallbackTitle: importTitle.trim() || file.name.replace(/\.[^.]+$/, ""),
    });
  }

  const inTheater = phase !== "idle";

  // 恢复入口：点「回到剧场」→ 切到恢复分支（水合 + 轮询）。
  const enterRecovery = useCallback((c: GeneratingCourse) => {
    track("gen_recover_enter", { course_id: c.id });
    setRecoverCourse(c);
  }, []);

  // 生产中横幅数据：合并「服务端预取的生成中课」+「本次会话刚发起、已退出剧场的 liveGen」，
  // 去重（liveGen 优先，标题更新）、排除本次会话已关掉的课。剧场进行中(inTheater)或恢复分支不顶部提示。
  const activeGen = useMemo(() => {
    const merged = new Map<string, GeneratingCourse>();
    for (const c of generatingCourses) merged.set(c.id, c);
    if (liveGen) merged.set(liveGen.id, liveGen); // 覆盖：liveGen 携带本次会话的真实标题
    return Array.from(merged.values()).filter((c) => !dismissedGen.has(c.id));
  }, [generatingCourses, liveGen, dismissedGen]);

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

      {/* —— L2 未确认大纲草稿横幅：回到 /create 时可一键重开检查点，继续编辑/确认（否则草稿是死角） —— */}
      {!inTheater && draftCheckpoint && (
        <button
          type="button"
          onClick={() => openDraft(draftCheckpoint)}
          className="studio-press mb-5 flex w-full items-center gap-3 rounded-[14px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-4 py-3 text-left transition-colors hover:border-[var(--red)]"
        >
          <SlidersHorizontal size={16} weight="fill" className="shrink-0 text-[var(--red)]" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold text-[var(--ink)]">有一份待确认的大纲：{draftCheckpoint.title}</span>
            <span className="block text-[12px] text-[var(--ink3)]">继续编辑并确认后才会逐节生成</span>
          </span>
          <span className="mono shrink-0 text-[12px] font-semibold text-[var(--red-ink)]">继续编辑 →</span>
        </button>
      )}

      {/* —— 顶部大标题 —— */}
      <div className="mb-1.5 flex items-center gap-2 rounded-full border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-3 py-1">
        <Sparkle size={13} weight="fill" className="text-[var(--red)]" />
        <span className="mono text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--red)]">{tab === "manual" ? "CREATOR STUDIO" : "AI STUDIO"}</span>
      </div>
      <h1 className="text-center text-[30px] font-extrabold leading-[1.15] tracking-tight text-[var(--ink)] sm:text-[38px]">
        {tab === "import" ? "把任何资料，变成一门你的课" : tab === "manual" ? "从空白画布，亲手搭一门课" : "一句话，生成你的专属课"}
      </h1>
      <p className="mt-2.5 max-w-[460px] text-center text-[15px] leading-relaxed text-[var(--ink2)]">
        {tab === "import"
          ? "粘贴文章、笔记、PDF 内容，AI 现场拆章、配测验、装上伴侣，资料立刻能学。"
          : tab === "manual"
          ? "不调用 AI，不套固定章节结构。你决定课程、课节和每一个内容块。"
          : "说出你想学的，AI 现场搭好课程大纲、逐节写好讲解与测验，学完就能用。"}
      </p>

      {/* —— Tab 切换（剧场进行中隐藏，避免误触） —— */}
      {!inTheater && (
        <div className="mt-7 inline-flex gap-1 rounded-full border border-[var(--border)] bg-[var(--surface2)] p-1">
          {[
            { key: "generate" as Tab, label: "AI 生成课", Icon: MagicWand },
            { key: "import" as Tab, label: "导入我的资料", Icon: FilePlus },
            { key: "manual" as Tab, label: "空白建课", Icon: BookOpen },
          ].map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-semibold transition-all duration-150 ${
                  active ? "bg-[var(--surface)] text-[var(--ink)] shadow-[var(--card)]" : "text-[var(--ink3)] hover:text-[var(--ink)]"
                }`}
              >
                <t.Icon size={15} weight={active ? "fill" : "regular"} className="shrink-0" />
                <span className="whitespace-nowrap">{t.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* —— 权益预检提示（未订阅时，红只做关键信号） —— */}
      {!canUseLLM && !inTheater && tab !== "manual" && (
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
                  className="w-full resize-none rounded-[14px] border border-[var(--border2)] bg-[var(--surface-inset)] px-4 py-3.5 text-[16px] leading-relaxed text-[var(--ink)] shadow-[var(--inner-hi)] outline-none transition-[border-color,background-color,box-shadow] duration-200 placeholder:text-[var(--ink4)] focus:border-[var(--red)] focus:bg-[var(--surface)] focus:shadow-[0_0_0_3px_var(--red-soft)] focus-visible:outline-none"
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
                      className="studio-press rounded-full border border-[var(--border)] bg-[var(--surface2)] px-3 py-1.5 text-[13px] font-medium text-[var(--ink3)] transition-all duration-150 hover:border-[var(--border2)] hover:text-[var(--ink)]"
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
                        className={`studio-press rounded-full border px-3 py-1.5 text-[13px] font-medium transition-all duration-150 ${
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

              {/* L2 专业模式开关：展开高级设置（模板/模型/质量 + 受众口吻篇幅 + 参考资料），
                  并走「先确认大纲再逐节生成」的可控造课流程。默认关 → 一句话直接生成，极简。 */}
              <button
                type="button"
                role="switch"
                aria-checked={proMode}
                onClick={() => setProMode((v) => !v)}
                className={`studio-press flex min-h-[44px] items-center gap-3 rounded-[14px] border px-4 py-3 text-left transition-colors duration-150 ${
                  proMode
                    ? "border-[var(--red-soft-border)] bg-[var(--red-soft)]"
                    : "border-[var(--border)] bg-[var(--surface2)] hover:border-[var(--border2)]"
                }`}
              >
                <span
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] ${
                    proMode ? "bg-[var(--red)] text-white" : "bg-[var(--surface)] text-[var(--ink3)]"
                  }`}
                >
                  <SlidersHorizontal size={16} weight="fill" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold text-[var(--ink)]">专业模式 · 自己掌控</span>
                  <span className="block text-[12px] leading-snug text-[var(--ink3)]">定制受众、篇幅、创作方向与参考资料，先确认大纲再逐节生成</span>
                </span>
                <span
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${
                    proMode ? "bg-[var(--red)]" : "bg-[var(--border2)]"
                  }`}
                  aria-hidden="true"
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-[var(--card)] transition-transform duration-200 ${
                      proMode ? "translate-x-[22px]" : "translate-x-0.5"
                    }`}
                  />
                </span>
              </button>

              {/* L1 课程蓝图（专业模式展开）：受众/口吻/篇幅/块偏好/参考资料。 */}
              {proMode && (
                <div className="flex flex-col gap-3 rounded-[14px] border border-[var(--red-soft-border)] bg-[var(--red-soft)]/40 p-3.5">
                  <BlueprintChips label="受众水平" value={bpAudience} onChange={setBpAudience} options={[["beginner", "零基础"], ["some", "有基础"], ["advanced", "进阶"]]} />
                  <BlueprintChips label="讲解口吻" value={bpTone} onChange={setBpTone} options={[["textbook", "严谨教科书"], ["coach", "轻松教练"], ["interview", "面试冲刺"]]} />
                  <BlueprintChips label="课程篇幅" value={bpLength} onChange={setBpLength} options={[["brief", "精简"], ["standard", "标准"], ["deep", "深研"]]} />
                  <BlueprintMultiChips label="内容偏好" values={bpBlockPrefs} onToggle={(k) => setBpBlockPrefs((prev) => prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k])} options={[["quiz", "多做题"], ["diagram", "多图示"], ["code", "多代码"], ["flashcard", "多背诵卡"]]} />
                  <div>
                    <div className="mono mb-1.5 text-[11px] uppercase tracking-[0.14em] text-[var(--ink4)]">参考资料 · 让内容有出处</div>
                    <textarea
                      value={bpReference}
                      onChange={(e) => setBpReference(e.target.value.slice(0, 8000))}
                      rows={3}
                      placeholder="粘贴你的资料/大纲/要点，AI 会据此生成，减少凭空编造（可留空）"
                      className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] outline-none focus:border-[var(--ink3)]"
                    />
                  </div>

                  {/* 创作设置：默认自由导演；模板仅在用户明确选择时作为灵感偏好。 */}
                  <div className="border-t border-[var(--red-soft-border)] pt-3">
                    <TemplateModelPicker template={template} setTemplate={setTemplate} model={model} setModel={setModel} qualityTier={qualityTier} setQualityTier={setQualityTier} onAvailability={setAiAvailable} />
                  </div>
                </div>
              )}

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
                  <span className="block text-[14px] font-semibold text-[var(--ink)]">同时生成视频课件</span>
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

              {/* P1-1：AI 未配置（无可用模型）时显式维护提示，避免用户填完表单点生成才收到 503。 */}
              {!aiAvailable && (
                <p className="rounded-[12px] border border-[var(--warn-soft-border,var(--border))] bg-[var(--warn-soft)] px-4 py-3 text-[13px] text-[var(--ink2)]">
                  AI 生成服务暂未配置或维护中，暂时无法造课，请稍后再试。
                </p>
              )}
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!aiAvailable}
                className="cta-glow studio-press group inline-flex w-full items-center justify-center gap-2 rounded-[14px] bg-[var(--red)] px-5 py-3.5 text-[15px] font-semibold text-white transition-colors duration-200 hover:bg-[var(--red-hover)] disabled:cursor-not-allowed disabled:bg-[var(--surface-inset)] disabled:text-[var(--ink4)] disabled:hover:bg-[var(--surface-inset)]"
              >
                <Sparkle size={17} weight="fill" />
                {aiAvailable ? "生成课程" : "AI 维护中"}
                <ArrowRight size={16} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" />
              </button>
            </div>
          ) : tab === "manual" ? (
            <ManualCourseBuilder canUseLLM={canUseLLM} initialCourse={initialManualCourse} />
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
                      <span className="text-[13px] font-semibold text-[var(--ink)]">{b.label}</span>
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
                className="w-full rounded-[14px] border border-[var(--border2)] bg-[var(--surface-inset)] px-4 py-3 text-[15px] text-[var(--ink)] shadow-[var(--inner-hi)] outline-none transition-[border-color,background-color,box-shadow] duration-200 placeholder:text-[var(--ink4)] focus:border-[var(--red)] focus:bg-[var(--surface)] focus:shadow-[0_0_0_3px_var(--red-soft)] focus-visible:outline-none"
              />

              {/* v3.2：课件模板 + 模型（放上传区之上——拖入文件即刻开始生成，须先选好）*/}
              <TemplateModelPicker template={template} setTemplate={setTemplate} model={model} setModel={setModel} qualityTier={qualityTier} setQualityTier={setQualityTier} onAvailability={setAiAvailable} />

              <label className="flex cursor-pointer items-start gap-2.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface2)] px-3 py-2.5">
                <input type="checkbox" checked={importCheckpoint} onChange={(event) => setImportCheckpoint(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--red)]" />
                <span>
                  <span className="block text-[12px] font-semibold text-[var(--ink)]">文本资料先确认大纲</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-[var(--ink3)]">PDF、DOCX、TXT、Markdown 会先进入人工编排检查点；PPTX、Keynote、SCORM 始终忠实导入，不经 AI 改写。</span>
                </span>
              </label>

              {/* 文件上传区：文本文档可结构化；演示文稿/SCORM 走忠实导入。 */}
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT_EXT}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  // 复位 value，保证同一文件二次选择也能触发 onChange。
                  e.target.value = "";
                  if (f) void handleFileImport(f);
                }}
              />
              <div
                role="button"
                tabIndex={0}
                aria-label="上传文件导入（PDF、Word、文本、PPTX、Keynote 或 SCORM）"
                onClick={() => !busy && fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && !busy) {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!busy) setDragActive(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) void handleFileImport(f);
                }}
                className={`studio-press flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[14px] border-2 border-dashed px-4 py-7 text-center transition-colors duration-200 ${
                  dragActive
                    ? "border-[var(--red)] bg-[var(--red-soft)]"
                    : "border-[var(--border2)] bg-[var(--surface-inset)] hover:border-[var(--red)] hover:bg-[var(--surface)]"
                } ${busy ? "pointer-events-none opacity-50" : ""}`}
              >
                <FileArrowUp size={26} weight="duotone" className="text-[var(--red)]" />
                <span className="text-[14px] font-semibold text-[var(--ink)]">
                  {dragActive ? "松开鼠标即可导入" : "点击上传或把文件拖到这里"}
                </span>
                <span className="flex flex-wrap items-center justify-center gap-2 text-[12px] text-[var(--ink3)]">
                  <span className="inline-flex items-center gap-1">
                    <FilePdf size={13} weight="fill" className="text-[var(--red)]" /> PDF
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <FileDoc size={13} weight="fill" className="text-[var(--info)]" /> Word
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <FileText size={13} weight="fill" className="text-[var(--ink3)]" /> TXT / Markdown
                  </span>
                  <span className="inline-flex items-center gap-1"><Cards size={13} weight="fill" className="text-[var(--info)]" /> PPTX / Keynote</span>
                  <span className="inline-flex items-center gap-1"><Waves size={13} weight="fill" className="text-[var(--ok)]" /> SCORM</span>
                  <span className="text-[var(--ink4)]">· 文档 15MB / 富媒体 100MB</span>
                </span>
              </div>

              {/* 分隔：文件 或 粘贴文本 */}
              <div className="flex items-center gap-3 text-[11px] font-medium text-[var(--ink4)]">
                <span className="h-px flex-1 bg-[var(--border)]" />
                或直接粘贴文本
                <span className="h-px flex-1 bg-[var(--border)]" />
              </div>

              <div className="relative">
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  rows={7}
                  maxLength={50000}
                  placeholder="把学习资料 / 文章 / 讲义正文粘贴进来，AI 帮你整理成可学的课"
                  className="w-full resize-none rounded-[14px] border border-[var(--border2)] bg-[var(--surface-inset)] px-4 py-3.5 text-[15px] leading-relaxed text-[var(--ink)] shadow-[var(--inner-hi)] outline-none transition-[border-color,background-color,box-shadow] duration-200 placeholder:text-[var(--ink4)] focus:border-[var(--red)] focus:bg-[var(--surface)] focus:shadow-[0_0_0_3px_var(--red-soft)] focus-visible:outline-none"
                />
                <span className="mono pointer-events-none absolute bottom-3 right-3.5 text-[10px] text-[var(--ink4)]">
                  {importText.length}/50000
                </span>
              </div>
              {!aiAvailable && (
                <p className="rounded-[12px] border border-[var(--warn-soft-border,var(--border))] bg-[var(--warn-soft)] px-4 py-3 text-[13px] text-[var(--ink2)]">
                  AI 生成服务暂未配置或维护中，暂时无法改课，请稍后再试。
                </p>
              )}
              <button
                type="button"
                onClick={handleImport}
                disabled={!aiAvailable}
                className="cta-glow studio-press group inline-flex w-full items-center justify-center gap-2 rounded-[14px] bg-[var(--red)] px-5 py-3.5 text-[15px] font-semibold text-white transition-colors duration-200 hover:bg-[var(--red-hover)] disabled:cursor-not-allowed disabled:bg-[var(--surface-inset)] disabled:text-[var(--ink4)] disabled:hover:bg-[var(--surface-inset)]"
              >
                <FilePlus size={17} weight="fill" />
                {aiAvailable ? "把粘贴的资料升维成课" : "AI 维护中"}
                <ArrowRight size={16} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" />
              </button>
              <p className="text-center text-[12px] text-[var(--ink3)]">AI 会把长文拆成章节，配上要点与测验，帮你把资料变成能学的课。</p>
            </div>
          )}
        </div>
      ) : phase === "checkpoint" && checkpoint ? (
        <OutlineCheckpoint
          courseId={checkpoint.courseId}
          courseTitle={checkpoint.title}
          initialLessons={checkpoint.lessons.map((l) => ({ id: l.id, title: l.title }))}
          onConfirmed={proceedFromCheckpoint}
          onCancel={resetTheater}
          allowRegenerate={!checkpoint.isImport}
        />
      ) : phase === "done" && summary ? (
        <DonePanel
          source={source}
          summary={summary}
          lessons={lessons}
          canUseLLM={canUseLLM}
          onStart={() => router.push(`/courses/${summary.slug}/learn/${summary.firstLessonId}`)}
          onViewShelf={() => router.push("/desk?shelf=1")}
          onRetry={retryLesson}
          onReset={resetTheater}
        />
      ) : (
        <TheaterPanel
          source={source}
          phase={phase}
          lessons={lessons}
          writingIndex={writingIndex}
          // 逐节写作阶段允许「转入后台」：课已落库为 generating 态、after() 后台照常写完，
          // 退出只是不再围观。仅在有 liveGen（大纲已落库）且正逐节写作时给退出入口。
          canExit={phase === "lessons" && !!liveGen}
          onExit={exitTheater}
        />
      )}
    </div>
  );
}

/* ============================================================
   TypewriterText 已抽到 @/components/GenStage 共享（即时剧场 /
   恢复剧场 / 生产位共用），此处不再保留本地副本。
   ============================================================ */

/* ============================================================
   剧场进行面板：AI 生产线舞台（GenStage）+ 转入后台入口
   深色蓝图舞台上四站轨道 + 生产位节卡 + 分节进度格，
   即时剧场（前端状态机驱动）用本包裹；恢复剧场共用 GenStage。
   ============================================================ */
/** 蓝图单选 chip 组（再点已选项取消）。 */
function BlueprintChips({
  label, value, onChange, options,
}: {
  label: string; value: string; onChange: (v: string) => void; options: [string, string][];
}) {
  return (
    <div>
      <div className="mono mb-1.5 text-[11px] uppercase tracking-[0.14em] text-[var(--ink4)]">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([k, txt]) => (
          <button
            key={k}
            type="button"
            onClick={() => onChange(value === k ? "" : k)}
            className={`studio-press rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
              value === k
                ? "border-[var(--red)] bg-[var(--red-soft)] text-[var(--red-ink)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink2)] hover:border-[var(--border2)]"
            }`}
          >
            {txt}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 蓝图多选 chip 组。 */
function BlueprintMultiChips({
  label, values, onToggle, options,
}: {
  label: string; values: string[]; onToggle: (k: string) => void; options: [string, string][];
}) {
  return (
    <div>
      <div className="mono mb-1.5 text-[11px] uppercase tracking-[0.14em] text-[var(--ink4)]">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([k, txt]) => (
          <button
            key={k}
            type="button"
            onClick={() => onToggle(k)}
            className={`studio-press rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
              values.includes(k)
                ? "border-[var(--red)] bg-[var(--red-soft)] text-[var(--red-ink)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink2)] hover:border-[var(--border2)]"
            }`}
          >
            {txt}
          </button>
        ))}
      </div>
    </div>
  );
}

function TheaterPanel({
  source,
  phase,
  lessons,
  writingIndex,
  canExit,
  onExit,
}: {
  source: "generate" | "import";
  phase: Phase;
  lessons: OutlineLesson[];
  writingIndex: number;
  /** 是否可「转入后台」退出（逐节写作阶段且课已落库）。 */
  canExit: boolean;
  onExit: () => void;
}) {
  const total = lessons.length;
  // 站点映射：understand=1 / outline=2 / lessons=3（全 settle 后仍由 done 页接管，无需 4）
  const stationIndex: 1 | 2 | 3 | 4 = phase === "understand" ? 1 : phase === "outline" ? 2 : 3;
  const writingLesson = phase === "lessons" ? lessons[writingIndex] : undefined;

  const stageLessons: GenStageLesson[] = lessons.map((l) => ({
    id: l.id,
    title: l.title,
    state: (l.state ?? "pending") as GenStageLessonState,
  }));

  return (
    <div className="studio-rise mt-5 w-full">
      <GenStage
        source={source}
        stationIndex={stationIndex}
        lessons={stageLessons}
        writingLessonId={writingLesson?.state === "writing" ? writingLesson.id : null}
        caption={
          total > 0
            ? "课已放入书架，关闭页面也会在后台继续生成，随时回来看进度。"
            : "课已放入书架，稍后逐节浮现，关页面也会在后台继续。"
        }
        headerRight={
          canExit ? (
            <button
              type="button"
              onClick={onExit}
              className="studio-press inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-[10px] border px-3 py-2 text-[12px] font-semibold transition-colors"
              style={{
                borderColor: "var(--hairline-on-dark)",
                background: "rgba(255,255,255,.06)",
                color: "var(--ink-on-dark-2)",
              }}
            >
              <ArrowUUpLeft size={13} weight="bold" />
              转入后台
            </button>
          ) : undefined
        }
      />
    </div>
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
      <span className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-[14px] border border-[var(--border)] bg-[var(--surface-inset)] px-4 py-3.5 text-[14px] font-semibold text-[var(--ink2)] shadow-[var(--inner-hi)]">
        <CheckCircle size={16} weight="fill" className="text-[var(--red)]" />
        已在集市
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-[14px] border border-[var(--border)] bg-[var(--surface-inset)] px-4 py-3.5 text-[14px] font-semibold text-[var(--ink3)] shadow-[var(--inner-hi)]">
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
      className="studio-press inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-[14px] border border-[var(--border)] bg-[var(--surface2)] px-4 py-3.5 text-[14px] font-semibold text-[var(--ink2)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)] disabled:opacity-50"
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
  canUseLLM,
  onStart,
  onViewShelf,
  onRetry,
  onReset,
}: {
  source: "generate" | "import";
  summary: DoneSummary;
  lessons: OutlineLesson[];
  canUseLLM: boolean;
  onStart: () => void;
  onViewShelf: () => void;
  onRetry: (lessonId: string) => void;
  onReset: () => void;
}) {
  const reduce = useReducedMotion();
  const failed = lessons.filter((l) => l.state === "failed");
  const isImport = source === "import";
  // 成稿后可控编辑：仅对「已成功写完的节」提供改写/回滚/换肤（失败节先重试再管理）。
  const doneLessons = lessons.filter((l) => l.state !== "failed" && l.state !== "writing").map((l) => ({ id: l.id, title: l.title }));

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
          <div className="text-[13px] text-white/65">
            {isImport ? "你的资料已经变成一门可学的课" : "大纲、讲解、测验、伴侣，全部准备好了"}
          </div>
        </div>
      </div>

      {/* 「课有家了」确定感条：明确告知这门课已归入书架，去向不再模糊 */}
      {/* 结算归档（moment 3）：飞书落定后，一枚印章盖下「入册」——与复习结算同一归档语言。 */}
      <div className="relative flex items-center gap-2 border-b border-[var(--red-soft-border)] bg-[var(--red-soft)] px-5 py-2.5 sm:px-6">
        <Books size={15} weight="fill" className="shrink-0 text-[var(--red)]" />
        <span className="text-[13px] font-semibold text-[var(--red-ink)]">已放入你的书架</span>
        <span className="text-[11px] font-semibold text-[var(--red)]/70">· {isImport ? "资料升维" : "AI 造课"}</span>
        <ArchiveStamp active={!reduce} label="已入册" className="ml-auto" />
      </div>

      <div className="p-5 sm:p-6">
      {/* 升维报告：字数 → 结构化 转化句 */}
      {isImport && summary.chars ? (
        <p className="rounded-[12px] border border-[var(--border)] bg-[var(--surface-inset)] px-4 py-3 text-[14px] leading-relaxed text-[var(--ink2)] shadow-[var(--inner-hi)]">
          你的 <span className="mono font-bold text-[var(--ink)]">{summary.chars.toLocaleString()}</span> 字资料
          <ArrowRight size={13} weight="bold" className="mx-1.5 inline align-middle text-[var(--red)]" />
          <span className="mono font-bold text-[var(--ink)]">{summary.total}</span> 章 ·
          <span className="mono font-bold text-[var(--ink)]"> {summary.quizzes}</span> 测验 ·
          <span className="mono font-bold text-[var(--ink)]"> {summary.cards}</span> 要点卡 · 伴侣已读完全文
        </p>
      ) : (
        <p className="text-[14px] font-semibold text-[var(--ink2)]">这门课包含：</p>
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
          <p className="text-[13px] font-semibold text-[var(--ink2)]">
            有 <span className="mono font-bold text-[var(--ink)]">{failed.length}</span> 节暂未写完，可单独重试：
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {failed.map((l) => (
              <li key={l.id} className="flex items-center gap-2">
                <XCircle size={15} weight="fill" className="shrink-0 text-[var(--warn)]" />
                <span className="flex-1 truncate text-[13px] text-[var(--ink2)]">{l.title}</span>
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

      {/* 可控编辑（L4/L5）：成稿后换肤 / 逐节改写 / 版本回滚 / 会员精修——至少有一节写成才展示。 */}
      {doneLessons.length > 0 && (
        <CoursewareManager courseId={summary.courseId} lessons={doneLessons} isSubscriber={canUseLLM} />
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
            className="studio-press inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-[14px] border border-[var(--border)] bg-[var(--surface2)] px-4 py-3.5 text-[14px] font-semibold text-[var(--ink2)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)]"
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
  const paused = progress?.genStatus === "paused"; // L3：暂停态不显示转圈/「会继续生成」
  const inProgress = !ready && !failed && !paused;

  return (
    <div className="studio-rise flex items-center gap-3.5 rounded-[14px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-4 py-3 shadow-[var(--card)]">
      <ProgressRing done={done} total={total} size={42} stroke={4} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="mono text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--red-ink)]">
            {ready ? "已就绪" : failed ? "部分待续" : paused ? "已暂停" : "生产中"}
          </span>
          {inProgress && <Spinner size={11} />}
        </div>
        <p className="mt-0.5 truncate text-[14px] font-bold text-[var(--ink)]">{course.title}</p>
        <p className="mono mt-0.5 text-[11px] text-[var(--ink3)]">
          {course.isImport ? "升维" : "生成"}进度 <span className="font-semibold text-[var(--ink2)]">{done}</span>/{total} 节
          {inProgress ? " · 关闭页面也会继续生成" : paused ? " · 已暂停，可回剧场继续" : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onEnter}
          className="studio-press inline-flex items-center gap-1.5 rounded-[12px] bg-[var(--red)] px-3.5 py-2 text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-[var(--red-hover)]"
        >
          <ArrowUUpLeft size={14} weight="bold" />
          回到剧场
        </button>
        <button
          type="button"
          onClick={onDismiss}
          title="收起提示" aria-label="收起提示"
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
  const { toast } = useToast();
  const { progress, loading, error } = useGenPolling(course.id, {
    onReady: () => onDone(course.id),
  });
  // L3 暂停：调 pause-gen 置 paused（后台停扇出、已完成节保留），随后退出剧场；
  // 续造在「我的课」的「继续生产」按钮（避免轮询已在 paused 终态停摆后无法在原地重启的复杂度）。
  const [pausing, setPausing] = useState(false);
  async function pauseGen() {
    if (pausing) return;
    setPausing(true);
    track("gen_pause_click", { course_id: course.id, source: "recovery_theater" });
    try {
      const r = await fetch(`/api/courses/${course.id}/pause-gen`, { method: "POST", credentials: "same-origin" });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok) {
        toast("已暂停生产，已完成的节保留，可在「我的课」继续生产", { tone: "success" });
        onExit();
      } else {
        toast(j?.error || "暂停失败，请稍后再试", { tone: "warn" });
      }
    } catch {
      toast("网络异常，请稍后再试", { tone: "warn" });
    } finally {
      setPausing(false);
    }
  }

  const total = progress?.total ?? course.total;
  const done = progress?.done ?? course.done;
  const failed = progress?.failed ?? 0;
  const genStatus = progress?.genStatus ?? "generating";
  const isReady = genStatus === "ready";
  const isFailed = genStatus === "failed";
  const isPaused = genStatus === "paused";
  // 生产中（非就绪/失败/暂停）才给「暂停」入口。
  const canPause = !isReady && !isFailed && !isPaused;
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
  // ready 终态自动落地：课程详情页。仅 /create 剧场启用（enabled: true），
  // 3 秒可视倒计时后自动跳转；用户 hover/触摸进度详情即取消，不打断围观。
  const courseHref = `/courses/${course.slug}`;
  const { secondsLeft, cancel: cancelAutoGo } = useAutoGoCountdown(isReady ? courseHref : null, {
    enabled: true,
  });

  // 生产舞台数据：ready→done；当前生成节→writing（无 current 时取第一个未 ready）；其余 pending。
  // isFailed（后台判定不再继续）时未完节标 failed 提示可续跑。
  const firstPendingIdx = lessons.findIndex((x) => !x.ready);
  const stageLessons: GenStageLesson[] = lessons.map((l, i) => {
    const isCurrent =
      !l.ready && !isFailed && (currentLessonId ? l.id === currentLessonId : i === firstPendingIdx);
    const state: GenStageLessonState = l.ready
      ? "done"
      : isCurrent
      ? "writing"
      : isFailed
      ? "failed"
      : "pending";
    return { id: l.id, title: l.title || `第 ${i + 1} 节`, state };
  });
  const writingLessonId = stageLessons.find((l) => l.state === "writing")?.id ?? null;

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col items-center">
      {/* 顶部：返回 + 课名 + 进度环 */}
      <div className="mb-4 flex w-full items-center gap-3">
        <button
          type="button"
          onClick={onExit}
          className="studio-press inline-flex shrink-0 items-center gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] font-semibold text-[var(--ink2)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)]"
        >
          <ArrowUUpLeft size={14} weight="bold" />
          返回造课
        </button>
        <div className="min-w-0 flex-1 text-center">
          <div className="mono text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--red)]">
            {isReady ? "AI STUDIO · 已就绪" : isPaused ? "AI STUDIO · 已暂停" : "AI STUDIO · 生产中"}
          </div>
        </div>
        {canPause ? (
          <button
            type="button"
            onClick={pauseGen}
            disabled={pausing}
            className="studio-press inline-flex shrink-0 items-center gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] font-semibold text-[var(--ink2)] shadow-[var(--card)] transition-colors hover:border-[var(--warn)] hover:text-[var(--ink)] disabled:opacity-60"
          >
            {pausing ? <Spinner size={13} /> : <Pause size={14} weight="fill" />}
            暂停
          </button>
        ) : (
          <div className="w-[92px] shrink-0" aria-hidden="true" />
        )}
      </div>

      <div
        className="studio-rise w-full rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card),var(--inner-hi)] sm:p-5"
        /* 倒计时进行中，用户在进度详情上有任何 hover/触摸 → 取消自动跳转，不打断围观 */
        onPointerMove={() => { if (secondsLeft !== null && secondsLeft > 0) cancelAutoGo(); }}
        onTouchStart={() => { if (secondsLeft !== null && secondsLeft > 0) cancelAutoGo(); }}
      >
        {/* 头部：进度环 + 标题 + 状态句 */}
        <div className="flex items-center gap-4 px-1 pb-4 pt-1">
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
          <div className="flex items-center gap-2.5 border-t border-[var(--border)] px-1 pt-4">
            <Spinner size={16} />
            <span className="text-[13px] font-medium text-[var(--ink2)]">正在同步生成进度…</span>
          </div>
        ) : error && !progress ? (
          <div className="border-t border-[var(--border)] px-1 pt-4">
            <p className="text-[13px] text-[var(--ink2)]">进度暂时拉取失败，页面可见时会自动重试。</p>
          </div>
        ) : (
          <>
            {/* AI 生产线舞台：与即时剧场共用 GenStage（轮询数据驱动）。
                恢复态大纲必已存在 → 站点=3 逐节写作；全部就绪 → 站点=4 装订成册。 */}
            <GenStage
              source={course.isImport ? "import" : "generate"}
              stationIndex={isReady ? 4 : 3}
              lessons={stageLessons}
              writingLessonId={writingLessonId}
              caption={
                isReady
                  ? undefined
                  : failed > 0 && !isFailed
                  ? `有 ${failed} 节暂未写完，完成后可在「我的课」继续生成。`
                  : "关闭页面后台照常生产，随时回来看进度。"
              }
            />

            {/* 就绪：去看课 CTA（主）+ 开始学习（次）+ 3 秒自动跳转倒计时（hover/触摸取消） */}
            {isReady && (
              <div className="mt-4 flex flex-col gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    cancelAutoGo();
                    router.push(courseHref);
                  }}
                  className="cta-glow studio-press group inline-flex w-full min-h-[44px] items-center justify-center gap-2 rounded-[14px] bg-[var(--red)] px-5 py-3.5 text-[15px] font-semibold text-white transition-colors duration-200 hover:bg-[var(--red-hover)]"
                >
                  <BookOpen size={17} weight="fill" />
                  去看课
                  <ArrowRight size={16} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    cancelAutoGo();
                    router.push(startHref);
                  }}
                  className="studio-press inline-flex w-full min-h-[44px] items-center justify-center gap-1.5 rounded-[14px] border border-[var(--border)] bg-[var(--surface2)] px-4 py-3 text-[14px] font-semibold text-[var(--ink2)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)]"
                >
                  <Play size={15} weight="fill" />
                  直接开始第一节
                </button>
                {secondsLeft !== null && secondsLeft > 0 && (
                  <p className="text-center text-[12px] text-[var(--ink3)]" aria-live="polite">
                    <span className="mono font-bold text-[var(--ink2)]">{secondsLeft}</span> 秒后自动打开课程页，移动鼠标或触摸可取消
                  </p>
                )}
              </div>
            )}

            {/* 失败终态：引导去「我的课程」重试续跑 */}
            {isFailed && (
              <Link
                href="/me/courses"
                className="studio-press group mt-4 inline-flex w-full min-h-[44px] items-center justify-center gap-1.5 rounded-[14px] border border-[var(--border)] bg-[var(--surface2)] px-4 py-3.5 text-[14px] font-semibold text-[var(--ink2)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)]"
              >
                前往我的课程重试
                <ArrowRight size={15} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            )}
          </>
        )}
      </div>
    </div>
  );
}
