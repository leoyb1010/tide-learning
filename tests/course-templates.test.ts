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
 * v3.3 课件模板差异化：签名块硬性要求 + 遵循度机检 + 主题解析。
 * 覆盖「选了模板却生成得千篇一律」根治链路的纯函数层，锁死行为防回归。
 */

describe("模板注册表基本约束", () => {
  it("六个内置模板齐全，且每个都声明了 mustInclude / signature / temperature", () => {
    expect(COURSE_TEMPLATES).toHaveLength(6);
    for (const t of COURSE_TEMPLATES) {
      expect(typeof t.mustInclude).toBe("object");
      expect(typeof t.signature).toBe("string");
      expect(t.temperature).toBeGreaterThan(0);
      expect(t.temperature).toBeLessThanOrEqual(1);
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

describe("templateHardRequirement —— 签名块硬性要求注入", () => {
  it("story 明确要求 dialog 块，并带签名提醒", () => {
    const req = templateHardRequirement("story");
    expect(req).toContain("dialog");
    expect(req).toContain("必须包含");
    expect(req).toContain("签名块");
  });

  it("socratic 要求 ≥3 quiz", () => {
    const req = templateHardRequirement("socratic");
    expect(req).toContain("3");
    expect(req).toContain("quiz");
  });

  it("每个模板都产出非空硬性要求段（都至少有 signature）", () => {
    for (const t of COURSE_TEMPLATES) {
      expect(templateHardRequirement(t.key).length).toBeGreaterThan(0);
    }
  });
});

describe("checkTemplateAdherence —— 模板遵循度机检", () => {
  it("story 含 dialog → 达标；缺 dialog → 报缺失", () => {
    const withDialog = [{ type: "scene" }, { type: "dialog" }, { type: "summary" }];
    const noDialog = [{ type: "scene" }, { type: "concept" }, { type: "compare" }, { type: "summary" }];
    expect(checkTemplateAdherence(withDialog, "story").ok).toBe(true);
    const miss = checkTemplateAdherence(noDialog, "story");
    expect(miss.ok).toBe(false);
    expect(miss.missing.join()).toContain("dialog");
  });

  it("socratic 需 3 个 quiz：2 个不达标，3 个达标", () => {
    const two = [{ type: "quiz" }, { type: "quiz" }, { type: "summary" }];
    const three = [{ type: "quiz" }, { type: "quiz" }, { type: "quiz" }, { type: "summary" }];
    expect(checkTemplateAdherence(two, "socratic").ok).toBe(false);
    expect(checkTemplateAdherence(three, "socratic").ok).toBe(true);
  });

  it("exam_sprint 需 keypoint≥1 且 quiz≥3", () => {
    const blocks = [{ type: "keypoint" }, { type: "quiz" }, { type: "quiz" }, { type: "quiz" }];
    expect(checkTemplateAdherence(blocks, "exam_sprint").ok).toBe(true);
    const short = [{ type: "quiz" }, { type: "quiz" }, { type: "quiz" }]; // 缺 keypoint
    const r = checkTemplateAdherence(short, "exam_sprint");
    expect(r.ok).toBe(false);
    expect(r.missing.join()).toContain("keypoint");
  });

  it("classic（mustInclude 仅 example）：含 example 即达标", () => {
    expect(checkTemplateAdherence([{ type: "example" }], "classic").ok).toBe(true);
    expect(checkTemplateAdherence([{ type: "concept" }], "classic").ok).toBe(false);
  });

  it("空块数组：非空 mustInclude 的模板判不达标，不崩", () => {
    expect(checkTemplateAdherence([], "story").ok).toBe(false);
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
