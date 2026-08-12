import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ chatJson: vi.fn() }));
vi.mock("@/lib/llm", () => ({ chatJson: mocks.chatJson }));
vi.mock("@/lib/ai/models", () => ({
  selectBespokeModel: () => null,
  resolveModel: () => ({ key: "test-model" }),
  bespokeTimeoutMs: () => 1_000,
}));

import { buildCourseCoverageBatches, deterministicCourseCoverageIssues, judgeCourseCoverage } from "@/lib/ai/course-coverage-judge";
import { createCourseContentBrief, type AssessmentNeed } from "@/lib/ai/content-brief";
import { validateBlocks } from "@/lib/blocks";

function lesson(index: number, assessmentNeed: AssessmentNeed = "check") {
  return {
    id: `lesson_${index}`,
    title: `第 ${index + 1} 节`,
    objective: `完成能力 ${index + 1}`,
    assessmentNeed,
    blocks: validateBlocks([
      { type: "concept", title: `能力 ${index + 1}`, markdown: "证据".repeat(1_500) },
      { type: "quiz", question: `如何完成能力 ${index + 1}？`, options: ["错误", "正确"], answerIndex: 1, explain: "根据正文判断" },
    ]),
  };
}

describe("整课终审输入", () => {
  beforeEach(() => vi.clearAllMocks());

  it("长课程按完整课节分批，每批合法且不漏尾节", () => {
    const lessons = Array.from({ length: 24 }, (_, index) => lesson(index));
    const batches = buildCourseCoverageBatches(lessons, 8_000);
    const ids = batches.flatMap((batch) => (JSON.parse(batch) as { id: string }[]).map((row) => row.id));
    expect(batches.length).toBeGreaterThan(1);
    expect(ids).toEqual(lessons.map((item) => item.id));
    expect(ids.at(-1)).toBe("lesson_23");
  });

  it("capstone 没有 transfer 节点时确定性阻断", () => {
    const brief = createCourseContentBrief({ request: "做成作品", plan: { capstone: "提交完整作品" } });
    expect(deterministicCourseCoverageIssues(brief, [lesson(0, "check")])).toContain(
      "课程承诺综合成果任务，但整课检验地图没有 transfer 节点",
    );
  });

  it("none 参考节不因没有测验被阻断，practice 节缺检验会阻断", () => {
    const brief = createCourseContentBrief({ request: "建立术语索引" });
    const reference = { ...lesson(0, "none"), blocks: validateBlocks([{ type: "concept", title: "索引", markdown: "定义与边界" }]) };
    const practice = { ...lesson(1, "practice"), blocks: validateBlocks([{ type: "concept", title: "练习", markdown: "只有讲解" }]) };
    expect(deterministicCourseCoverageIssues(brief, [reference])).toEqual([]);
    expect(deterministicCourseCoverageIssues(brief, [reference, practice]).join("\n")).toContain("没有可判定检验");
  });

  it("无正确键的 choice/branch/hotspot 不能冒充可判定检验", () => {
    const brief = createCourseContentBrief({ request: "练习判断" });
    const blocks = validateBlocks([
      { type: "choice", prompt: "选择喜欢的颜色", choices: [{ label: "红" }, { label: "蓝" }] },
      { type: "branch", prompt: "选路径", options: [
        { label: "甲", targetLessonId: "lesson_a" }, { label: "乙", targetLessonId: "lesson_b" },
      ] },
      { type: "hotspot", imageSrc: "/covers/map.png", spots: [{ x: 10, y: 20, label: "任意位置" }] },
    ]);
    expect(deterministicCourseCoverageIssues(brief, [{ ...lesson(0, "practice"), blocks }]).join("\n"))
      .toContain("没有可判定检验");
  });

  it("分批评审发现目标未覆盖时，最终模型即使宣称可发布也必须阻断", async () => {
    mocks.chatJson
      .mockResolvedValueOnce({ lessons: [{ id: "lesson_0", objectiveCovered: false, assessmentAligned: true, issues: [] }] })
      .mockResolvedValueOnce({ publishable: true, coverage: 5, progression: 5, redundancy: 5, capstone: 5, issues: [], blockingIssues: [] });
    const verdict = await judgeCourseCoverage({
      courseTitle: "测试课",
      brief: createCourseContentBrief({ request: "掌握能力" }),
      lessons: [lesson(0)],
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.blockingIssues.join("\n")).toContain("目标没有被正文证据覆盖");
  });

  it("课程没有 capstone 承诺时不因 capstone 评分为 0 被误杀", async () => {
    mocks.chatJson
      .mockResolvedValueOnce({ lessons: [{ id: "lesson_0", objectiveCovered: true, assessmentAligned: true, issues: [] }] })
      .mockResolvedValueOnce({ publishable: true, coverage: 4, progression: 4, redundancy: 4, capstone: 0, issues: [], blockingIssues: [] });
    const verdict = await judgeCourseCoverage({
      courseTitle: "测试课",
      brief: createCourseContentBrief({ request: "掌握能力" }),
      lessons: [lesson(0)],
    });
    expect(verdict.passed).toBe(true);
  });
});
