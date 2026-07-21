import { describe, expect, it } from "vitest";
import { narrativePlanPrompt, validateNarrativePlan } from "@/lib/ai/lesson-narrative";

describe("自由教学导演方案", () => {
  it("接受不依赖固定模板的教学节拍", () => {
    const plan = validateNarrativePlan({
      teachingApproach: "从一份失败作品倒推判断标准",
      rationale: "本节目标是形成判断，不适合先讲定义",
      beats: [
        { purpose: "暴露直觉", technique: "先让学习者标出失败处", evidence: "真实失败样例" },
        { purpose: "形成判据", technique: "比较两个修改版本", evidence: "逐句差异" },
        { purpose: "迁移", technique: "修改一个新场景的作品", evidence: "可提交产物" },
      ],
      assessmentStrategy: "在比较后要求解释选择依据",
      transferTask: "独立修订一个新样例并说明取舍",
      avoid: ["先列学习目标", "固定总结页"],
    });
    expect(plan?.beats).toHaveLength(3);
    const prompt = narrativePlanPrompt(plan);
    expect(prompt).toContain("不规定块数量与固定首尾");
    expect(prompt).toContain("从一份失败作品倒推判断标准");
  });

  it("少于三个有效节拍时拒绝，不伪造默认模板", () => {
    expect(validateNarrativePlan({ teachingApproach: "讲", rationale: "理由", beats: [] })).toBeNull();
    expect(narrativePlanPrompt(null)).toContain("不要套固定");
  });
});
