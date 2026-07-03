"use client";

import { useState } from "react";
import { Copy, Check, Info, Warning, CheckCircle, XCircle, Cards } from "@phosphor-icons/react";
import type { Block } from "@/lib/blocks";
import { renderMarkdown } from "@/lib/markdown";

/**
 * BlockRenderer —— AI 块课件渲染器（客户端）。
 * 接收已校验的块数组（validateBlocks 产物，含稳定 id），按 type 分派到子组件渲染。
 * 每块外层带 data-block-id，供笔记锚点 / IntersectionObserver 滚动定位。
 * 设计：STUDIO token，卡片风格，舒适 gap。未知 type 前向兼容（仅渲染小灰提示，不崩）。
 */
export function BlockRenderer({ blocks, courseId }: { blocks: (Block & { id: string })[]; courseId?: string }) {
  if (!blocks || blocks.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--ink2)]">
        本课暂无内容块
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block) => (
        <div key={block.id} data-block-id={block.id} className="scroll-mt-24">
          <BlockSwitch block={block} courseId={courseId} />
        </div>
      ))}
    </div>
  );
}

/** 按 type 分派。未知类型返回前向兼容占位。 */
function BlockSwitch({ block, courseId }: { block: Block & { id: string }; courseId?: string }) {
  switch (block.type) {
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
    default:
      // 前向兼容：新版块类型旧客户端遇到时跳过，仅提示，不中断整页渲染
      return (
        <p className="text-xs text-[var(--ink2)]">（暂不支持的内容块，已跳过）</p>
      );
  }
}

/** 概念讲解：标题 + markdown 正文。renderMarkdown 已做 XSS 转义，可安全 dangerouslySetInnerHTML。 */
function ConceptBlock({ title, markdown }: { title: string; markdown: string }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
      {title && <h3 className="mb-3 text-lg font-bold text-[var(--ink)]">{title}</h3>}
      {markdown && (
        <div
          // tide-md：使 renderMarkdown 产出的 .tide-md-* 子类样式生效（globals.css 中作用域挂在 .tide-md 下）
          className="tide-md prose-body text-[var(--ink)]"
          // renderMarkdown 内部对原始文本做过 esc()，输出已是安全 HTML
          dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
        />
      )}
    </section>
  );
}

/** 代码块：语言标签 + 高亮样式代码 + 复制按钮 + 可选讲解。MVP 只做样式与复制，不执行。 */
function CodeBlock({ lang, code, explanation }: { lang: string; code: string; explanation?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // 剪贴板不可用（如非 https / 权限拒绝）时静默降级
    }
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="mono rounded-md bg-[var(--surface-inset)] px-2 py-0.5 text-xs text-[var(--ink2)]">
          {lang}
        </span>
        <button
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--ink2)] transition-colors hover:bg-[var(--surface-inset)] hover:text-[var(--ink)]"
          aria-label="复制代码"
        >
          {copied ? <Check size={14} weight="bold" /> : <Copy size={14} />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-[12px] bg-[var(--surface-inset)] p-4">
        <code className="mono text-[13px] leading-relaxed text-[var(--ink)]">{code}</code>
      </pre>
      {explanation && <p className="mt-3 text-sm text-[var(--ink2)]">{explanation}</p>}
    </section>
  );
}

