"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useReducedMotion } from "framer-motion";
import {
  Copy,
  Check,
  Info,
  Warning,
  CheckCircle,
  XCircle,
  Cards,
  Target,
  ChatsCircle,
  ListNumbers,
  Scales,
  Quotes,
  ArrowsClockwise,
  FlagCheckered,
  ArrowRight,
  Sparkle,
  Image as ImageIcon,
} from "@phosphor-icons/react";
import type { Block } from "@/lib/blocks";
import { renderMarkdown } from "@/lib/markdown";
import { useToast } from "./Toast";

/* ============================================================
   共享：视口触发 in-view 钩子。
   返回 [ref, inView]：元素进视口一次即 inView=true 并断连（长课件不累积监听、不一次性挂载几百个动画）。
   reduce-motion 或 SSR 无 IO 时：直接 inView=true（静态显示，动画由 CSS @media reduce 层降级）。
   ============================================================ */
function useInView<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
  const reduce = useReducedMotion();
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (reduce || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduce]);
  return [ref, inView];
}

/**
 * BlockRenderer —— AI 块课件渲染器（客户端，v3「造课革命 / 沉浸刊物」）。
 *
 * 接收已校验的块数组（validateBlocks 产物，含稳定 id），按 type 分派到 13 种精致子组件（含 image 课件图解）。
 * 每块外层带 data-block-id（笔记锚点）+ 滚动叙事进场（Reveal：IntersectionObserver 懒挂载，
 * opacity+translateY 交错浮现，reduce-motion 直接显示不动画）。
 *
 * 设计基线：
 *   - 全部块统一 --radius-card 圆角 / --border 描边 / --card 阴影 / --inner-hi 内高光，块间距成节奏。
 *   - 正文限宽 68ch（.prose-body），8pt 间距网格。
 *   - 真实 STUDIO token，零 em-dash（可见文本），语义色只用 --ok/--warn/--info/--red。
 *   - 交互块（flashcard 翻面、quiz 判分、keypoint/flashcard 存卡）均为本组件内 state，SSR 安全。
 *   - 本组件整体已是 "use client"，无需再拆分交互块。
 */
export function BlockRenderer({
  blocks,
  courseId,
  sceneBg,
  onReachEnd,
}: {
  blocks: (Block & { id: string })[];
  courseId?: string;
  /** SceneBlock 赛道场景背景图路径（public 绝对路径）。由 Player 按 course.category 解析后传入；无则 scene 保持纯渐变兜底。 */
  sceneBg?: string;
  /** 滚动模式完课信号：最后一个块进入视口时触发一次（IntersectionObserver 观察末块）。
   *  翻页模式靠 BlockSlideshow 的 onComplete 上报，滚动模式无页序，用「读到末块」等价完课语义。
   *  父组件用 useCallback 稳定；本组件仅在末块首次进视口时调用一次（一次性，进后即断连）。 */
  onReachEnd?: () => void;
}) {
  if (!blocks || blocks.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--ink2)]">
        本课暂无内容块
      </div>
    );
  }
  const lastIndex = blocks.length - 1;
  return (
    <div className="flex flex-col gap-6 sm:gap-7">
      {blocks.map((block, i) => (
        <Reveal key={block.id} index={i} onReachEnd={i === lastIndex ? onReachEnd : undefined}>
          <div data-block-id={block.id} className="scroll-mt-24">
            <BlockSwitch block={block} courseId={courseId} sceneBg={sceneBg} />
          </div>
        </Reveal>
      ))}
    </div>
  );
}

/* ============================================================
   滚动叙事：Reveal —— 进入视口才挂载动效 + 交错浮现。
   - IntersectionObserver 触发一次即断连（once），长课件也不累积监听。
   - reduce-motion：直接 shown=true，无 transform/transition。
   - 交错：同屏多块按 index 递延（上限 5 档，避免长列表尾块延迟过久）。
   ============================================================ */
