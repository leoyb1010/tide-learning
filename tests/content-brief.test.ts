import { describe, expect, it } from "vitest";
import {
  contentBriefPrompt,
  createCourseContentBrief,
  readCourseContentBrief,
  serializeCourseContentBrief,
} from "@/lib/ai/content-brief";

describe("课程内容总纲", () => {
  it("保留原始需求、范围和成果任务供逐节复用", () => {
    const brief = createCourseContentBrief({
      request: "给有基础的产品经理做一门需求访谈课，重点练追问而不是背理论",
      plan: {
        learnerOutcome: "完成一场 20 分钟访谈并产出可验证洞察",
        scope: "问题设计、追问、证据整理",
        capstone: "提交访谈提纲与洞察记录",
        exclusions: ["统计学研究方法"],
      },
    });
    const restored = readCourseContentBrief(serializeCourseContentBrief(brief));
    expect(restored).toEqual(brief);
    const prompt = contentBriefPrompt(restored);
    expect(prompt).toContain("重点练追问");
    expect(prompt).toContain("统计学研究方法");
  });

  it("清理控制字符并限制异常长字段", () => {
    const brief = createCourseContentBrief({ request: `需求\n${"x".repeat(3000)}` });
    expect(brief.request.length).toBeLessThanOrEqual(2000);
    expect(brief.request).not.toContain("\n");
  });
});
