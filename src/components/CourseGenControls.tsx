"use client";

/**
 * CourseGenControls —— /me/courses 课卡的生成态操作区（client）。
 *
 * 生成中(genStatus=generating)：环形进度(done/total) + 「查看进度」直达 /create（回到剧场）。
 * 失败(genStatus=failed) / 已暂停(genStatus=paused，L3 可控造课)：环形进度 + 「继续生成」按钮
 *   （调 POST resume-gen，从第一个未完成节续跑）。paused 与 failed 同为「已停下、可续造」终态，只是文案不同。
 *
 * 环形进度自身轻量轮询（复用 useGenPolling：仅页面可见时每 3s，ready 停），
 * 让「我的课」列表里的进度环随后台推进实时更新，无需刷新页面。
 * 所有颜色走 STUDIO token；可见文本零 em-dash；动效经 framer-motion + reduce-motion 降级。
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowClockwise } from "@phosphor-icons/react";
import { ProgressRing, Spinner, useGenPolling, resumeGen } from "@/components/GenProgress";
import { useToast } from "@/components/Toast";
import { track } from "@/lib/analytics-client";

export function CourseGenControls({
  courseId,
  initialTotal,
  initialDone,
  initialStatus,
}: {
  courseId: string;
  initialTotal: number;
  initialDone: number;
  /** 服务端算出的初始态：generating / failed / paused（ready 不渲染本组件） */
  initialStatus: "generating" | "failed" | "paused";
}) {
  const { toast } = useToast();
  const [resuming, setResuming] = useState(false);
  // 本地态：resume 成功后立刻从 failed/paused 切到 generating（不必等服务端下一拍）。
  const [statusOverride, setStatusOverride] = useState<"generating" | "failed" | null>(null);

  const { progress } = useGenPolling(courseId);
  const total = progress?.total ?? initialTotal;
  const done = progress?.done ?? initialDone;
  const liveStatus =
    (progress?.genStatus as "generating" | "failed" | "ready" | "paused" | undefined) ?? undefined;
  // 优先服务端最新态 → 本地乐观态 → 初始态。
  const status = liveStatus ?? statusOverride ?? initialStatus;

  async function onResume() {
    if (resuming) return;
    setResuming(true);
    track("gen_resume_click", { course_id: courseId, source: "me_courses" });
    const r = await resumeGen(courseId);
    setResuming(false);
    if (r.ok) {
      setStatusOverride("generating");
      toast("已继续生成，可在此查看进度", { tone: "success" });
    } else if (r.status === 402) {
      toast("AI 造课需订阅后使用", { tone: "warn" });
    } else if (r.status === 409) {
      // 已在跑 / 无需续 —— 温和提示，视为已在进行。
      setStatusOverride("generating");
      toast(r.error || "该课程正在生成中", { tone: "info" });
    } else {
      toast(r.error || "续跑失败，请稍后再试", { tone: "warn" });
    }
  }

  // ready（轮询期间刚好完成）：收敛为就绪提示，不再显示环。
  if (status === "ready") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-1.5 text-[12px] font-semibold text-[var(--ink2)]">
        就绪 · {total} 节
      </span>
    );
  }

  // failed / paused 同为「已停下、可续造」终态：都渲染「继续生成」按钮（文案随态而变）。
  const canResume = status === "failed" || status === "paused";

  return (
    <div className="flex items-center gap-2.5">
      <ProgressRing done={done} total={total} size={38} stroke={4} />
      {canResume ? (
        <button
          type="button"
          onClick={onResume}
          disabled={resuming}
          className="studio-press inline-flex items-center gap-1.5 rounded-[10px] bg-[var(--red)] px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors duration-150 hover:bg-[var(--red-hover)] disabled:opacity-60"
        >
          {resuming ? <Spinner size={12} /> : <ArrowClockwise size={13} weight="bold" />}
          {resuming ? "续跑中" : status === "paused" ? "继续生产" : "继续生成"}
        </button>
      ) : (
        <Link
          href="/create"
          onClick={() => track("gen_view_progress_click", { course_id: courseId, source: "me_courses" })}
          className="studio-press inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--red-ink)] transition-colors duration-150 hover:brightness-[0.98]"
        >
          查看进度
          <ArrowRight size={13} weight="bold" />
        </Link>
      )}
    </div>
  );
}
