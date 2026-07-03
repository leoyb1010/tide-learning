"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sparkle, FilePlus, MagicWand, ArrowRight, Lock } from "@phosphor-icons/react";
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

type Tab = "generate" | "import";

/** 生成阶段：idle → outline(生成大纲) → lessons(逐节) → done/error */
type Phase = "idle" | "outline" | "lessons";

interface OutlineLesson {
  id: string;
  title: string;
}

/**
 * AI 造课交互组件（引擎A 前端壳）。
 * - 生成课：POST /api/ai/generate-course 拿 courseId + lessons，再逐节 POST /api/ai/generate-lesson，
 *   全部完成后跳 /courses/{slug}/learn/{firstLessonId}；生成中显示「第 N/M 节」进度。
 * - 导入资料：POST /api/ai/import-source（route 未就绪时前端已发起调用，失败给 toast 提示）。
 * 权益不足（canUseLLM=false）：后端返回 402，前端提示去订阅。
 */
export function CreateStudio({ canUseLLM }: { canUseLLM: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("generate");

  // —— 生成课状态 ——
  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState<string>("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });

  // —— 导入资料状态 ——
  const [importTitle, setImportTitle] = useState("");
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);

  const busy = phase !== "idle";

  // 未订阅时的统一提示
  const gate = () => {
    toast("AI 造课为订阅会员专享功能", {
      tone: "warn",
      action: { label: "去订阅", onClick: () => router.push("/pricing") },
    });
  };

  async function handleGenerate() {
    if (busy) return;
    const q = prompt.trim();
    if (!q) {
      toast("先描述一下你想学什么吧", { tone: "info" });
      return;
    }
    if (!canUseLLM) return gate();

    track("hero_cta_click", { source: "create_generate" });
    setPhase("outline");
    setProgress({ done: 0, total: 0 });
    try {
      // Step0：一句话 → 课程大纲（落库 course + 空 lessons）
      const res = await fetch("/api/ai/generate-course", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: q, category: category || undefined }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        // 402 权益不足单独引导订阅
        if (res.status === 402) {
          setPhase("idle");
          return gate();
        }
        throw new Error(json?.error || "生成失败");
      }

      const { slug, lessons } = json.data as { courseId: string; slug: string; lessons: OutlineLesson[] };
      if (!Array.isArray(lessons) || lessons.length === 0) throw new Error("大纲为空，请调整需求重试");

      // Step1..N：逐节生成块课件（串行，实时更新进度，单节失败不阻断整体）
      setPhase("lessons");
      setProgress({ done: 0, total: lessons.length });
      let failed = 0;
      for (let i = 0; i < lessons.length; i++) {
        try {
          const r = await fetch("/api/ai/generate-lesson", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lessonId: lessons[i].id }),
          });
          const lj = await r.json().catch(() => null);
          if (!r.ok || !lj?.ok) {
            if (r.status === 402) {
              setPhase("idle");
              return gate();
            }
            failed++;
          }
        } catch {
          failed++;
        }
        setProgress({ done: i + 1, total: lessons.length });
      }

      if (failed > 0) {
        toast(`已生成 ${lessons.length - failed}/${lessons.length} 节，个别章节可稍后重新生成`, { tone: "warn" });
      } else {
        toast("课程已生成，开始学习吧", { tone: "success" });
      }
      // 跳转到首节学习页
      router.push(`/courses/${slug}/learn/${lessons[0].id}`);
    } catch (e) {
      setPhase("idle");
      toast(e instanceof Error ? e.message : "生成失败，请稍后再试", { tone: "warn" });
    }
  }

  async function handleImport() {
    if (importing) return;
    const text = importText.trim();
    if (!text) {
      toast("先把你的资料粘贴进来吧", { tone: "info" });
      return;
    }
    if (!canUseLLM) return gate();

    setImporting(true);
    try {
      const res = await fetch("/api/ai/import-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: importTitle.trim() || undefined, sourceText: text }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        if (res.status === 402) return gate();
        // route 未就绪（404 等）时也走这里，给出温和提示
        if (res.status === 404) {
          toast("资料整理功能即将上线，敬请期待", { tone: "info" });
          return;
        }
        throw new Error(json?.error || "整理失败");
      }
      const { slug, firstLessonId } = (json.data ?? {}) as { slug?: string; firstLessonId?: string };
      toast("资料已整理成课", { tone: "success" });
      if (slug && firstLessonId) router.push(`/courses/${slug}/learn/${firstLessonId}`);
      else if (slug) router.push(`/courses/${slug}`);
      else router.push("/me/courses");
    } catch (e) {
      toast(e instanceof Error ? e.message : "整理失败，请稍后再试", { tone: "warn" });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col items-center">
      {/* —— 顶部大标题 —— */}
      <div className="mb-1.5 flex items-center gap-2 rounded-full border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-3 py-1">
        <Sparkle size={13} weight="fill" className="text-[var(--red)]" />
        <span className="mono text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--red)]">AI STUDIO</span>
      </div>
      <h1 className="text-center text-[30px] font-extrabold leading-[1.15] tracking-tight text-[var(--ink)] sm:text-[38px]">
        一句话，生成你的专属课
      </h1>
      <p className="mt-2.5 max-w-[460px] text-center text-[15px] leading-relaxed text-[var(--ink2)]">
        说出你想学的，AI 现场搭好课程大纲、逐节写好讲解与测验，学完就能用。
      </p>

      {/* —— Tab 切换 —— */}
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
              disabled={busy}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold transition-all duration-150 disabled:opacity-45 ${
                active ? "bg-[var(--surface)] text-[var(--ink)] shadow-[var(--card)]" : "text-[var(--ink3)] hover:text-[var(--ink)]"
              }`}
            >
              <t.Icon size={15} weight={active ? "fill" : "regular"} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* —— 权益不足横幅 —— */}
      {!canUseLLM && (
        <div className="mt-5 flex w-full items-center gap-2.5 rounded-[12px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-4 py-3 text-[13px] text-[var(--ink2)]">
          <Lock size={16} weight="fill" className="shrink-0 text-[var(--red)]" />
          <span className="flex-1">AI 造课为订阅会员专享，订阅后即可无限生成专属课程。</span>
          <Button href="/pricing" size="sm" variant="primary">去订阅</Button>
        </div>
      )}

      {/* —— 面板 —— */}
      <div className="mt-5 w-full rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)] sm:p-6">
        {tab === "generate" ? (
          <div className="flex flex-col gap-4">
            <div className="relative">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={busy}
                rows={5}
                maxLength={500}
                placeholder="描述你想学的，比如：讲讲 Python 装饰器，我是初学者"
                className="w-full resize-none rounded-[14px] border border-[var(--border2)] bg-[var(--bg2)] px-4 py-3.5 text-[16px] leading-relaxed text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--red)] focus:bg-[var(--surface)] disabled:opacity-60"
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
                      disabled={busy}
                      onClick={() => setCategory(active ? "" : t.key)}
                      className={`rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-all duration-150 disabled:opacity-45 ${
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

            {/* 生成中进度 或 生成按钮 */}
            {busy ? (
              <div className="flex flex-col gap-2.5 rounded-[14px] border border-[var(--border)] bg-[var(--bg2)] px-4 py-4">
                <div className="flex items-center gap-2.5">
                  <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--red)] border-t-transparent" />
                  <span className="text-[13.5px] font-semibold text-[var(--ink)]">
                    {phase === "outline"
                      ? "正在设计课程大纲…"
                      : `正在生成第 ${Math.min(progress.done + 1, progress.total)}/${progress.total} 节…`}
                  </span>
                </div>
                {phase === "lessons" && progress.total > 0 && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border2)]">
                    <div
                      className="h-full rounded-full bg-[var(--red)] transition-all duration-300"
                      style={{ width: `${(progress.done / progress.total) * 100}%` }}
                    />
                  </div>
                )}
                <p className="text-[11.5px] text-[var(--ink3)]">生成中请勿关闭页面，全部完成后自动进入学习。</p>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleGenerate}
                className="group inline-flex w-full items-center justify-center gap-2 rounded-[14px] bg-[var(--red)] px-5 py-3.5 text-[15px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(252,1,26,0.5)] transition-all duration-200 [transition-timing-function:var(--ease-out-expo)] hover:brightness-105 active:translate-y-px active:scale-[0.99]"
              >
                <Sparkle size={17} weight="fill" />
                生成课程
                <ArrowRight size={16} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" />
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <input
              value={importTitle}
              onChange={(e) => setImportTitle(e.target.value)}
              disabled={importing}
              maxLength={60}
              placeholder="课程标题（可留空，AI 帮你起）"
              className="w-full rounded-[14px] border border-[var(--border2)] bg-[var(--bg2)] px-4 py-3 text-[15px] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--red)] focus:bg-[var(--surface)] disabled:opacity-60"
            />
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              disabled={importing}
              rows={8}
              placeholder="把你的学习资料 / PDF 内容 / 文章粘贴进来，AI 帮你整理成可学的课"
              className="w-full resize-none rounded-[14px] border border-[var(--border2)] bg-[var(--bg2)] px-4 py-3.5 text-[15px] leading-relaxed text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--red)] focus:bg-[var(--surface)] disabled:opacity-60"
            />
            <button
              type="button"
              onClick={handleImport}
              disabled={importing}
              className="group inline-flex w-full items-center justify-center gap-2 rounded-[14px] bg-[var(--red)] px-5 py-3.5 text-[15px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(252,1,26,0.5)] transition-all duration-200 [transition-timing-function:var(--ease-out-expo)] hover:brightness-105 active:translate-y-px active:scale-[0.99] disabled:opacity-45 disabled:pointer-events-none"
            >
              {importing && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
              <FilePlus size={17} weight="fill" />
              整理成课
            </button>
            <p className="text-center text-[11.5px] text-[var(--ink3)]">AI 会把长文拆成章节，配上要点与测验，帮你把资料变成能学的课。</p>
          </div>
        )}
      </div>
    </div>
  );
}
