"use client";

/**
 * GenProgress —— v3.0「进度可见 + 剧场恢复」前端闭环的共享件。
 *
 * 提供三样东西，供 CreateStudio / me/courses / TopNav 复用：
 *  1) <ProgressRing>   —— framer-motion 环形进度（done/total），reduce-motion 下静态描边。
 *  2) <Spinner>        —— 统一转圈（进行中信号），reduce-motion 下降级为静态点。
 *  3) useGenPolling()  —— 轮询 GET /api/courses/:id/gen-progress 的 hook：
 *       · 仅 document.visibilityState==='visible' 时轮询（每 3s）
 *       · genStatus==='ready' 或 'failed' 时停止
 *       · 首帧立即拉一次（水合恢复），之后按节奏轮询
 *  4) resumeGen()      —— 调 POST /api/courses/:id/resume-gen（同源写，带凭证）。
 *
 * 所有颜色走 STUDIO 语义 token；可见文本零 em-dash。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { SPRING_GENTLE } from "@/components/motion";

/** gen-progress 返回体（与 /api/courses/:id/gen-progress 对齐） */
export interface GenProgress {
  total: number;
  done: number;
  failed: number;
  currentLessonId: string | null;
  genStatus: string | null; // generating / ready / failed
  lessons: { id: string; title: string; ready: boolean }[];
}

/* ============================================================
   ProgressRing —— 环形进度（done/total）
   ============================================================ */
export function ProgressRing({
  done,
  total,
  size = 44,
  stroke = 4,
  showLabel = true,
  className,
}: {
  done: number;
  total: number;
  size?: number;
  stroke?: number;
  /** 圆心是否显示「done/total」文字（小尺寸可关掉只留环） */
  showLabel?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const pct = total > 0 ? Math.min(1, done / total) : 0;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct);
  const half = size / 2;

  return (
    <div
      className={`relative shrink-0 ${className ?? ""}`}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-label={`已生成 ${done} / ${total} 节`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        {/* 轨道 */}
        <circle
          cx={half}
          cy={half}
          r={r}
          fill="none"
          stroke="var(--border2)"
          strokeWidth={stroke}
        />
        {/* 进度弧：红作为专注/进行中信号 */}
        <motion.circle
          cx={half}
          cy={half}
          r={r}
          fill="none"
          stroke="var(--red)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          initial={false}
          animate={{ strokeDashoffset: offset }}
          transition={reduce ? { duration: 0 } : { ...SPRING_GENTLE, type: "spring" }}
        />
      </svg>
      {showLabel && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="mono text-[10px] font-bold leading-none text-[var(--ink)]">
            {done}
            <span className="text-[var(--ink4)]">/{total}</span>
          </span>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Spinner —— 进行中转圈（reduce-motion 降级为静态描边点）
   ============================================================ */
export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) {
    // 降级：不转，改用静态实心点（仍传达「进行中」的存在感，避免眩晕）
    return (
      <span
        className={`inline-block shrink-0 animate-none rounded-full bg-[var(--red)] ${className ?? ""}`}
        style={{ width: size * 0.5, height: size * 0.5 }}
        aria-hidden="true"
      />
    );
  }
  return (
    <span
      className={`inline-block shrink-0 animate-spin rounded-full border-2 border-[var(--red)] border-t-transparent ${className ?? ""}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

/* ============================================================
   useGenPolling —— 轮询 gen-progress（页面可见时每 3s，ready/failed 停）
   ============================================================ */
const POLL_MS = 3000;

export function useGenPolling(
  courseId: string | null | undefined,
  opts?: { enabled?: boolean; intervalMs?: number; onReady?: (p: GenProgress) => void },
): {
  progress: GenProgress | null;
  loading: boolean;
  error: boolean;
  /** 手动立即拉一次（如 resume 成功后立刻刷新，不等下一个 tick） */
  refresh: () => void;
} {
  const enabled = opts?.enabled ?? true;
  const intervalMs = opts?.intervalMs ?? POLL_MS;
  const [progress, setProgress] = useState<GenProgress | null>(null);
  const [loading, setLoading] = useState<boolean>(!!courseId && enabled);
  const [error, setError] = useState(false);
  // 用 ref 记录是否已终态，避免 setState 后 effect 重跑造成竞态。
  const stoppedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onReadyRef = useRef(opts?.onReady);
  onReadyRef.current = opts?.onReady;
  const firedReadyRef = useRef(false);

  const fetchOnce = useCallback(async (): Promise<GenProgress | null> => {
    if (!courseId) return null;
    try {
      const r = await fetch(`/api/courses/${courseId}/gen-progress`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setError(true);
        return null;
      }
      const p = j.data as GenProgress;
      setProgress(p);
      setError(false);
      // 终态：ready（全部就绪）或 failed（后台整体失败），停止轮询。
      if (p.genStatus === "ready" || p.genStatus === "failed") {
        stoppedRef.current = true;
        if (p.genStatus === "ready" && !firedReadyRef.current) {
          firedReadyRef.current = true;
          onReadyRef.current?.(p);
        }
      }
      return p;
    } catch {
      setError(true);
      return null;
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    stoppedRef.current = false;
    firedReadyRef.current = false;
    if (!courseId || !enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    const schedule = () => {
      if (cancelled || stoppedRef.current) return;
      timerRef.current = setTimeout(tick, intervalMs);
    };

    const tick = async () => {
      // 页面不可见：不打后端，等回到前台再继续（省流 + 省额度）。
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        schedule();
        return;
      }
      const p = await fetchOnce();
      if (cancelled) return;
      if (p && (p.genStatus === "ready" || p.genStatus === "failed")) return; // 终态，不再排期
      schedule();
    };

    // 首帧立即拉一次（水合恢复：进入时直接得到当前进度）
    (async () => {
      const p = await fetchOnce();
      if (cancelled) return;
      if (p && (p.genStatus === "ready" || p.genStatus === "failed")) return;
      schedule();
    })();

    // 从后台切回前台：若还没终态，立刻补一拍（不必等到下个 3s）
    const onVis = () => {
      if (document.visibilityState === "visible" && !stoppedRef.current && !cancelled) {
        if (timerRef.current) clearTimeout(timerRef.current);
        tick();
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [courseId, enabled, intervalMs, fetchOnce]);

  const refresh = useCallback(() => {
    if (stoppedRef.current) return;
    fetchOnce();
  }, [fetchOnce]);

  return { progress, loading, error, refresh };
}

/* ============================================================
   resumeGen —— POST /api/courses/:id/resume-gen（同源写）
   ============================================================ */
export async function resumeGen(
  courseId: string,
): Promise<{ ok: boolean; status: number; error?: string; resumed?: boolean; genStatus?: string }> {
  try {
    const r = await fetch(`/api/courses/${courseId}/resume-gen`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) {
      return { ok: false, status: r.status, error: j?.error };
    }
    return { ok: true, status: r.status, resumed: j.data?.resumed, genStatus: j.data?.genStatus };
  } catch {
    return { ok: false, status: 0, error: "网络异常" };
  }
}
