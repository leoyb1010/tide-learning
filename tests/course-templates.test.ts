import { describe, it, expect } from "vitest";
import {
  COURSE_TEMPLATES,
  getTemplate,
  isValidTemplate,
  templateHardRequirement,
  checkTemplateAdherence,
} from "@/lib/ai/templates";
import { coursewareThemeAttr, COURSEWARE_THEMES } from "@/lib/ai/themes";

/**
 * v6 创作方向兼容层：只保留非约束的叙事倾向与主题解析。
 * 防止旧模板重新向内容链注入固定章节骨架、块配方或发布门槛。
 */

describe("模板注册表基本约束", () => {
  it("八个兼容创作方向齐全，且不携带固定块配方", () => {
    expect(COURSE_TEMPLATES).toHaveLength(8);
    for (const t of COURSE_TEMPLATES) {
      expect(t.temperature).toBeGreaterThan(0);
      expect(t.temperature).toBeLessThanOrEqual(1);
      expect("lessonRecipe" in t).toBe(false);
      expect("mustInclude" in t).toBe(false);
    }
  });

  it("非法/空 key 回落 classic；合法 key 精确命中", () => {
    expect(getTemplate("story").key).toBe("story");
    expect(getTemplate("不存在").key).toBe("classic");
    expect(getTemplate(null).key).toBe("classic");
    expect(isValidTemplate("workshop")).toBe(true);
    expect(isValidTemplate("nope")).toBe(false);
    expect(isValidTemplate(null)).toBe(true); // 空视为合法（用默认）
  });
});

describe("templateHardRequirement —— v6 不再注入固定块要求", () => {
  it("每个创作方向的硬性要求都为空", () => {
    for (const t of COURSE_TEMPLATES) {
      expect(templateHardRequirement(t.key)).toBe("");
    }
  });
});

describe("checkTemplateAdherence —— 不再把风格当发布门", () => {
  it("任意结构和空结构都不会因创作方向被判不合格", () => {
    expect(checkTemplateAdherence([{ type: "dialog" }], "story")).toEqual({ ok: true, missing: [] });
    expect(checkTemplateAdherence([], "exam_sprint")).toEqual({ ok: true, missing: [] });
  });
});

describe("coursewareThemeAttr —— 主题解析（渲染层换肤入口）", () => {
  it("合法 template key → 原样返回（= data-ct-theme 值）", () => {
    expect(coursewareThemeAttr("story")).toBe("story");
    expect(coursewareThemeAttr("exam_sprint")).toBe("exam_sprint");
  });

  it("空 / 未知 → undefined（旧课回落默认皮肤，无 data-ct-theme）", () => {
    expect(coursewareThemeAttr(null)).toBeUndefined();
    expect(coursewareThemeAttr(undefined)).toBeUndefined();
    expect(coursewareThemeAttr("")).toBeUndefined();
    expect(coursewareThemeAttr("mystery")).toBeUndefined();
  });

  it("主题表与模板表一一对应（key 集合相等）", () => {
    const themeKeys = COURSEWARE_THEMES.map((t) => t.key).sort();
    const templateKeys = COURSE_TEMPLATES.map((t) => t.key).sort();
    expect(themeKeys).toEqual(templateKeys);
  });
});
