import { randomUUID } from "node:crypto";
import { slugifyCourse } from "./course-gen";

export interface CreatorTemplateLesson {
  title: string;
  summary: string | null;
  blockTypes: string[];
}

export interface CreatorTemplateSnapshot {
  v: 1;
  course: {
    title: string;
    description: string | null;
    category: string;
    level: string;
    blueprintJson: string | null;
    contentBriefJson: string | null;
  };
  lessons: CreatorTemplateLesson[];
}

export function cleanLibraryText(value: unknown, max: number): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

export function creatorLibrarySlug(name: string): string {
  return `${slugifyCourse(name) || "creator-item"}-${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

export function parseTemplateSnapshot(json: string): CreatorTemplateSnapshot | null {
  try {
    const raw = JSON.parse(json) as Partial<CreatorTemplateSnapshot>;
    if (raw.v !== 1 || !raw.course || !Array.isArray(raw.lessons)) return null;
    const title = cleanLibraryText(raw.course.title, 120);
    const category = cleanLibraryText(raw.course.category, 60);
    const level = cleanLibraryText(raw.course.level, 20);
    if (!title || !category || !level || raw.lessons.length < 1 || raw.lessons.length > 100) return null;
    const lessons = raw.lessons.map((lesson) => ({
      title: cleanLibraryText(lesson?.title, 120),
      summary: cleanLibraryText(lesson?.summary, 400) || null,
      blockTypes: Array.isArray(lesson?.blockTypes)
        ? [...new Set(lesson.blockTypes.map((type) => cleanLibraryText(type, 40)).filter(Boolean))].slice(0, 40)
        : [],
    }));
    if (lessons.some((lesson) => !lesson.title)) return null;
    return {
      v: 1,
      course: {
        title,
        description: cleanLibraryText(raw.course.description, 1200) || null,
        category,
        level,
        blueprintJson: typeof raw.course.blueprintJson === "string" ? raw.course.blueprintJson.slice(0, 100_000) : null,
        contentBriefJson: typeof raw.course.contentBriefJson === "string" ? raw.course.contentBriefJson.slice(0, 100_000) : null,
      },
      lessons,
    };
  } catch {
    return null;
  }
}

/** 把保存的块型轮廓还原为可编辑的合法占位块；只克隆结构，不复制原课程事实内容。 */
export function templateSkeletonBlocks(blockTypes: string[], lessonTitle: string): Record<string, unknown>[] {
  return blockTypes.slice(0, 60).flatMap<Record<string, unknown>>((type, index) => {
    const id = `tpl_${index}`;
    switch (type) {
      case "scene": return [{ id, type, title: lessonTitle, markdown: "填写本节的具体学习场景。" }];
      case "objectives": return [{ id, type, items: ["填写一项可验证的学习成果"] }];
      case "concept": return [{ id, type, title: "待填写概念", markdown: "填写准确解释、边界和判断方法。" }];
      case "example": return [{ id, type, markdown: "填写一个具体、可核验的例子。" }];
      case "steps": return [{ id, type, steps: [{ title: "第一步", detail: "填写可执行说明。" }] }];
      case "compare": return [{ id, type, title: "待填写对照", left: { heading: "一侧", items: ["填写要点"] }, right: { heading: "另一侧", items: ["填写要点"] } }];
      case "dialog": return [{ id, type, turns: [{ speaker: "A", text: "填写对话。" }, { speaker: "B", text: "填写回应。" }] }];
      case "code": return [{ id, type, lang: "text", code: "# 填写代码或命令" }];
      case "keypoint": return [{ id, type, points: ["填写关键要点"] }];
      case "callout": return [{ id, type, tone: "info", markdown: "填写提示或风险。" }];
      case "quiz": return [{ id, type, question: "填写检验题", options: ["正确选项", "干扰选项"], answerIndex: 0, explain: "填写每个选项的判断依据。" }];
      case "flashcard": return [{ id, type, front: "填写回忆问题", back: "填写答案" }];
      case "summary": return [{ id, type, markdown: "填写由本节内容自然形成的收束。" }];
      case "image": return [{ id, type, src: "/lesson-stills/lesson-still-ai.jpg", alt: "待替换课程图片" }];
      case "formula": return [{ id, type, latex: "x = y", display: true, caption: "填写公式说明" }];
      case "fillblank": return [{ id, type, prompt: "填写答案", segments: ["", ""], blanks: [["答案"]] }];
      case "dragwords": return [{ id, type, prompt: "选择正确词语", segments: ["", ""], blanks: ["答案"] }];
      case "diagram": return [{ id, type, kind: "flow", title: "待填写关系图", items: [{ label: "起点" }, { label: "结果" }] }];
      case "choice": return [{ id, type, prompt: "填写学习选择", choices: [{ label: "路径一" }, { label: "路径二" }] }];
      case "hotspot": return [{ id, type, imageSrc: "/lesson-stills/lesson-still-ai.jpg", prompt: "填写热点任务", spots: [{ x: 50, y: 50, label: "热点" }] }];
      // branch 需要真实目标课节 id，模板实例化前无法安全绑定；先还原为可编辑 choice，作者在路径图中补目标。
      case "branch": return [{ id, type: "choice", prompt: "为这处分支选择目标课节", choices: [{ label: "路径一" }, { label: "路径二" }] }];
      default: return [];
    }
  });
}
