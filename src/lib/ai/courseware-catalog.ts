/**
 * 课件风格智能层（v3.5）—— 吸收 20 套开源 HTML 课件/演示模板项目侦察报告的「内容类型 → 呈现风格」体系。
 *
 * 见桌面《下一轮工作文档》与 Downloads/html-courseware-template-scout-20.md：不同内容类型（讲座/章节/编程/
 * 知识图谱/班课/测验）对应不同的最佳课件呈现「mode」。本模块把这套侦察知识落成产品的**风格路由底座**：
 * 造课 / 导入时先判内容类型 → 选 mode → mode 决定「艺术方向候选 + 页型偏好 + block 强调 + LLM 增强的风格指令」。
 *
 * 铁律：不引入任何外部框架/源码（CSP 不容外链 JS，且多为 GPL 无关）。这里只吸收「模式与选择逻辑」的思想，
 * 落成纯数据 + 纯函数，驱动我们自包含确定性的渲染器（courseware-html.ts）与可选的 LLM 增强（courseware-gen.ts）。
 */

import type { CourseDesign } from "./courseware-design";

/** 课件 mode = 一套「内容类型 → 呈现风格」档案（对应 scout 报告的风格标签体系）。 */
export type CoursewareMode =
  | "deck-horizontal" // 讲座/汇报：横向 PPT 式，大标题、分步揭示
  | "scroll-lesson" // 课程章节：滚动式自学长页
  | "sidebar-lesson" // 工作坊/导读：模块化步骤清单
  | "developer-training" // 编程/技术：代码课件、终端质感
  | "cinematic-tech" // AI/前沿/发布：深色霓虹、戏剧感
  | "editorial-academic" // 讲义/精读/学术：排版讲究、衬线、页边注
  | "course-dashboard" // 班课运营：大纲/周计划/进度
  | "spatial-concept-map" // 知识图谱：概念节点/连线/非线性
  | "interactive-quiz"; // 测验练习：随堂测/自评/检查点

export interface ModeProfile {
  mode: CoursewareMode;
  label: string;
  /** scout 报告的风格标签，供索引/检索。 */
  tags: string[];
  /** 艺术方向 key 候选（首个为默认偏好）。 */
  artCandidates: string[];
  /** 偏好页型（page archetype）。 */
  archetypeEmphasis: string[];
  /** 强调的内容 block 类型。 */
  blockEmphasis: string[];
  /** 注入 LLM 增强 prompt 的一句风格指令（模型据此产 bespoke HTML）。 */
  llmGuidance: string;
}

export const MODE_PROFILES: Record<CoursewareMode, ModeProfile> = {
  "deck-horizontal": {
    mode: "deck-horizontal",
    label: "横向讲义",
    tags: ["deck-horizontal", "single-file-artifact"],
    artCandidates: ["editorial_paper", "soft_structure", "cinematic_neon"],
    archetypeEmphasis: ["hero", "band", "plain"],
    blockEmphasis: ["scene", "concept", "keypoint", "summary"],
    llmGuidance: "像一套高级 PPT：每页一个主张，超大展示级标题 + 克制正文，分步揭示（逐块入场），页与页节奏分明。",
  },
  "scroll-lesson": {
    mode: "scroll-lesson",
    label: "滚动自学",
    tags: ["scroll-lesson"],
    artCandidates: ["soft_structure", "editorial_paper", "academic_lecture"],
    archetypeEmphasis: ["band", "surface", "figure", "plain"],
    blockEmphasis: ["concept", "example", "steps", "callout", "summary"],
    llmGuidance: "像 web-native 自学长页：清晰的 section 叙事流，锚点式小标题，长内容用卡片/色带分区，阅读节奏舒展。",
  },
  "sidebar-lesson": {
    mode: "sidebar-lesson",
    label: "模块导读",
    tags: ["sidebar-lesson", "scroll-lesson"],
    artCandidates: ["blueprint", "academic_lecture", "soft_structure"],
    archetypeEmphasis: ["figure", "surface", "band"],
    blockEmphasis: ["objectives", "steps", "keypoint", "code"],
    llmGuidance: "像文档式教学模块：本节目标置顶，步骤编号清单为主干，右上角落进度/章节标记，工整像一份工作坊讲义。",
  },
  "developer-training": {
    mode: "developer-training",
    label: "编程实训",
    tags: ["developer-training", "single-file-artifact"],
    artCandidates: ["dev_terminal", "dark_tech", "blueprint"],
    archetypeEmphasis: ["surface", "figure", "hero"],
    blockEmphasis: ["code", "steps", "example", "compare"],
    llmGuidance: "像 IDE/终端里的技术课：等宽标题、终端窗口镜框承载代码、命令与输出对照、步骤即「照着敲」，冷静专业。",
  },
  "cinematic-tech": {
    mode: "cinematic-tech",
    label: "科技剧场",
    tags: ["cinematic-tech"],
    artCandidates: ["cinematic_neon", "dark_tech"],
    archetypeEmphasis: ["hero", "band", "plain"],
    blockEmphasis: ["scene", "concept", "keypoint", "summary"],
    llmGuidance: "像产品发布会：深色幕布 + 电光强调 + 发光玻璃卡，巨型标题与大留白，情绪化开场与收束，戏剧但不廉价。",
  },
  "editorial-academic": {
    mode: "editorial-academic",
    label: "学术讲义",
    tags: ["editorial-academic"],
    artCandidates: ["academic_lecture", "editorial_paper"],
    archetypeEmphasis: ["plain", "surface", "figure"],
    blockEmphasis: ["concept", "example", "compare", "summary"],
    llmGuidance: "像排版讲究的大学讲义：衬线标题、页边栏与细分隔线、脚注/章节号气质，信息密度高但层级清晰，学术而不呆板。",
  },
  "course-dashboard": {
    mode: "course-dashboard",
    label: "课程仪表盘",
    tags: ["course-dashboard"],
    artCandidates: ["soft_structure", "blueprint", "editorial_paper"],
    archetypeEmphasis: ["surface", "figure", "band"],
    blockEmphasis: ["objectives", "steps", "keypoint"],
    llmGuidance: "像课程首页/大纲盘：模块卡片网格、进度与节奏可视，把「学什么、到哪一步」一眼呈现，克制的信息面板感。",
  },
  "spatial-concept-map": {
    mode: "spatial-concept-map",
    label: "概念图谱",
    tags: ["spatial-concept-map"],
    artCandidates: ["blueprint", "dark_tech", "soft_structure"],
    archetypeEmphasis: ["hero", "figure", "plain"],
    blockEmphasis: ["concept", "keypoint", "compare"],
    llmGuidance: "像系统/概念地图：用内联 SVG 画节点与连线，一核多象的空间布局，从总览到细节的缩放叙事（纯 SVG，无外部库）。",
  },
  "interactive-quiz": {
    mode: "interactive-quiz",
    label: "互动测验",
    tags: ["interactive-course"],
    artCandidates: ["scoreboard", "soft_structure", "storybook"],
    archetypeEmphasis: ["surface", "band", "figure"],
    blockEmphasis: ["quiz", "flashcard", "keypoint", "compare"],
    llmGuidance: "像检查点测验：随堂测/记忆卡为主，即时判分反馈明确，自评「检查你的理解」结构，练习感强、正反馈清晰。",
  },
};

