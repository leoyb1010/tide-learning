"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Star, PencilSimple, ChatCircleText, CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { RatingStars } from "@/components/RatingStars";
import { useToast } from "@/components/Toast";
import { track } from "@/lib/analytics-client";

/* ============================================================
   课程评价（client · S5 评价系统闭环）
   —— 真实聚合（均分 + 分布）+ 评价列表 + 「写评价」入口（学过才可评）。
   自持三态：加载（骨架）/ 空（引导）/ 错误（清晰文案 + 重试）。
   数据源：GET/POST /api/courses/:id/reviews（服务端 requireUser + assertSameOrigin
   + 学过才可评 + 一人一课一评 upsert；越权铁律 where userId=我）。
   动效全 opacity/transform；reduce-motion 下 useReducedMotion 关位移。
   ============================================================ */

interface ReviewView {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  author: { id: string; nickname: string; avatarUrl: string | null };
}
interface Aggregate {
  score: number;
  count: number;
  isPlaceholder: boolean;
  dist: [number, number, number, number, number];
}
interface ReviewsPayload {
  aggregate: Aggregate;
  reviews: ReviewView[];
  mine: { rating: number; comment: string | null } | null;
  canReview: boolean;
}

type LoadState = "loading" | "error" | "ready";

export function CourseReviews({
  courseId,
  isLoggedIn,
}: {
  /** 课程 id 或 slug（API 两者皆解析）。 */
  courseId: string;
  isLoggedIn: boolean;
}) {
  const reduce = useReducedMotion();
  const { toast } = useToast();

  const [state, setState] = useState<LoadState>("loading");
  const [data, setData] = useState<ReviewsPayload | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch(`/api/courses/${courseId}/reviews`, { cache: "no-store" });
      const json = (await res.json()) as
        | { ok: true; data: ReviewsPayload }
        | { ok: false; error: string };
      if (!json.ok) throw new Error(json.error);
      setData(json.data);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-labelledby="course-reviews-heading" className="flex flex-col gap-4">
      <div className="flex items-baseline gap-2.5">
        <h2 id="course-reviews-heading" className="text-[18px] font-bold text-[var(--ink)]">
          学员评价
        </h2>
        <span className="text-[13px] text-[var(--ink3)]">学过的同学怎么说</span>
      </div>

      {state === "loading" && <ReviewsSkeleton />}
      {state === "error" && <ReviewsError onRetry={load} />}
      {state === "ready" && data && (
        <ReviewsBody
          courseId={courseId}
          isLoggedIn={isLoggedIn}
          data={data}
          reduce={Boolean(reduce)}
          onSubmitted={(next) => setData(next)}
          toast={toast}
        />
      )}
    </section>
  );
}

/* ---------------- 加载态：骨架屏（匹配聚合条 + 列表布局） ---------------- */
function ReviewsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)] sm:grid-cols-[auto_1fr]">
        <div className="flex flex-col items-center gap-2 sm:pr-6">
          <div className="skeleton h-10 w-16" />
          <div className="skeleton h-3.5 w-20" />
        </div>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2" style={{ "--i": i } as React.CSSProperties}>
              <div className="skeleton h-3 w-8" />
              <div className="skeleton h-2 flex-1 rounded-full" />
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4" style={{ "--i": i } as React.CSSProperties}>
            <div className="flex items-center gap-2.5">
              <div className="skeleton h-8 w-8 shrink-0 rounded-full" />
              <div className="skeleton h-4 w-24" />
            </div>
            <div className="skeleton mt-3 h-3.5 w-full" />
            <div className="skeleton mt-2 h-3.5 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- 错误态：清晰文案 + 重试（不是笼统「出错了」） ---------------- */
function ReviewsError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[16px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-6 py-10 text-center">
      <WarningCircle size={28} weight="light" className="text-[var(--red)]" />
      <div>
        <p className="text-[14px] font-semibold text-[var(--ink)]">评价没能加载出来</p>
        <p className="mt-1 text-[13px] text-[var(--ink2)]">可能是网络波动，退潮后再试一次。</p>
      </div>
      <button
        onClick={onRetry}
        className="studio-press inline-flex min-h-[44px] items-center rounded-[11px] border border-[var(--red-soft-border)] bg-[var(--surface)] px-5 text-[13px] font-semibold text-[var(--red)] transition-colors hover:border-[var(--red)]"
      >
        重新加载
      </button>
    </div>
  );
}

