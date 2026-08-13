import { createHash } from "node:crypto";
import { renderSourceHash } from "./ai/courseware-gen";
import { resolveCourseDesign } from "./ai/courseware-design";
import { resolveCoursewareMode } from "./ai/courseware-catalog";

export interface CoursewarePublicationCourse {
  id: string;
  title: string;
  genStatus: string | null;
  category?: string | null;
  template?: string | null;
  designJson?: string | null;
}

export interface CoursewarePublicationLesson {
  title: string;
  summary?: string | null;
  sortOrder?: number | null;
  blocksJson: string | null;
  htmlJson: string | null;
  renderSourceHash: string | null;
  renderEngine: string | null;
  designJson?: string | null;
}

/** 存储契约必须自校验；仅有一段 html 字符串不构成可交付课件。 */
export function validStoredCoursewareContract(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const contract = JSON.parse(value) as Record<string, unknown>;
    if (contract.renderMode !== "sandbox_srcdoc" || contract.contractVersion !== 2 ||
      typeof contract.html !== "string" || contract.html.length === 0 ||
      typeof contract.checksum !== "string" || !/^sha256:[a-f0-9]{64}$/.test(contract.checksum)) return false;
    const expected = `sha256:${createHash("sha256").update(contract.html, "utf8").digest("hex")}`;
    return contract.checksum === expected;
  } catch {
    return false;
  }
}

/**
 * 所有读取入口共用的 current-courseware 真值门。普通生成课件必须同时满足：
 * 合法 contract、当前 blocks/标题/目标/顺序/设计的 sourceHash、受支持引擎。
 * faithful_import 是不可重建原件，只验证自身 checksum，不套普通 renderer hash。
 */
export function isCurrentStoredCourseware(
  lesson: CoursewarePublicationLesson,
  course: CoursewarePublicationCourse,
): boolean {
  // 表现层 mutation 会先把课程降为 failed，再逐节写 HTML，最后一次性 settle 为 ready。
  // 任一读取入口若只看单节 hash，会在 store→settle 窗口暴露未完整交付的新课件。
  // 历史 official/user_created 课程 genStatus 为 null，保留其既有人工发布语义；一旦进入生成状态机就必须 ready。
  if (course.genStatus !== null && course.genStatus !== "ready") return false;
  if (!validStoredCoursewareContract(lesson.htmlJson)) return false;
  if (lesson.renderEngine === "faithful_import") return true;
  if (lesson.renderEngine !== "llm" && lesson.renderEngine !== "deterministic") return false;
  if (!lesson.blocksJson || !lesson.renderSourceHash) return false;
  const design = resolveCourseDesign(course);
  const mode = resolveCoursewareMode({
    title: course.title,
    template: course.template,
    artKey: design.art.key,
    layout: design.art.layout,
  });
  return lesson.renderSourceHash === renderSourceHash({
    blocksJson: lesson.blocksJson,
    title: lesson.title,
    summary: lesson.summary,
    sortOrder: lesson.sortOrder,
    design,
    lessonDesignJson: lesson.designJson,
    mode,
  });
}