const ART_TO_MODE: Record<string, CoursewareMode> = {
  dev_terminal: "developer-training",
  cinematic_neon: "cinematic-tech",
  academic_lecture: "editorial-academic",
  scoreboard: "interactive-quiz",
  storybook: "scroll-lesson",
  editorial_paper: "deck-horizontal",
  blueprint: "sidebar-lesson",
  dark_tech: "cinematic-tech",
  soft_structure: "scroll-lesson",
};

/** 内容类型 → mode 的标题启发式（对齐 scout 报告的路由表）。 */
const MODE_HINTS: Array<{ mode: CoursewareMode; re: RegExp }> = [
  { mode: "developer-training", re: /编程|代码|程序|python|java(?:script)?|前端|后端|算法|开发|命令行|函数|接口|\bapi\b|\bsql\b|\bgit\b|脚本|部署|数据库/i },
  { mode: "editorial-academic", re: /讲义|精读|论文|学术|考研|雅思|托福|语法|文献|讲座|通识|读写|文言|古文/i },
  { mode: "interactive-quiz", re: /测验|练习|自测|刷题|考点|冲刺|真题|模拟题/i },
  { mode: "course-dashboard", re: /大纲|周计划|课程表|路线图|训练营|班课|学习计划/i },
  { mode: "spatial-concept-map", re: /概念图|知识图谱|思维导图|体系|系统图|全景|框架/i },
  { mode: "cinematic-tech", re: /发布会|未来|趋势|前沿|大模型|aigc|黑科技|元宇宙/i },
];

const TEMPLATE_MODE: Record<string, CoursewareMode> = {
  workshop: "sidebar-lesson",
  socratic: "interactive-quiz",
  exam_sprint: "interactive-quiz",
  story: "scroll-lesson",
  case_driven: "editorial-academic",
  classic: "deck-horizontal",
};

/**
 * 解析一门课的课件 mode：标题强信号 > 已定艺术方向蕴含 > 课型模板 > 兜底 scroll-lesson。
 * 造课/导入两条链路都可调用（都能拿到 title/template/artKey）。
 */
export function resolveCoursewareMode(input: {
  title?: string | null;
  template?: string | null;
  artKey?: string | null;
}): CoursewareMode {
  // artKey 优先：艺术方向是已锁定的视觉决策（且它本身已吸收标题的内容信号），
  // 据它反推 mode，保证注入 LLM 的风格指令/范例与 art token 同源不矛盾（见审查 P2）。
  if (input.artKey && ART_TO_MODE[input.artKey]) return ART_TO_MODE[input.artKey];
  // 无已定 artKey（如独立调用）才用标题启发式。
  if (input.title) {
    for (const h of MODE_HINTS) if (h.re.test(input.title)) return h.mode;
  }
  if (input.template && TEMPLATE_MODE[input.template]) return TEMPLATE_MODE[input.template];
  return "scroll-lesson";
}

/** 取 mode 档案（未知 → scroll-lesson）。 */
export function getModeProfile(mode: CoursewareMode): ModeProfile {
  return MODE_PROFILES[mode] ?? MODE_PROFILES["scroll-lesson"];
}

/**
 * 给 LLM 增强路径拼一段「本课风格指令」：mode 的 llmGuidance + 页型词汇 + block 强调。
 * synthesizeViaLLM 注入此段，让模型的 bespoke HTML 贴合内容类型对应的呈现风格（而非千篇一律）。
 */
export function llmStyleBrief(design: CourseDesign, title?: string | null): string {
  const mode = resolveCoursewareMode({ title, artKey: design.art.key });
  const p = getModeProfile(mode);
  return (
    `【课件风格 mode：${p.label}（${p.mode}）】${p.llmGuidance}\n` +
    `- 页型节奏：优先用 ${p.archetypeEmphasis.join(" / ")} 等不同「整页构图」交替，避免每页都是纵向卡片堆叠。\n` +
    `- 内容侧重：突出 ${p.blockEmphasis.join(" / ")}。`
  );
}