function Reveal({
  children,
  index,
  onReachEnd,
}: {
  children: React.ReactNode;
  index: number;
  /** 仅末块传入：本块首次进视口时触发一次完课信号（复用同一 IntersectionObserver）。 */
  onReachEnd?: () => void;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  // 末块完课回调用 ref 持有最新值，避免把 onReachEnd 塞进 IO effect 依赖导致观察器重挂。
  const onReachEndRef = useRef(onReachEnd);
  onReachEndRef.current = onReachEnd;

  useEffect(() => {
    if (reduce) {
      setShown(true);
      // reduce-motion / 无 IO 环境下直接显示，此时末块也视为「已读到」，同步触发完课信号。
      onReachEndRef.current?.();
      return;
    }
    const el = ref.current;
    if (!el) return;
    // 已在视口内（首屏块）：下一帧点亮，走一次进场；不靠滚动。
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            // 末块进视口即触发完课信号（onReachEnd 仅末块非空）。IO 进后即断连，天然一次性。
            onReachEndRef.current?.();
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.06 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduce]);

  // 交错步进：60ms/块，封顶 300ms
  const delay = reduce ? 0 : Math.min(index, 5) * 60;

  return (
    <div
      ref={ref}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "none" : "translateY(16px)",
        transition: reduce
          ? undefined
          : `opacity .55s var(--ease-out-expo) ${delay}ms, transform .55s var(--ease-out-expo) ${delay}ms`,
        willChange: shown ? undefined : "opacity, transform",
      }}
    >
      {children}
    </div>
  );
}

/**
 * 按 type 分派单块到其精致子组件。未知类型返回前向兼容占位（新块类型旧客户端遇到时跳过，不中断整页）。
 * 导出供翻页课件（BlockSlideshow）复用同一套单块渲染，滚动模式与翻页模式共享像素级一致的块外观。
 */
export function BlockSwitch({
  block,
  courseId,
  sceneBg,
}: {
  block: Block & { id: string };
  courseId?: string;
  /** SceneBlock 赛道场景背景图路径；仅 scene 块用到，其余块忽略。 */
  sceneBg?: string;
}) {
  switch (block.type) {
    // —— 基础 5 种（升级材质/间距）——
    case "concept":
      return <ConceptBlock title={block.title} markdown={block.markdown} />;
    case "code":
      return <CodeBlock lang={block.lang} code={block.code} explanation={block.explanation} />;
    case "quiz":
      return (
        <QuizBlock
          question={block.question}
          options={block.options}
          answerIndex={block.answerIndex}
          explain={block.explain}
        />
      );
    case "keypoint":
      return <KeypointBlock points={block.points} courseId={courseId} />;
    case "callout":
      return <CalloutBlock tone={block.tone} markdown={block.markdown} />;
    // —— v3 新增 7 种 ——
    case "objectives":
      return <ObjectivesBlock items={block.items} />;
    case "scene":
      return <SceneBlock title={block.title} markdown={block.markdown} sceneBg={sceneBg} />;
    case "dialog":
      return <DialogBlock turns={block.turns} />;
    case "steps":
      return <StepsBlock steps={block.steps} />;
    case "compare":
      return <CompareBlock title={block.title} left={block.left} right={block.right} />;
    case "example":
      return <ExampleBlock markdown={block.markdown} />;
    case "flashcard":
      return <FlashcardBlock front={block.front} back={block.back} courseId={courseId} />;
    case "summary":
      return <SummaryBlock markdown={block.markdown} next={block.next} />;
    case "image":
      return <ImageBlock src={block.src} caption={block.caption} alt={block.alt} />;
    default:
      // 前向兼容：未知块只提示不崩
      return <p className="text-xs text-[var(--ink3)]">（暂不支持的内容块，已跳过）</p>;
  }
}

/* ============================================================
   共享外壳：统一圆角 / 描边 / 阴影 / 内高光的卡片。
   ============================================================ */
const CARD =
  "rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card),var(--inner-hi)]";

/* ============================================================
   基础块（升级版）
   ============================================================ */

/** 概念讲解：小节标记 + 标题 + markdown 正文（限宽 68ch）。 */
function ConceptBlock({ title, markdown }: { title: string; markdown: string }) {
  return (
    <section className={`${CARD} p-5 sm:p-6`}>
      {title && (
        <div className="mb-3 flex items-center gap-2.5">
          <span className="h-4 w-1 shrink-0 rounded-full bg-[var(--red)]" aria-hidden />
          <h3 className="text-[18px] font-bold leading-snug tracking-tight text-[var(--ink)]">{title}</h3>
        </div>
      )}
      {markdown && (
        <div
          className="tide-md prose-body text-[15px] text-[var(--ink)]"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
        />
      )}
    </section>
  );
}

