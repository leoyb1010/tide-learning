import { describe, expect, it } from "vitest";
import { parseTemplateSnapshot, templateSkeletonBlocks } from "@/lib/creator-library";
import { validateBlocks } from "@/lib/blocks";

describe("creator template library", () => {
  it("round-trips a structure snapshot without copying arbitrary fields", () => {
    const snapshot = parseTemplateSnapshot(JSON.stringify({
      v: 1,
      course: { title: "课程", description: "说明", category: "ai_skill", level: "L1", blueprintJson: null, contentBriefJson: null, ignored: "x" },
      lessons: [{ title: "第一节", summary: "目标", blockTypes: ["scene", "quiz", "scene"] }],
    }));
    expect(snapshot?.lessons[0].blockTypes).toEqual(["scene", "quiz"]);
    expect(snapshot?.course).not.toHaveProperty("ignored");
  });

  it("recreates saved block contours as valid editable skeletons", () => {
    const skeleton = templateSkeletonBlocks(["scene", "concept", "quiz", "branch", "hotspot"], "第一节");
    const checked = validateBlocks(skeleton);
    expect(checked.map((block) => block.type)).toEqual(["scene", "concept", "quiz", "choice", "hotspot"]);
  });
});
