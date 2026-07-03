"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowsClockwise, CheckCircle, XCircle, Confetti, BookOpen } from "@phosphor-icons/react";
import { EmptyTide } from "@/components/TideIllustration";
import { ErrorState, CardSkeleton, Button } from "@/components/ui";
import { TidalReveal, SPRING_TIDE } from "@/components/motion";
import { renderMarkdown } from "@/lib/markdown";
import { track } from "@/lib/analytics-client";

interface ReviewCard {
  id: string;
  front: string;
  back: string;
  courseTitle: string | null;
}

/**
 * §5.4 复习页 —— 今日待复习队列。
 * 逐张翻面练习（点击卡片 front ↔ back），「记得 / 忘了」提交后走 SM-2 调度更新 dueAt，
 * 卡片滑出、下一张进入。全部复习完 → 完成态。空态友好引导去笔记页生成复习卡。
 */
export default function ReviewPage() {
  const [cards, setCards] = useState<ReviewCard[] | null>(null);
  const [error, setError] = useState(false);
  const [needLogin, setNeedLogin] = useState(false);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reviewed, setReviewed] = useState(0); // 本次已复习张数
  const [grading, setGrading] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const [res, meRes] = await Promise.all([
        fetch("/api/ai/review-card").then((r) => r.json()),
        fetch("/api/auth/me").then((r) => r.json()),
      ]);
      if (!meRes.data?.user) {
        setNeedLogin(true);
        setCards([]);
        return;
      }
      if (!res.ok) throw new Error();
      setCards((res.data?.cards ?? []) as ReviewCard[]);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const current = cards?.[idx];

  // 提交复习结果：更新调度并前进到下一张
  async function grade(remembered: boolean) {
    if (!current || grading) return;
    setGrading(true);
    try {
      await fetch("/api/ai/review-card", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardId: current.id, remembered }),
      }).catch(() => {});
      track("review_card_grade", { remembered });
      setReviewed((n) => n + 1);
      setFlipped(false);
      setIdx((i) => i + 1);
    } finally {
      setGrading(false);
    }
  }

  const done = cards !== null && idx >= cards.length;
  const total = cards?.length ?? 0;

  return (
    <div className="mx-auto max-w-[720px] space-y-7">
      <TidalReveal>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink4)]">REVIEW · 复习室</div>
            <h1 className="mt-2 text-[26px] font-bold leading-tight text-[var(--ink)]">今日复习</h1>
            <p className="mt-1.5 max-w-[520px] text-[15px] leading-[1.7] text-[var(--ink2)]">
              到期的复习卡都在这里。翻面回忆，凭记得或忘了让间隔重复帮你记牢。
            </p>
          </div>
          {total > 0 && !done && (
            <div className="mono rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-[13px] font-semibold text-[var(--ink2)] shadow-[var(--card)]">
              <span className="text-[var(--red)]">{Math.min(idx + 1, total)}</span> / {total}
            </div>
          )}
        </div>
      </TidalReveal>

      {/* 进度条 */}
      {total > 0 && !done && (
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface2)]">
          <motion.div
            className="h-full rounded-full bg-[var(--red)]"
            initial={false}
            animate={{ width: `${(reviewed / total) * 100}%` }}
            transition={{ ...SPRING_TIDE, type: "spring" }}
          />
        </div>
      )}

      {error ? (
        <ErrorState hint="复习队列加载失败" onRetry={() => void load()} />
      ) : cards === null ? (
        <div className="space-y-4">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : needLogin ? (
        <EmptyTide
          variant="notes"
          description="登录后即可开始今日复习"
          action={<Button href="/login?next=/review">去登录</Button>}
        />
      ) : total === 0 ? (
        <EmptyTide
          variant="notes"
          description="暂无到期的复习卡。去笔记馆用「AI 整理 · 生成复习卡」把笔记变成可复习的卡片。"
          action={<Button href="/notes">去笔记馆</Button>}
        />
      ) : done ? (
        <CompleteState reviewed={reviewed} onReload={() => { setIdx(0); setReviewed(0); void load(); }} />
      ) : current ? (
        <div className="space-y-5">
          {/* 卡片：点击 3D 翻面（signature 翻牌动效） */}
          <AnimatePresence mode="wait">
            <motion.div
              key={current.id}
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16, scale: 0.98 }}
              transition={{ ...SPRING_TIDE, type: "spring" }}
              className="flip3d"
            >
              <button
                type="button"
                onClick={() => setFlipped((f) => !f)}
                className={`flip3d-inner studio-lift block w-full text-left ${flipped ? "is-flipped" : ""}`}
              >
                {/* 正面 · 问题 */}
                <div className="flip3d-face rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-8 shadow-[var(--card)]">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface2)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink3)]">
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
                    <ArrowsClockwise size={13} /> 点击卡片翻面看答案
                  </div>
                </div>

                {/* 背面 · 答案（3D 预旋 180°） */}
                <div className="flip3d-back rounded-[18px] border border-[var(--red-soft-border)] bg-[var(--surface)] p-8 shadow-[var(--card)]">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--red-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--red)]">
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
                    <ArrowsClockwise size={13} /> 点击卡片查看问题
                  </div>
                </div>
              </button>
            </motion.div>
          </AnimatePresence>

          {/* 记得 / 忘了 —— 翻面后才可评分，引导先回忆 */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={!flipped || grading}
              onClick={() => grade(false)}
              className="studio-press inline-flex items-center justify-center gap-2 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] py-3.5 text-[14px] font-semibold text-[var(--ink2)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <XCircle size={18} weight="fill" className="text-[var(--ink3)]" /> 忘了
            </button>
            <button
              type="button"
              disabled={!flipped || grading}
              onClick={() => grade(true)}
              className="studio-press inline-flex items-center justify-center gap-2 rounded-[14px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] py-3.5 text-[14px] font-semibold text-[var(--red)] shadow-[var(--card)] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CheckCircle size={18} weight="fill" /> 记得
            </button>
          </div>
          {!flipped && (
            <p className="text-center text-[12px] text-[var(--ink4)]">先回忆，再翻面自评 —— 主动回忆才记得牢。</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** 复习完成态：庆祝 + 再来一轮（重新拉取，可能有刚重置到期的卡） */
function CompleteState({ reviewed, onReload }: { reviewed: number; onReload: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING_TIDE, type: "spring" }}
      className="studio-rise flex flex-col items-center gap-4 rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-10 text-center shadow-[var(--card)]"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--red-soft)] text-[var(--red)]">
        <Confetti size={30} weight="fill" />
      </div>
      <h2 className="text-[20px] font-bold text-[var(--ink)]">今日复习完成</h2>
      <p className="text-[14px] leading-[1.7] text-[var(--ink2)]">
        本轮复习了 <span className="mono font-bold text-[var(--red)]">{reviewed}</span> 张卡片。
        记得的会拉长间隔，忘了的明天再见 —— 坚持每天，记忆自然稳固。
      </p>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={onReload}
          className="studio-press inline-flex items-center gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-[13px] font-semibold text-[var(--ink)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)]"
        >
          <ArrowsClockwise size={15} weight="bold" /> 再检查一遍
        </button>
        <Button href="/notes">回笔记馆</Button>
      </div>
    </motion.div>
  );
}