/** 代码块：语言胶囊 + 深色代码面 + 复制 + 可选讲解。仅样式与复制，不执行。 */
function CodeBlock({ lang, code, explanation }: { lang: string; code: string; explanation?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // 剪贴板不可用（非 https / 权限拒绝）静默降级
    }
  }

  return (
    <section className={`${CARD} overflow-hidden`}>
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
        <span className="mono rounded-md bg-[var(--surface-inset)] px-2 py-0.5 text-[11px] font-medium text-[var(--ink2)]">
          {lang}
        </span>
        <button
          onClick={copy}
          className="studio-press inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-[var(--ink3)] transition-colors hover:bg-[var(--surface-inset)] hover:text-[var(--ink)]"
          aria-label="复制代码"
        >
          {copied ? <Check size={14} weight="bold" /> : <Copy size={14} />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="overflow-x-auto bg-[var(--surface-inset)] p-4">
        <code className="mono text-[13px] leading-relaxed text-[var(--ink)]">{code}</code>
      </pre>
      {explanation && (
        <p className="border-t border-[var(--border)] px-4 py-3 text-[14px] leading-relaxed text-[var(--ink2)]">
          {explanation}
        </p>
      )}
    </section>
  );
}

/** 测验块：单选，点击即时判分。答对整卡微庆祝、答错被选项抖动一下（均 reduce-motion 降级）。纯前端 state。 */
function QuizBlock({
  question,
  options,
  answerIndex,
  explain,
}: {
  question: string;
  options: string[];
  answerIndex: number;
  explain: string;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const answered = picked !== null;
  const correct = picked === answerIndex;

  return (
    <section className={`${CARD} p-5 sm:p-6 ${answered && correct ? "quiz-correct" : ""}`}>
      <div className="mb-4 flex items-start gap-2.5">
        <span className="mt-0.5 inline-flex h-5 shrink-0 items-center rounded-md bg-[var(--surface-inset)] px-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink3)]">
          Quiz
        </span>
        <p className="flex-1 text-[15px] font-semibold leading-snug text-[var(--ink)]">{question}</p>
      </div>
      <div className="flex flex-col gap-2">
        {options.map((opt, i) => {
          const isAnswer = i === answerIndex;
          const isPicked = i === picked;
          // 判分后视觉：正确项恒绿；被选中的错误项标红并抖动；其余中性淡出
          let cls = "border-[var(--border)] bg-[var(--surface2)] text-[var(--ink)] hover:border-[var(--red)]";
          let anim = "";
          if (answered) {
            if (isAnswer) {
              cls = "border-[var(--ok)] bg-[var(--ok-soft)] text-[var(--ink)]";
            } else if (isPicked) {
              cls = "border-[var(--red)] bg-[var(--red-soft)] text-[var(--ink)]";
              anim = "quiz-shake"; // 选错的项横向抖动一下
            } else {
              cls = "border-[var(--border)] bg-[var(--surface2)] text-[var(--ink3)]";
            }
          }
          return (
            <button
              key={i}
              disabled={answered}
              onClick={() => setPicked(i)}
              className={`flex items-center justify-between gap-3 rounded-[var(--radius-card-sm)] border px-4 py-3 text-left text-[14px] transition-colors disabled:cursor-default ${cls} ${anim}`}
            >
              <span className="flex-1">{opt}</span>
              {answered && isAnswer && <CheckCircle size={18} weight="fill" className="shrink-0 text-[var(--ok)]" />}
              {answered && isPicked && !isAnswer && (
                <XCircle size={18} weight="fill" className="shrink-0 text-[var(--red)]" />
              )}
            </button>
          );
        })}
      </div>
      {answered && (
        <div className="quiz-verdict mt-4 flex items-start gap-2.5 rounded-[var(--radius-card-sm)] bg-[var(--surface-inset)] p-4">
          {correct ? (
            <Sparkle size={18} weight="fill" className="quiz-spark mt-0.5 shrink-0 text-[var(--ok)]" />
          ) : (
            <XCircle size={18} weight="fill" className="mt-0.5 shrink-0 text-[var(--red-ink)]" />
          )}
          <div className="flex-1">
            <p className={`text-[14px] font-semibold ${correct ? "text-[var(--ok)]" : "text-[var(--red-ink)]"}`}>
              {correct ? "回答正确" : "回答错误"}
            </p>
            {explain && <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--ink2)]">{explain}</p>}
          </div>
        </div>
      )}
    </section>
  );
}