/** 测验块：单选，点击即时判分。选对绿 / 选错红并高亮正确项 + 显示解析。纯前端 state，不回服务器。 */
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
    <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
      <p className="mb-4 font-medium text-[var(--ink)]">{question}</p>
      <div className="flex flex-col gap-2">
        {options.map((opt, i) => {
          const isAnswer = i === answerIndex;
          const isPicked = i === picked;
          // 判分后的视觉：正确项恒绿；被选中的错误项标红；其余保持中性
          let cls =
            "border-[var(--border)] bg-[var(--surface2)] text-[var(--ink)] hover:border-[var(--red)]";
          if (answered) {
            if (isAnswer) {
              cls = "border-[color:#2fae63] bg-[color:#2fae63]/10 text-[var(--ink)]";
            } else if (isPicked) {
              cls = "border-[var(--red)] bg-[var(--red-soft)] text-[var(--ink)]";
            } else {
              cls = "border-[var(--border)] bg-[var(--surface2)] text-[var(--ink2)]";
            }
          }
          return (
            <button
              key={i}
              disabled={answered}
              onClick={() => setPicked(i)}
              className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors disabled:cursor-default ${cls}`}
            >
              <span className="flex-1">{opt}</span>
              {answered && isAnswer && <CheckCircle size={18} weight="fill" className="shrink-0 text-[#2fae63]" />}
              {answered && isPicked && !isAnswer && <XCircle size={18} weight="fill" className="shrink-0 text-[var(--red)]" />}
            </button>
          );
        })}
      </div>
      {answered && (
        <div className="mt-4 rounded-xl bg-[var(--surface-inset)] p-4">
          <p className={`text-sm font-medium ${correct ? "text-[#2fae63]" : "text-[var(--red)]"}`}>
            {correct ? "回答正确" : "回答错误"}
          </p>
          {explain && <p className="mt-1.5 text-sm text-[var(--ink2)]">{explain}</p>}
        </div>
      )}
    </section>
  );
}

/** 要点卡片：每条前红色圆点，卡片式（红调软背景）。含"存为复习卡"按钮（存入 ReviewCard）。 */
function KeypointBlock({ points, courseId }: { points: string[]; courseId?: string }) {
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const saveCards = async () => {
    if (saving || saved) return;
    setSaving(true);
    try {
      // 每条要点存一张复习卡：正面=要点，背面=同要点（简单卡；后续可 AI 生成问答对）
      for (const p of points) {
        await fetch("/api/ai/review-card", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ front: p, back: p, courseId }),
        });
      }
      setSaved(true);
    } catch {
      // 静默失败不打断学习
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--red-soft-border)] bg-[var(--red-soft)] p-5 sm:p-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[var(--ink)]">本节要点</h3>
        <button
          type="button"
          onClick={saveCards}
          disabled={saving || saved}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--red-soft-border)] bg-[var(--surface)] px-2.5 py-1 text-xs text-[var(--ink2)] transition-colors hover:text-[var(--ink)] disabled:opacity-60"
          aria-label="存为复习卡"
        >
          {saved ? <><Check size={14} /> 已存入</> : <><Cards size={14} /> {saving ? "存入中…" : "存为复习卡"}</>}
        </button>
      </div>
      <ul className="flex flex-col gap-2.5">
        {points.map((p, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm text-[var(--ink)]">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--red)]" />
            <span className="flex-1">{p}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 提示框：info 蓝调 / warn 黄调。 */
function CalloutBlock({ tone, markdown }: { tone: "info" | "warn"; markdown: string }) {
  const isWarn = tone === "warn";
  // 语义色内联（token 表未定义 info/warn 专用色，用固定值保证深浅色下均可辨）
  const palette = isWarn
    ? { border: "#e6a817", bg: "rgba(230,168,23,0.10)", ink: "#a97a06" }
    : { border: "#3b82f6", bg: "rgba(59,130,246,0.10)", ink: "#2563eb" };
  return (
    <section
      className="flex gap-3 rounded-[var(--radius-card)] border p-4 sm:p-5"
      style={{ borderColor: palette.border, background: palette.bg }}
    >
      <span className="mt-0.5 shrink-0" style={{ color: palette.ink }}>
        {isWarn ? <Warning size={18} weight="fill" /> : <Info size={18} weight="fill" />}
      </span>
      <div
        className="tide-md prose-body flex-1 text-[var(--ink)]"
        // renderMarkdown 已转义，安全注入
        dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
      />
    </section>
  );
}
