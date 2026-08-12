import { describe, expect, it } from "vitest";
import {
  assessmentNeedForLesson,
  contentBriefPrompt,
  createCourseContentBrief,
  readCourseContentBrief,
  serializeCourseContentBrief,
  withConfirmedCourseOutline,
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

  it("检查点大纲成为后续导演与作者的优先执行真值", () => {
    const original = createCourseContentBrief({
      request: "学习 Python 装饰器",
      plan: { capstone: "实现一个 Python 权限装饰器" },
    });
    const updated = withConfirmedCourseOutline(original, [
      { title: "JS 闭包", summary: "能解释词法作用域" },
      { title: "闭包实战", summary: "实现一个状态封装器" },
    ]);
    const prompt = contentBriefPrompt(updated);
    expect(prompt).toContain("用户确认的执行大纲");
    expect(prompt).toContain("JS 闭包");
    expect(prompt).toContain("以用户确认大纲为准");
    expect(assessmentNeedForLesson(updated, { title: "闭包实战", index: 1 })).toBe("adaptive");
  });

  it("保留旧 job/title 回填的非用户 provenance，防止后续把日期洗白", () => {
    const legacy = createCourseContentBrief({
      request: "截至 2026-08-12 的历史价格课",
      requestProvenance: "legacy_job",
    });
    expect(readCourseContentBrief(serializeCourseContentBrief(legacy))?.requestProvenance).toBe("legacy_job");
    expect(withConfirmedCourseOutline(legacy, [{ title: "计费", summary: "费率" }]).requestProvenance).toBe("legacy_job");
  });
});
