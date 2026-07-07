import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * AI 生成任务兜底对账（P1-4 回归）。
 *
 * 审计发现：GenerationJob.status=running 但对应 Course.genStatus 已非 "generating" 时，
 * 所有自愈路径都扫不到，job 永久卡 running。修复：reconcileStaleGenJobs 直接扫 running job、
 * 按心跳判僵尸、以 lesson 就绪度收敛（ready/failed），不依赖 course.genStatus。
 *
 * course-gen.ts 顶层 import 了 db 等；只测对账/僵尸判定，mock 掉 db 用 stub 驱动。
 */

const prismaMock = vi.hoisted(() => ({
  generationJob: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  lesson: { count: vi.fn() },
  course: { updateMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { isGenJobStale, reconcileStaleGenJobs, GEN_JOB_STALE_MS } from "@/lib/course-gen";

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000);
const isoMinsAgo = (m: number) => minsAgo(m).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  // finalizeGenJob → getGenJob(resultRef) 用 findFirst；返回一条可解析进度的 job。
  prismaMock.generationJob.findFirst.mockResolvedValue({ id: "job_1", inputJson: JSON.stringify({ total: 6, done: 6 }) });
  prismaMock.generationJob.update.mockResolvedValue({});
  prismaMock.course.updateMany.mockResolvedValue({ count: 1 });
});

describe("isGenJobStale —— 心跳僵尸判定", () => {
  it("心跳新鲜（刚刷新）→ 不僵尸", () => {
    expect(isGenJobStale({ createdAt: minsAgo(60), inputJson: JSON.stringify({ heartbeatAt: isoMinsAgo(0) }) })).toBe(false);
  });

  it("心跳超过 15 分钟 → 僵尸", () => {
    expect(isGenJobStale({ createdAt: minsAgo(60), inputJson: JSON.stringify({ heartbeatAt: isoMinsAgo(20) }) })).toBe(true);
  });

  it("无可解析心跳：退回 createdAt，并给 2× 宽限（刚建的不误杀）", () => {
    // createdAt 10 分钟前、无心跳：staleMs=30min，未过 → 不僵尸（避免误杀刚建 job）
    expect(isGenJobStale({ createdAt: minsAgo(10), inputJson: null })).toBe(false);
    // createdAt 40 分钟前、无心跳：超过 30min 宽限 → 僵尸
    expect(isGenJobStale({ createdAt: minsAgo(40), inputJson: "{}" })).toBe(true);
  });

  it("GEN_JOB_STALE_MS 为 15 分钟", () => {
    expect(GEN_JOB_STALE_MS).toBe(15 * 60_000);
  });
});

describe("reconcileStaleGenJobs —— 直接扫 running job 收敛", () => {
  it("僵尸 + 全部就绪 → course.genStatus=ready，job=done", async () => {
    prismaMock.generationJob.findMany.mockResolvedValue([
      { id: "job_1", resultRef: "course_1", createdAt: minsAgo(60), inputJson: JSON.stringify({ heartbeatAt: isoMinsAgo(30) }) },
    ]);
    prismaMock.lesson.count.mockResolvedValueOnce(6).mockResolvedValueOnce(0); // total=6, remaining=0

    const res = await reconcileStaleGenJobs();
    expect(res.reconciled).toBe(1);
    expect(prismaMock.course.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "course_1" }, data: { genStatus: "ready" } }),
    );
    expect(prismaMock.generationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "done" }) }),
    );
  });

  it("僵尸 + 仍有空节 → course.genStatus=failed，job=failed（露出继续生成入口）", async () => {
    prismaMock.generationJob.findMany.mockResolvedValue([
      { id: "job_1", resultRef: "course_1", createdAt: minsAgo(60), inputJson: JSON.stringify({ heartbeatAt: isoMinsAgo(30) }) },
    ]);
    prismaMock.lesson.count.mockResolvedValueOnce(6).mockResolvedValueOnce(2); // total=6, remaining=2

    const res = await reconcileStaleGenJobs();
    expect(res.reconciled).toBe(1);
    expect(prismaMock.course.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "course_1" }, data: { genStatus: "failed" } }),
    );
    expect(prismaMock.generationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }),
    );
  });

  it("心跳新鲜的 running job 不被打断", async () => {
    prismaMock.generationJob.findMany.mockResolvedValue([
      { id: "job_live", resultRef: "course_live", createdAt: minsAgo(3), inputJson: JSON.stringify({ heartbeatAt: isoMinsAgo(0) }) },
    ]);
    const res = await reconcileStaleGenJobs();
    expect(res.reconciled).toBe(0);
    expect(prismaMock.course.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.generationJob.update).not.toHaveBeenCalled();
  });

  it("无 running job → 0 收敛，不写库", async () => {
    prismaMock.generationJob.findMany.mockResolvedValue([]);
    const res = await reconcileStaleGenJobs();
    expect(res.reconciled).toBe(0);
    expect(prismaMock.lesson.count).not.toHaveBeenCalled();
  });
});
