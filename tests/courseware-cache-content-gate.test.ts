import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    lesson: { updateMany: dbMocks.updateMany },
  },
}));

import { buildContract } from "@/lib/ai/courseware-html";
import { resolveCoursewareMode } from "@/lib/ai/courseware-catalog";
import { resolveCourseDesign } from "@/lib/ai/courseware-design";
import { renderAndStoreLessonHtml, renderSourceHash } from "@/lib/ai/courseware-gen";

const course = {
  id: "content-gate-course",
  title: "闭包基础",
  category: "career",
  template: null,
  designJson: null,
};
const design = resolveCourseDesign(course);
const mode = resolveCoursewareMode({
  title: course.title,
  template: course.template,
  artKey: design.art.key,
  layout: design.art.layout,
});
const blocksJson = JSON.stringify({
  version: 1,
  blocks: [{ id: "concept-cache", type: "concept", title: "闭包", markdown: "闭包保留词法环境。" }],
});

function cachedLesson(html: string) {
  const base = {
    id: "content-gate-lesson",
    title: "闭包的作用",
    summary: "理解词法环境",
    sortOrder: 0,
    blocksJson,
    designJson: null,
  };
  return {
    ...base,
    htmlJson: JSON.stringify(buildContract(html)),
    renderEngine: "llm",
    renderSourceHash: renderSourceHash({ ...base, design, mode }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.updateMany.mockResolvedValue({ count: 0 });
});

describe("LLM courseware cache final content gate", () => {
  it("允许安全 LLM 缓存快返，不触发生成 claim", async () => {
    const lesson = cachedLesson(
      '<!doctype html><html><head><style>body::before{content:""}</style></head><body><h1>闭包</h1></body></html>',
    );

    await expect(renderAndStoreLessonHtml(course.id, lesson, design, mode, {
      enhance: true,
      userId: "content-gate-user",
      presentationRevision: 1,
      category: course.category,
    })).resolves.toMatchObject({ ok: true, engine: "llm", cacheHit: true });
    expect(dbMocks.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    '<!doctype html><html><head><style>body::before{content:"当前药价与用药建议"}</style></head><body><h1>闭包</h1></body></html>',
    '<!doctype html><html><body><img alt="Current stock investment advice"><h1>闭包</h1></body></html>',
  ])("拒绝历史缓存中的隐藏高风险内容，改走受控重建", async (html) => {
    const lesson = cachedLesson(html);

    await expect(renderAndStoreLessonHtml(course.id, lesson, design, mode, {
      enhance: true,
      userId: "content-gate-user",
      presentationRevision: 1,
      category: course.category,
    })).resolves.toMatchObject({ ok: true, engine: "none", contract: null });
    expect(dbMocks.updateMany).toHaveBeenCalledOnce();
  });
});
