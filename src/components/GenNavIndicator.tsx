"use client";

/**
 * GenNavIndicator —— TopNav 轻量「生产中指示」（client）。
 *
 * 有生成中的课时，导航区出现一枚小胶囊：课名首字 + 转圈 + （多门时）计数，
 * 点击直达 /create（回到剧场恢复）。无生成中课时不渲染任何东西（零占位）。
 *
 * 轮询策略：挂载拉一次，之后仅在有生成中课 + 页面可见时每 8s 轮询一次
 * （比剧场页 3s 更慢，全局指示无需高频）；全部就绪后不再排期。
 * 走 STUDIO token；可见文本零 em-dash；转圈经 Spinner + reduce-motion 降级。
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Spinner } from "@/components/GenProgress";
import { track } from "@/lib/analytics-client";

interface GenCourse {
  id: string;
  slug: string;
  title: string;
  isImport: boolean;
  total: number;
  done: number;
  firstLessonId: string | null;
}

const POLL_MS = 8000;

export function GenNavIndicator() {
  const pathname = usePathname();
  const [courses, setCourses] = useState<GenCourse[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchOnce(): Promise<GenCourse[]> {
      try {
        const r = await fetch("/api/courses/generating", { credentials: "same-origin", cache: "no-store" });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) return [];
        const list = (j.data?.courses as GenCourse[]) ?? [];
        if (!cancelled) setCourses(list);
        return list;
      } catch {
        return [];
      }
    }

    const schedule = (hasGen: boolean) => {
      if (cancelled || !hasGen) return; // 无生成中课：停止轮询，等下次路由变化再拉。
      timerRef.current = setTimeout(tick, POLL_MS);
    };

    const tick = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        schedule(true); // 不可见：不打后端，保持排期，回前台再拉。
        return;
      }
      const list = await fetchOnce();
      if (cancelled) return;
      schedule(list.length > 0);
    };

    (async () => {
      const list = await fetchOnce();
      if (cancelled) return;
      schedule(list.length > 0);
    })();

    const onVis = () => {
      if (document.visibilityState === "visible" && !cancelled) {
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
    // 路由变化时重新拉取（例如刚在 /create 触发了造课，切页后指示应及时出现）。
  }, [pathname]);

  if (courses.length === 0) return null;

  const first = courses[0];
  const extra = courses.length - 1;
  const totalDone = courses.reduce((s, c) => s + c.done, 0);
  const totalAll = courses.reduce((s, c) => s + c.total, 0);
  const title =
    courses.length === 1
      ? `生产中：${first.title} · ${first.done}/${first.total} 节`
      : `${courses.length} 门课生产中 · 共 ${totalDone}/${totalAll} 节`;

  return (
    <Link
      href="/create"
      onClick={() => track("gen_nav_indicator_click", { count: courses.length })}
      title={title}
      aria-label={title}
      className="studio-lift mb-2 hidden items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--red-soft-border)] bg-[var(--red-soft)] py-1.5 pl-2 pr-2.5 text-[12.5px] shadow-[var(--card)] transition-colors hover:brightness-[0.98] sm:inline-flex"
    >
      <span
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white"
        style={{ background: "linear-gradient(135deg, var(--red), #ff5462)" }}
        aria-hidden="true"
      >
        {first.title.slice(0, 1)}
      </span>
      <Spinner size={11} />
      <span className="mono font-semibold text-[var(--red-ink)]">
        {first.done}/{first.total}
        {extra > 0 ? ` +${extra}` : ""}
      </span>
    </Link>
  );
}