/** 要点卡片：红调软背景 + 每条红点，含「存为复习卡」（POST /api/ai/review-card）。 */
function KeypointBlock({ points, courseId }: { points: string[]; courseId?: string }) {
  const { toast } = useToast();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const saveCards = async () => {
    if (saving || saved) return;
    setSaving(true);
    try {
      for (const p of points) {
        const res = await fetch("/api/ai/review-card", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ front: p, back: p, courseId }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || json?.ok !== true) throw new Error(json?.error || "存为复习卡失败，请重试");
      }
      setSaved(true);
    } catch (e) {
      // 失败提示且不置 saved，保持可重试
      toast((e as Error).message || "存为复习卡失败，请重试", { tone: "warn" });
    } finally {
      setSaving(false);
    }
  };

  const [viewRef, inView] = useInView<HTMLElement>();

  return (
    <section
      ref={viewRef}
      className={`rounded-[var(--radius-card)] border border-[var(--red-soft-border)] bg-[var(--red-soft)] p-5 shadow-[var(--card),var(--inner-hi)] sm:p-6 ${inView ? "is-in" : ""}`}
    >
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <h3 className="text-[14px] font-semibold text-[var(--ink)]">本节要点</h3>
        <SaveCardButton saved={saved} saving={saving} onClick={saveCards} />
      </div>
      {/* 要点墙：卡片网格（单列窄屏、双列宽屏），每格带序号徽章，逐格弹入 */}
      <ul className="grid gap-2.5 sm:grid-cols-2">
        {points.map((p, i) => (
          <li
            key={i}
            className="kp-cell flex items-start gap-3 rounded-[var(--radius-card-sm)] border border-[var(--red-soft-border)] bg-[var(--surface)] px-3.5 py-3 text-[14px] leading-relaxed text-[var(--ink)] shadow-[var(--card)]"
            style={{ "--i": i } as CSSProperties}
          >
            <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--red-soft)] text-[12px] font-bold text-[var(--red-ink)]">
              {i + 1}
            </span>
            <span className="flex-1">{p}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 提示框：info 蓝调 / warn 黄调（走 --info/--warn 语义 token），左缘强调条进场「注入」。 */
function CalloutBlock({ tone, markdown }: { tone: "info" | "warn"; markdown: string }) {
  const isWarn = tone === "warn";
  const border = isWarn ? "var(--warn)" : "var(--info)";
  const bg = isWarn ? "var(--warn-soft)" : "var(--info-soft)";
  const ink = isWarn ? "var(--warn)" : "var(--info)";
  const [viewRef, inView] = useInView<HTMLElement>();
  return (
    <section
      ref={viewRef}
      className={`relative flex gap-3 overflow-hidden rounded-[var(--radius-card)] border p-4 pl-5 shadow-[var(--card),var(--inner-hi)] sm:p-5 sm:pl-6 ${inView ? "is-in" : ""}`}
      style={{ borderColor: border, background: bg }}
    >
      {/* 左缘强调色带：进场自上而下注入 */}
      <span
        className="callout-strip pointer-events-none absolute inset-y-0 left-0 w-[3px]"
        style={{ background: ink }}
        aria-hidden
      />
      <span className="mt-0.5 shrink-0" style={{ color: ink }}>
        {isWarn ? <Warning size={18} weight="fill" /> : <Info size={18} weight="fill" />}
      </span>
      <div
        className="tide-md prose-body flex-1 text-[14px] text-[var(--ink)]"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
      />
    </section>
  );
}

/* ============================================================
   v3 新增块
   ============================================================ */

/** objectives —— 节首页头卡「本节你将学会」，items 进视口后逐条亮起（✓ 绿点）。 */
function ObjectivesBlock({ items }: { items: string[] }) {
  const [viewRef, inView] = useInView<HTMLElement>();
  return (
    <section ref={viewRef} className={`${CARD} overflow-hidden p-5 sm:p-6 ${inView ? "is-in" : ""}`}>
      <div className="mb-4 flex items-center gap-2.5">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-[var(--red-soft)] text-[var(--red-ink)]">
          <Target size={18} weight="bold" />
        </span>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink3)]">学习目标</p>
          <h3 className="text-[17px] font-bold leading-snug tracking-tight text-[var(--ink)]">本节你将学会</h3>
        </div>
      </div>
      {/* data-reveal：进视口后子项按 --i 逐条上浮 */}
      <ul data-reveal className={`flex flex-col gap-2.5 ${inView ? "is-in" : ""}`}>
        {items.map((it, i) => (
          <li
            key={i}
            className="flex items-start gap-3 text-[15px] leading-relaxed text-[var(--ink)]"
            style={{ "--i": i } as CSSProperties}
          >
            <CheckCircle size={18} weight="fill" className="mt-0.5 shrink-0 text-[var(--ok)]" />
            <span className="flex-1">{it}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** scene —— 深色渐变「为什么学」故事开场：进视口时两片幕帘向两侧拉开，露出大字引言 + 场景铺陈。
 *  接图：sceneBg（按赛道解析的场景背景图）作氛围底叠在 --video-grad 之上，
 *  再叠一层 --video-grad 暗化遮罩确保浅色文字可读、与深色场景融合。图为静态背景，
 *  reduce-motion 下同样渲染（幕帘/进场动效降级不影响背景层显示）。 */
function SceneBlock({ title, markdown, sceneBg }: { title: string; markdown: string; sceneBg?: string }) {
  const [viewRef, inView] = useInView<HTMLElement>();
  return (
    <section
      ref={viewRef}
      className={`relative overflow-hidden rounded-[var(--radius-card)] p-6 shadow-[var(--card)] sm:p-8 ${inView ? "is-in" : ""}`}
      style={{ background: "var(--video-grad)" }}
    >
      {/* 赛道场景背景图：氛围底，铺在渐变兜底之上、暗化遮罩之下（z-0）。
          图裂/缺失时该层不渲染，section 的 --video-grad 兜底仍在，不留破图。
          纯静态背景，reduce-motion 无影响；object-cover 保证宽幅图铺满不变形。 */}
      {sceneBg && (
        <span
          className="pointer-events-none absolute inset-0 z-0 bg-cover bg-center"
          style={{ backgroundImage: `url("${sceneBg}")` }}
          aria-hidden
        />
      )}
      {/* 暗化遮罩：图上再压一层 --video-grad（半透明），把浅色场景压暗、与深色 scene 融合，
          确保白墨阶正文对比达标。无图时此层仍在，不影响纯渐变观感。 */}
      {sceneBg && (
        <span
          className="pointer-events-none absolute inset-0 z-0 opacity-[0.82]"
          style={{ background: "var(--video-grad)" }}
          aria-hidden
        />
      )}
      {/* 顶部细高光，加材质感 */}
      <span
        className="pointer-events-none absolute inset-x-0 top-0 z-[3] h-px"
        style={{ background: "var(--hairline-on-dark)" }}
        aria-hidden
      />
      {/* 微妙氛围：顶部聚光柔晕，像舞台灯打在幕上 */}
      <span
        className="pointer-events-none absolute inset-0 z-[1]"
        style={{ background: "radial-gradient(80% 90% at 50% -8%, rgba(255,255,255,.10), transparent 60%)" }}
        aria-hidden
      />
      {/* 幕帘：两片向两侧退开（reduce-motion 下 CSS 直接 display:none 不遮挡） */}
      <span className="scene-curtain scene-curtain-l" aria-hidden />
      <span className="scene-curtain scene-curtain-r" aria-hidden />
      {/* 幕后舞台内容：随幕布拉开淡入 */}
      <div className="scene-stage relative z-[2]">
        <span
          className="mb-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide"
          style={{ background: "rgba(255,255,255,.08)", color: "var(--ink-on-dark-2)" }}
        >
          场景
        </span>
        {title && (
          <h3
            className="text-[22px] font-bold leading-snug tracking-tight sm:text-[26px]"
            style={{ color: "var(--ink-on-dark)" }}
          >
            {title}
          </h3>
        )}
        {markdown && (
          <div
            className="tide-md tide-md-on-dark prose-body mt-3 text-[15px] leading-relaxed"
            style={{ color: "var(--ink-on-dark-2)" }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
          />
        )}
      </div>
    </section>
  );
}

/** dialog —— 聊天气泡左右分列（speaker 交替左右），进视口后逐条从各自侧浮现，note 作小字注释。 */
function DialogBlock({ turns }: { turns: { speaker: string; text: string; note?: string }[] }) {
  const [viewRef, inView] = useInView<HTMLElement>();
  // 说话人 → 左右侧位（首个出现的说话人靠左，第二个靠右；更多说话人循环）
  const order: string[] = [];
  for (const t of turns) {
    if (!order.includes(t.speaker)) order.push(t.speaker);
  }
  return (
    <section ref={viewRef} className={`${CARD} p-5 sm:p-6 ${inView ? "is-in" : ""}`}>
      <div className="mb-4 flex items-center gap-2.5">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-[var(--surface-inset)] text-[var(--ink2)]">
          <ChatsCircle size={18} weight="bold" />
        </span>
        <h3 className="text-[15px] font-semibold text-[var(--ink)]">对话示例</h3>
      </div>
      <div className="flex flex-col gap-3">
        {turns.map((t, i) => {
          const isRight = order.indexOf(t.speaker) % 2 === 1;
          return (
            <div
              key={i}
              className={`dlg-turn ${isRight ? "dlg-turn-r items-end" : "dlg-turn-l items-start"} flex flex-col gap-1`}
              style={{ "--i": i } as CSSProperties}
            >
              <span className="px-1 text-[11px] font-medium text-[var(--ink3)]">{t.speaker}</span>
              <div
                className={`max-w-[85%] rounded-[16px] px-4 py-2.5 text-[14px] leading-relaxed shadow-[var(--card)] ${
                  isRight
                    ? "rounded-tr-sm border border-[var(--red-soft-border)] bg-[var(--red-soft)] text-[var(--ink)]"
                    : "rounded-tl-sm border border-[var(--border)] bg-[var(--surface-inset)] text-[var(--ink)]"
                }`}
              >
                {t.text}
              </div>
              {t.note && (
                <span className={`px-1 text-[12px] italic text-[var(--ink3)] ${isRight ? "text-right" : "text-left"}`}>
                  {t.note}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** steps —— 竖向流程线：序号徽章 + 连接线（进视口后自上而下生长）+ 标题 + detail，逐级浮现。 */
function StepsBlock({ steps }: { steps: { title: string; detail?: string }[] }) {
  const [viewRef, inView] = useInView<HTMLElement>();
  return (
    <section ref={viewRef} className={`${CARD} p-5 sm:p-6 ${inView ? "is-in" : ""}`}>
      <div className="mb-4 flex items-center gap-2.5">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-[var(--surface-inset)] text-[var(--ink2)]">
          <ListNumbers size={18} weight="bold" />
        </span>
        <h3 className="text-[15px] font-semibold text-[var(--ink)]">操作步骤</h3>
      </div>
      <ol className="flex flex-col">
        {steps.map((s, i) => {
          const last = i === steps.length - 1;
          return (
            <li key={i} className="flex gap-3.5">
              {/* 序号 + 连接线列 */}
              <div className="flex flex-col items-center">
                <span
                  className="steps-badge inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--red)] text-[12px] font-bold text-white shadow-[var(--card)]"
                  style={{ "--i": i } as CSSProperties}
                >
                  {i + 1}
                </span>
                {!last && (
                  <span
                    className="steps-line w-px flex-1 bg-[var(--border2)]"
                    style={{ "--i": i } as CSSProperties}
                    aria-hidden
                  />
                )}
              </div>
              {/* 内容 */}
              <div
                className={`steps-body flex-1 ${last ? "pb-0" : "pb-5"}`}
                style={{ "--i": i } as CSSProperties}
              >
                <p className="text-[15px] font-semibold leading-snug text-[var(--ink)]">{s.title}</p>
                {s.detail && (
                  <p className="mt-1 text-[14px] leading-relaxed text-[var(--ink2)]">{s.detail}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** compare —— 双栏「对撞」：left 误区（冷灰）从左滑入 vs right 正确（--ok 微绿）从右滑入，中缝 vs 徽章。 */
function CompareBlock({
  title,
  left,
  right,
}: {
  title?: string;
  left: { heading: string; items: string[] };
  right: { heading: string; items: string[] };
}) {
  const [viewRef, inView] = useInView<HTMLElement>();
  return (
    <section ref={viewRef} className={`${CARD} p-5 sm:p-6 ${inView ? "is-in" : ""}`}>
      <div className="mb-4 flex items-center gap-2.5">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-[var(--surface-inset)] text-[var(--ink2)]">
          <Scales size={18} weight="bold" />
        </span>
        <h3 className="text-[15px] font-semibold text-[var(--ink)]">{title || "对比辨析"}</h3>
      </div>
      {/* 相对定位承载中缝 vs 徽章；两列各自从外侧滑入「对撞」到中线 */}
      <div className="relative grid gap-3 sm:grid-cols-2">
        {/* 误区列：冷灰调，不用 warn 黄，让「错」显得沉、克制 */}
        <CompareColumn variant="wrong" heading={left.heading} items={left.items} inView={inView} />
        {/* 正确列：--ok 微绿强调 */}
        <CompareColumn variant="ok" heading={right.heading} items={right.items} inView={inView} />
        {/* 中缝 vs 分隔徽章：仅宽屏双列时居中显示 */}
        <span
          className="cmp-vs pointer-events-none absolute left-1/2 top-1/2 z-[1] hidden h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-[var(--border2)] bg-[var(--surface)] text-[10px] font-bold uppercase tracking-wide text-[var(--ink3)] shadow-[var(--card)] sm:grid"
          aria-hidden
        >
          vs
        </span>
      </div>
    </section>
  );
}

function CompareColumn({
  variant,
  heading,
  items,
  inView,
}: {
  variant: "wrong" | "ok";
  heading: string;
  items: string[];
  inView: boolean;
}) {
  const isWrong = variant === "wrong";
  // 误区列走冷灰（surface-inset + ink2），正确列走 --ok 微绿。红只留给关键强调，此处不铺红。
  const border = isWrong ? "var(--border2)" : "var(--ok)";
  const bg = isWrong ? "var(--surface-inset)" : "var(--ok-soft)";
  const ink = isWrong ? "var(--ink2)" : "var(--ok)";
  const dot = isWrong ? "var(--ink3)" : "var(--ok)";
  return (
    <div
      className={`cmp-col ${inView ? (isWrong ? "cmp-col-left" : "cmp-col-right") : ""} relative z-[0] rounded-[var(--radius-card-sm)] border p-4`}
      style={{ borderColor: border, background: bg }}
    >
      <div className="mb-2.5 flex items-center gap-2">
        <span style={{ color: ink }}>
          {isWrong ? <XCircle size={17} weight="fill" /> : <CheckCircle size={17} weight="fill" />}
        </span>
        <p className="text-[14px] font-semibold" style={{ color: ink }}>
          {heading || (isWrong ? "常见误区" : "正确做法")}
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2 text-[14px] leading-relaxed text-[var(--ink)]">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dot }} />
            <span className="flex-1">{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** example —— 缩进引用卡 + 「例」角标：把案例从正文里托出来。 */
function ExampleBlock({ markdown }: { markdown: string }) {
  return (
    <section className="relative rounded-[var(--radius-card)] border border-[var(--border)] border-l-[3px] border-l-[var(--red)] bg-[var(--surface2)] p-5 shadow-[var(--card),var(--inner-hi)] sm:p-6">
      <span className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-[var(--surface)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ink3)]">
        <Quotes size={12} weight="fill" /> 例
      </span>
      <div
        className="tide-md prose-body text-[15px] text-[var(--ink)]"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
      />
    </section>
  );
}

/** flashcard —— 内联 3D 翻面卡（复用复习室 flip3d 手感）+ 角落「存为复习卡」。 */
function FlashcardBlock({ front, back, courseId }: { front: string; back: string; courseId?: string }) {
  const { toast } = useToast();
  const [flipped, setFlipped] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving || saved) return;
    setSaving(true);
    try {
      const res = await fetch("/api/ai/review-card", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ front, back, courseId }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.ok !== true) throw new Error(json?.error || "存为复习卡失败，请重试");
      setSaved(true);
    } catch (e) {
      // 失败提示且不置 saved，保持可重试
      toast((e as Error).message || "存为复习卡失败，请重试", { tone: "warn" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flip3d">
      <button
        type="button"
        onClick={() => setFlipped((v) => !v)}
        className={`flip3d-inner block w-full text-left ${flipped ? "is-flipped" : ""}`}
        aria-label="翻转卡片"
      >
        {/* 正面 · 问题 */}
        <div className={`flip3d-face ${CARD} p-6 sm:p-7`}>
          <div className="mb-3 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--surface2)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink3)]">
              <Cards size={13} /> 记忆卡
            </span>
            <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--ink4)]">
              <ArrowsClockwise size={13} /> 点击翻面
            </span>
          </div>
          <p className="min-h-[64px] text-[16px] font-semibold leading-[1.7] text-[var(--ink)]">{front}</p>
        </div>
        {/* 背面 · 答案（预旋 180°） */}
        <div className={`flip3d-back rounded-[var(--radius-card)] border border-[var(--red-soft-border)] bg-[var(--surface)] p-6 shadow-[var(--card),var(--inner-hi)] sm:p-7`}>
          <div className="mb-3 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--red-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--red-ink)]">
              答案
            </span>
            <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--ink4)]">
              <ArrowsClockwise size={13} /> 点击翻回
            </span>
          </div>
          <p className="min-h-[64px] text-[15px] leading-[1.7] text-[var(--ink)]">{back}</p>
        </div>
      </button>
      {/* 存为复习卡（在翻牌容器外，避免点击冒泡触发翻面） */}
      <div className="mt-2.5 flex justify-end">
        <SaveCardButton saved={saved} saving={saving} onClick={save} />
      </div>
    </section>
  );
}

/** summary —— 节尾收束卡 + 可选「下一节预告」钩子（--red-ink 箭头强调）。 */
function SummaryBlock({ markdown, next }: { markdown: string; next?: string }) {
  return (
    <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface2)] shadow-[var(--card),var(--inner-hi)]">
      <div className="p-5 sm:p-6">
        <div className="mb-3 flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-[var(--red-soft)] text-[var(--red-ink)]">
            <FlagCheckered size={18} weight="bold" />
          </span>
          <h3 className="text-[15px] font-semibold text-[var(--ink)]">本节小结</h3>
        </div>
        <div
          className="tide-md prose-body text-[15px] text-[var(--ink)]"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
        />
      </div>
      {next && (
        <a
          href="#next-lesson"
          className="group flex items-center gap-2.5 border-t border-[var(--border)] bg-[var(--surface)] px-5 py-3.5 text-[14px] transition-colors hover:bg-[var(--red-soft)] sm:px-6"
        >
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink3)]">
            <ArrowRight size={12} weight="bold" className="text-[var(--red-ink)]" /> 下一节
          </span>
          <span className="flex-1 truncate font-semibold text-[var(--red-ink)]">{next}</span>
          {/* 钩住下一节：箭头持续轻微往复（reduce-motion 停在原位），hover 再多推一点 */}
          <ArrowRight
            size={16}
            weight="bold"
            className="next-arrow shrink-0 text-[var(--red-ink)] transition-transform group-hover:translate-x-1"
          />
        </a>
      )}
    </section>
  );
}

/** image —— 课件图解：站内图 + 可选说明。统一卡片壳（对齐 CodeBlock 的 overflow-hidden 卡面）。
 *  懒加载 loading="lazy"；图裂时优雅降级为「图解暂不可用」占位，不留破图。
 *  src 已在 validateBlocks 过白名单（仅站内 / 开头路径），此处直接信任。 */
function ImageBlock({ src, caption, alt }: { src: string; caption?: string; alt?: string }) {
  const [broken, setBroken] = useState(false);
  // 无障碍：alt 优先 caption，二者皆无则空 alt（装饰性，避免读屏念出文件名）。
  const altText = alt || caption || "";
  return (
    <figure className={`${CARD} overflow-hidden`}>
      {broken ? (
        <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 bg-[var(--surface-inset)] p-8 text-center">
          <ImageIcon size={22} className="text-[var(--ink4)]" aria-hidden />
          <p className="text-[13px] text-[var(--ink3)]">图解暂不可用</p>
        </div>
      ) : (
        <img
          src={src}
          alt={altText}
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
          className="block h-auto w-full max-w-full bg-[var(--surface-inset)] object-cover"
        />
      )}
      {caption && (
        <figcaption className="flex items-start gap-2 border-t border-[var(--border)] px-4 py-3 text-[13px] leading-relaxed text-[var(--ink2)]">
          <ImageIcon size={14} weight="bold" className="mt-0.5 shrink-0 text-[var(--ink3)]" aria-hidden />
          <span className="flex-1">{caption}</span>
        </figcaption>
      )}
    </figure>
  );
}

/* ============================================================
   共享小组件：存为复习卡按钮（keypoint / flashcard 复用）
   ============================================================ */
function SaveCardButton({
  saved,
  saving,
  onClick,
}: {
  saved: boolean;
  saving: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={saving || saved}
      className="studio-press inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[12px] text-[var(--ink3)] transition-colors hover:text-[var(--ink)] disabled:opacity-60"
      aria-label="存为复习卡"
    >
      {saved ? (
        <>
          <Check size={14} /> 已存入
        </>
      ) : (
        <>
          <Cards size={14} /> {saving ? "存入中…" : "存为复习卡"}
        </>
      )}
    </button>
  );
}
