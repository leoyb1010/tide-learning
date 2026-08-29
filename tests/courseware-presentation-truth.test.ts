import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildContract } from "@/lib/ai/courseware-html";
import { isCurrentStoredCourseware } from "@/lib/courseware-publication";

const source = (path: string) => readFileSync(path, "utf8");

describe("课件表现层真值标签", () => {
  it("HtmlCourseware 按真实渲染引擎标注，不再无条件冒充精品", () => {
    const htmlCourseware = source("src/components/HtmlCourseware.tsx");
    expect(htmlCourseware).toContain('renderEngine === "llm"');
    expect(htmlCourseware).toContain('"\u539f\u521b\u8bfe\u4ef6"');
    expect(htmlCourseware).toContain('renderEngine === "deterministic"');
    expect(htmlCourseware).toContain('"\u5b89\u5168\u57fa\u7840\u6392\u7248"');
    expect(htmlCourseware).toContain('"\u4e92\u52a8\u8bfe\u4ef6"');
    expect(htmlCourseware).not.toContain("精品课件");
  });

  it("学习页查询与 Player 完整透传 renderEngine", () => {
    const queries = source("src/lib/queries.ts");
    const player = source("src/components/Player.tsx");
    expect(queries).toContain("renderEngine: true");
    expect(queries).toContain("hasHtmlCourseware");
    expect(queries).toContain("renderEngine: hasHtmlCourseware ? lesson.renderEngine : null");
    expect(queries).not.toContain("htmlJson: access ? lesson.htmlJson : null");
    expect(player).toContain("renderEngine?: string | null");
    expect(player).toContain("hasHtmlCourseware?: boolean");
    expect(player).toContain("renderEngine={lesson.renderEngine}");
  });

  it("免登录预览也查询并透传引擎，元数据使用中性描述", () => {
    const preview = source("src/app/courses/[id]/preview/page.tsx");
    expect(preview).toContain("isCurrentStoredCourseware(lesson, course)");
    expect(preview).toContain("renderEngine={lesson.renderEngine}");
    expect(preview).not.toContain("html={html}");
    expect(preview).toContain("互动课件试读");
    expect(preview).not.toContain("精品课件试读");
  });

  it("单节 HTML 必须等整课表现层 settle 为 ready 后才可发布", () => {
    const publication = source("src/lib/courseware-publication.ts");
    const route = source("src/app/api/lessons/[id]/courseware/route.ts");
    const preview = source("src/app/courses/[id]/preview/page.tsx");
    expect(publication).toContain('course.genStatus !== null && course.genStatus !== "ready"');
    expect(route).toContain("genStatus: true");
    expect(preview).toContain("genStatus: true");

    const lesson = {
      title: "忠实导入章节",
      summary: null,
      sortOrder: 0,
      blocksJson: null,
      htmlJson: JSON.stringify(buildContract("<!doctype html><html><body>课件</body></html>")),
      renderSourceHash: null,
      renderEngine: "faithful_import",
      designJson: null,
    };
    const course = { id: "course", title: "课程", genStatus: "failed", category: "ai_skill", template: null, designJson: null };
    expect(isCurrentStoredCourseware(lesson, course)).toBe(false);
    expect(isCurrentStoredCourseware(lesson, { ...course, genStatus: "ready" })).toBe(true);
    expect(isCurrentStoredCourseware(lesson, { ...course, genStatus: null })).toBe(true);
  });

  it("课件 HTML 禁止 CDN 变换注入，避免第三方 beacon 撞上 iframe CSP", () => {
    const route = source("src/app/api/lessons/[id]/courseware/route.ts");
    expect(route).toContain('"cache-control": "private, no-store, no-transform"');
  });
});
