export type PresentationStatus = "pending" | "incomplete" | "degraded" | "premium";

/** 将服务端动态表现层审计结果收敛为稳定的前端契约。 */
export function resolvePresentationStatus(
  genStatus: string | null | undefined,
  presentation: { status: "incomplete" | "degraded" | "ready"; degraded: boolean },
): PresentationStatus {
  if (genStatus !== "ready") return "pending";
  if (presentation.status === "degraded" || presentation.degraded) return "degraded";
  if (presentation.status === "ready") return "premium";
  return "incomplete";
}

/** gen-progress 返回体（与 /api/courses/:id/gen-progress 对齐）。 */
export interface ClientGenProgress {
  total: number;
  done: number;
  failed: number;
  currentLessonId: string | null;
  genStatus: string | null;
  presentationStatus: PresentationStatus;
  presentation: {
    degraded: boolean;
    ready: number;
    total: number;
    premiumRenderCount: number;
    deterministicRenderCount: number;
  };
  lessons: { id: string; title: string; ready: boolean }[];
}

/**
 * 整课成功必须同时满足课级终态与逐节真值。
 * 如果状态快照与课节数据分叉，宁可显示待处理，也不能误报成功。
 */
export function isGenerationComplete(progress: ClientGenProgress | null | undefined): boolean {
  if (!progress || progress.genStatus !== "ready") return false;
  if (progress.presentationStatus !== "premium" && progress.presentationStatus !== "degraded") return false;
  if (!Number.isInteger(progress.total) || progress.total <= 0) return false;
  if (progress.done !== progress.total) return false;
  if (!Array.isArray(progress.lessons)) return false;
  return progress.lessons.length === progress.total && progress.lessons.every((lesson) => lesson.ready);
}

/** 内容与发布真值完整，但存在确定性安全排版的可学习成稿。 */
export function isDegradedPresentation(progress: ClientGenProgress | null | undefined): boolean {
  return isGenerationComplete(progress) && progress?.presentationStatus === "degraded";
}

/** ready 字面与逐节真值不一致时，按失败待处理展示。 */
export function generationNeedsAttention(progress: ClientGenProgress | null | undefined): boolean {
  if (!progress) return false;
  return progress.genStatus === "failed" || (progress.genStatus === "ready" && !isGenerationComplete(progress));
}

/** 后端当前定义的四种非运行态；未知值不自作主张地当成已完成。 */
export function isTerminalGenStatus(status: string | null | undefined): boolean {
  return status === "ready" || status === "failed" || status === "paused" || status === "outline_draft";
}
