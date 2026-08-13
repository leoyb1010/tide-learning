import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  generationNeedsAttention,
  isDegradedPresentation,
  isGenerationComplete,
  isTerminalGenStatus,
  resolvePresentationStatus,
  type ClientGenProgress as GenProgress,
} from "@/lib/gen-progress-contract";

function progress(overrides: Partial<GenProgress> = {}): GenProgress {
  return {
    total: 2,
    done: 2,
    failed: 0,
    currentLessonId: null,
    genStatus: "ready",
    presentationStatus: "premium",
    presentation: {
      degraded: false,
      ready: 2,
      total: 2,
      premiumRenderCount: 2,
      deterministicRenderCount: 0,
    },
    lessons: [
      { id: "lesson-1", title: "第一节", ready: true },
      { id: "lesson-2", title: "第二节", ready: true },
    ],
    ...overrides,
  };
}

describe("创作台生成进度契约", () => {
  it("只在整课 ready 后对外公布 premium / degraded", () => {
    expect(resolvePresentationStatus("generating", { status: "ready", degraded: false })).toBe("pending");
    expect(resolvePresentationStatus("ready", { status: "incomplete", degraded: false })).toBe("incomplete");
    expect(resolvePresentationStatus("ready", { status: "degraded", degraded: true })).toBe("degraded");
    expect(resolvePresentationStatus("ready", { status: "ready", degraded: false })).toBe("premium");
  });

  it("只在课级 ready 与全部逐节真值一致时宣布成功", () => {
    expect(isGenerationComplete(progress())).toBe(true);

    expect(isGenerationComplete(progress({ done: 1 }))).toBe(false);
    // failed 是历史尝试计数，不是当前课程终态；重试后全节通过可仍大于 0。
    expect(isGenerationComplete(progress({ failed: 1 }))).toBe(true);
    expect(isGenerationComplete(progress({ lessons: [
      { id: "lesson-1", title: "第一节", ready: true },
      { id: "lesson-2", title: "第二节", ready: false },
    ] }))).toBe(false);
    expect(isGenerationComplete(progress({ lessons: [
      { id: "lesson-1", title: "第一节", ready: true },
    ] }))).toBe(false);
    expect(isGenerationComplete(progress({ total: 0, done: 0, lessons: [] }))).toBe(false);
    expect(isGenerationComplete(progress({ lessons: null as unknown as GenProgress["lessons"] }))).toBe(false);
  });

  it("failed / paused / outline_draft / 未知状态都不会被显示为成功", () => {
    for (const genStatus of ["failed", "paused", "outline_draft", "unexpected_state"]) {
      expect(isGenerationComplete(progress({ genStatus }))).toBe(false);
    }
    expect(generationNeedsAttention(progress({ genStatus: "failed" }))).toBe(true);
    expect(generationNeedsAttention(progress({ genStatus: "paused" }))).toBe(false);
    expect(generationNeedsAttention(progress({ genStatus: "outline_draft" }))).toBe(false);
  });

  it("ready 字面与 DB 课节真值分叉时按待处理显示", () => {
    expect(generationNeedsAttention(progress({ done: 1 }))).toBe(true);
    expect(generationNeedsAttention(progress({ lessons: [
      { id: "lesson-1", title: "第一节", ready: true },
      { id: "lesson-2", title: "第二节", ready: false },
    ] }))).toBe(true);
  });

  it("表现层 premium / degraded 都可完成，incomplete / pending 必须失败关闭", () => {
    expect(isGenerationComplete(progress({ presentationStatus: "premium" }))).toBe(true);

    const degraded = progress({
      presentationStatus: "degraded",
      presentation: {
        degraded: true,
        ready: 2,
        total: 2,
        premiumRenderCount: 1,
        deterministicRenderCount: 1,
      },
    });
    expect(isGenerationComplete(degraded)).toBe(true);
    expect(isDegradedPresentation(degraded)).toBe(true);
    expect(generationNeedsAttention(degraded)).toBe(false);

    expect(isGenerationComplete(progress({ presentationStatus: "incomplete" }))).toBe(false);
    expect(generationNeedsAttention(progress({ presentationStatus: "incomplete" }))).toBe(true);
    expect(isGenerationComplete(progress({ presentationStatus: "pending" }))).toBe(false);
  });

  it("降级完成页说明可学习与安全基础排版，不误报为全部精品课件", () => {
    const source = readFileSync("src/components/CreateStudio.tsx", "utf8");
    expect(source).toContain("内容质量已通过，部分章节使用安全基础排版，可稍后重渲染。");
    expect(source).toContain("isReady && !isPresentationDegraded ? courseHref : null");
    expect(source).not.toContain("全部精品原创");
  });

  it("只把后端已有的四种非运行态当作轮询终态", () => {
    expect(isTerminalGenStatus("ready")).toBe(true);
    expect(isTerminalGenStatus("failed")).toBe(true);
    expect(isTerminalGenStatus("paused")).toBe(true);
    expect(isTerminalGenStatus("outline_draft")).toBe(true);
    expect(isTerminalGenStatus("generating")).toBe(false);
    expect(isTerminalGenStatus("unexpected_state")).toBe(false);
  });

  it("初次造课不再包含前端逐节生成或视频扇出循环", () => {
    const source = readFileSync("src/components/CreateStudio.tsx", "utf8");
    expect(source).not.toContain("function writeLessons");
    expect(source).not.toContain("/api/ai/generate-video");
    expect(source).not.toContain("同时生成视频课件");
    // 检查点确认、初次造课、普通资料导入均交给同一个 DB 轮询剧场。
    expect(source.match(/setRecoverCourse\(course\)/g)).toHaveLength(3);
    // 唯一保留的路径是失败终态下的用户显式单节重试。
    expect(source.match(/\/api\/ai\/generate-lesson/g)).toHaveLength(1);
  });
});