/* ---------------- 就绪态：聚合 + 写评价入口 + 列表（含空态） ---------------- */
function ReviewsBody({
  courseId,
  isLoggedIn,
  data,
  reduce,
  onSubmitted,
  toast,
}: {
  courseId: string;
  isLoggedIn: boolean;
  data: ReviewsPayload;
  reduce: boolean;
  onSubmitted: (next: ReviewsPayload) => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const { aggregate, reviews, mine, canReview } = data;
  const [formOpen, setFormOpen] = useState(false);
  const maxDist = Math.max(1, ...aggregate.dist);
  const hasReal = !aggregate.isPlaceholder && aggregate.count > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* 聚合条：均分 + 星级 + 分布 */}
      <div className="grid gap-5 rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card),var(--inner-hi)] sm:grid-cols-[auto_1fr]">
        <div className="flex flex-col items-center justify-center gap-1.5 sm:border-r sm:border-[var(--border)] sm:pr-6">
          <span className="mono text-[40px] font-extrabold leading-none tracking-tight text-[var(--ink)]">
            {aggregate.score.toFixed(1)}
          </span>
          <RatingStars score={aggregate.score} showCount={false} size={14} />
          <span className="text-[12px] text-[var(--ink3)]">
            {hasReal ? `${aggregate.count.toLocaleString()} 条评价` : "示例评分"}
          </span>
        </div>
        <div className="flex flex-col justify-center gap-1.5">
          {/* 分布：5→1 星，条形与最高档等比。占位时全 0，仍展示空条（诚实）。 */}
          {[5, 4, 3, 2, 1].map((star) => {
            const n = aggregate.dist[star - 1];
            const pct = hasReal ? Math.round((n / maxDist) * 100) : 0;
            return (
              <div key={star} className="flex items-center gap-2.5 text-[12px]">
                <span className="mono flex w-9 shrink-0 items-center gap-0.5 text-[var(--ink3)]">
                  {star}
                  <Star size={11} weight="fill" className="text-[var(--warn)]" />
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface-inset)]">
                  <motion.span
                    className="block h-full rounded-full bg-[var(--warn)]"
                    initial={reduce ? false : { width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={reduce ? { duration: 0 } : { duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  />
                </span>
                <span className="mono w-8 shrink-0 text-right text-[var(--ink4)]">{hasReal ? n : "—"}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 写评价入口：仅登录且学过的用户可见。已评过则改为「修改评价」。 */}
      {isLoggedIn && canReview && (
        <div>
          {!formOpen ? (
            <button
              onClick={() => setFormOpen(true)}
              className="studio-press inline-flex min-h-[44px] items-center gap-2 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 text-[13.5px] font-semibold text-[var(--ink)] shadow-[var(--card)] transition-colors hover:border-[var(--red)] hover:text-[var(--red)]"
            >
              <PencilSimple size={16} weight="bold" />
              {mine ? "修改我的评价" : "写下我的评价"}
            </button>
          ) : (
            <ReviewForm
              courseId={courseId}
              initial={mine}
              reduce={reduce}
              toast={toast}
              onCancel={() => setFormOpen(false)}
              onDone={(next) => {
                setFormOpen(false);
                onSubmitted(next);
                toast(mine ? "评价已更新" : "评价已发布，感谢你的分享", { tone: "success" });
              }}
            />
          )}
        </div>
      )}
      {/* 登录但没学过：温和引导（学过才可评，避免刷分） */}
      {isLoggedIn && !canReview && (
        <p className="rounded-[12px] border border-dashed border-[var(--border2)] bg-[var(--surface2)] px-4 py-3 text-[12.5px] text-[var(--ink2)]">
          学过这门课就能写评价，先去学一节，回来分享你的收获。
        </p>
      )}

      {/* 列表 / 空态 */}
      {reviews.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {reviews.map((r, i) => (
            <ReviewItem key={r.id} review={r} index={i} reduce={reduce} />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2.5 rounded-[16px] border border-dashed border-[var(--border2)] bg-[var(--surface)] px-6 py-12 text-center shadow-[var(--inner-hi)]">
          <span className="grid h-12 w-12 place-items-center rounded-[14px] bg-[var(--red-soft)]">
            <ChatCircleText size={22} weight="fill" className="text-[var(--red)]" />
          </span>
          <p className="text-[14px] font-semibold text-[var(--ink)]">还没有学员评价</p>
          <p className="text-[13px] leading-[1.6] text-[var(--ink2)]">
            {isLoggedIn && canReview
              ? "你学过这门课，来当第一个留下评价的人吧。"
              : "学过这门课的同学可以在这里留下第一条评价。"}
          </p>
        </div>
      )}
    </div>
  );
}

/* ---------------- 单条评价 ---------------- */
function ReviewItem({ review, index, reduce }: { review: ReviewView; index: number; reduce: boolean }) {
  const initial = review.author.nickname.slice(0, 1) || "学";
  return (
    <motion.li
      initial={reduce ? false : { opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={reduce ? { duration: 0 } : { duration: 0.4, delay: Math.min(index * 0.04, 0.2), ease: [0.16, 1, 0.3, 1] }}
      className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {review.author.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={review.author.avatarUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-[var(--border2)]"
            />
          ) : (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--red-soft)] text-[12px] font-bold text-[var(--red-ink)] ring-1 ring-[var(--red-soft-border)]">
              {initial}
            </span>
          )}
          <span className="truncate text-[13.5px] font-semibold text-[var(--ink)]">{review.author.nickname}</span>
        </div>
        <span className="flex shrink-0 items-center gap-[1px]" aria-label={`${review.rating} 星`}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Star
              key={i}
              size={13}
              weight={i < review.rating ? "fill" : "regular"}
              className={i < review.rating ? "text-[var(--warn)]" : "text-[var(--ink4)]"}
            />
          ))}
        </span>
      </div>
      {review.comment && (
        <p className="mt-2.5 text-[13.5px] leading-[1.7] text-[var(--ink2)]">{review.comment}</p>
      )}
    </motion.li>
  );
}

/* ---------------- 写评价表单：星选 + 文本 ---------------- */
function ReviewForm({
  courseId,
  initial,
  reduce,
  toast,
  onCancel,
  onDone,
}: {
  courseId: string;
  initial: { rating: number; comment: string | null } | null;
  reduce: boolean;
  toast: ReturnType<typeof useToast>["toast"];
  onCancel: () => void;
  onDone: (next: ReviewsPayload) => void;
}) {
  const [rating, setRating] = useState(initial?.rating ?? 0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(async () => {
    if (rating < 1) {
      toast("请先选择评分", { tone: "warn" });
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/reviews`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating, comment: comment.trim() || undefined }),
      });
      const json = (await res.json()) as
        | { ok: true; data: ReviewsPayload }
        | { ok: false; error: string };
      if (!json.ok) {
        toast(json.error, { tone: "warn" });
        return;
      }
      track("course_review_submit", { course_id: courseId, rating });
      onDone(json.data);
    } catch {
      toast("提交失败，请检查网络后重试", { tone: "warn" });
    } finally {
      setSubmitting(false);
    }
  }, [rating, comment, submitting, courseId, toast, onDone]);

  const shown = hover || rating;
  const HINTS = ["", "不太满意", "一般", "还不错", "很满意", "非常推荐"];

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card),var(--inner-hi)]"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[13.5px] font-semibold text-[var(--ink)]">我的评分</span>
        <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              aria-label={`${star} 星`}
              onMouseEnter={() => setHover(star)}
              onClick={() => setRating(star)}
              className="grid h-9 w-9 place-items-center rounded-[9px] transition-transform hover:scale-110"
            >
              <Star
                size={24}
                weight={star <= shown ? "fill" : "regular"}
                className={star <= shown ? "text-[var(--warn)]" : "text-[var(--ink4)]"}
              />
            </button>
          ))}
        </div>
        <AnimatePresence mode="wait">
          {shown > 0 && (
            <motion.span
              key={shown}
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduce ? { opacity: 1 } : { opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="text-[13px] font-medium text-[var(--red)]"
            >
              {HINTS[shown]}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value.slice(0, 500))}
        rows={3}
        placeholder="说说这门课哪里帮到你了（选填，最多 500 字）"
        className="mt-3 w-full resize-none rounded-[12px] border border-[var(--border)] bg-[var(--surface-inset)] px-3.5 py-3 text-[13.5px] leading-[1.6] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--red)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red-soft)]"
      />

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="mono text-[11px] text-[var(--ink4)]">{comment.length}/500</span>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="studio-press inline-flex min-h-[44px] items-center rounded-[11px] px-4 text-[13px] font-medium text-[var(--ink3)] transition-colors hover:text-[var(--ink)]"
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={submitting || rating < 1}
            className="cta-glow studio-press inline-flex min-h-[44px] items-center gap-1.5 rounded-[11px] bg-[var(--red)] px-5 text-[13px] font-bold text-white transition-all hover:brightness-105 disabled:opacity-50"
          >
            <CheckCircle size={16} weight="fill" />
            {submitting ? "提交中" : initial ? "更新评价" : "发布评价"}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
