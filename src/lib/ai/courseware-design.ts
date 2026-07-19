/**
 * 课级设计系统（v3.3 · HTML 课件）——「一门课一套视觉宪法」的单一真值源。
 *
 * 见桌面《多样化HTML课件生成工作流-详细计划》：课件千篇一律的根因是 14 种固定块 = 固定长相。
 * 解法之一是「课级锁一致、场景级给变化」：这里定义一批**互斥的艺术方向**（每套一整组 design token），
 * 按课程赛道软映射 + courseId 种子在候选里挑一个，得到本课的 CourseDesign。它连同 Variance 抽签
 * （courseware-variance.ts）一起，驱动 courseware-html.ts 把块内容渲染成 bespoke 的自包含 HTML 课件。
 *
 * 纯数据 + 纯函数：无 IO、无 "use client"、无随机源（用可复现种子），可 server/client/测试复用。
 * 关键：艺术方向之间**不混用**（一致性锁），保证一门课内不风格漂移；不同课/不同赛道天然分化。
 */

/** 一套艺术方向 = 一整组 design token（配色/字体/圆角/纹理/动效基调）。iframe 内自包含，故用固定方案，不跟随全站亮暗。 */
export interface ArtDirection {
  key: string;
  label: string;
  mood: string;
  /** 基底明暗，决定文字阶与遮罩方向。 */
  substrate: "light" | "dark";
  // —— 配色（全部给死值，保证 iframe 内自洽、对比达标）——
  bg: string;
  surface: string;
  surfaceAlt: string;
  ink: string;
  ink2: string;
  ink3: string;
  border: string;
  accent: string;
  accentInk: string; // 用于强调文字（在 bg 上可读）
  accentSoft: string; // 强调色的极浅底（卡片/胶囊）
  // —— 排版 ——
  fontDisplay: string; // 标题字族栈（自包含，用高质量系统栈，不引外链字体）
  fontBody: string;
  fontMono: string;
  displayWeight: number;
  displayTracking: string; // letter-spacing for headings
  // —— 形态 ——
  radius: number; // 基础圆角 px
  // —— 纹理（CSS background-image 值，铺在页底极淡层；"none" 表示无）——
  texture: string;
  // —— 动效基调 ——
  ease: string; // cubic-bezier
}

/**
 * 六套艺术方向。配色均自校验对比（正文 ink 对 surface ≥ 7:1，强调对 bg ≥ 4.5:1）。
 * 字体只用跨平台高质量系统栈（Apple 上 system-ui = SF Pro，衬线用 Georgia/Songti，等宽用 SF Mono），
 * 因为沙箱 CSP 禁外链、内联 web font 体积大，MVP 用系统栈换零依赖 + 稳定跨端（属有意取舍）。
 */
export const ART_DIRECTIONS: ArtDirection[] = [
  {
    key: "editorial_paper",
    label: "编辑纸刊",
    mood: "暖米纸感 + 衬线大标题 + 陶土红，像翻开一本高级杂志",
    substrate: "light",
    bg: "#f4efe4",
    surface: "#fbf8f1",
    surfaceAlt: "#efe8d8",
    ink: "#2a2620",
    ink2: "#5c554a",
    ink3: "#8a8173",
    border: "#e2d8c4",
    accent: "#b0472b",
    accentInk: "#8f371f",
    accentSoft: "#f6e4dc",
    fontDisplay: "Georgia, 'Songti SC', 'Noto Serif SC', 'Times New Roman', serif",
    fontBody: "system-ui, -apple-system, 'PingFang SC', 'Segoe UI', sans-serif",
    fontMono: "ui-monospace, 'SF Mono', Menlo, monospace",
    displayWeight: 700,
    displayTracking: "-0.02em",
    radius: 14,
    texture: "radial-gradient(circle at 1px 1px, rgba(120,100,70,.06) 1px, transparent 0)",
    ease: "cubic-bezier(0.16, 1, 0.3, 1)",
  },
  {
    key: "dark_tech",
    label: "深色科技",
    mood: "OLED 近黑 + 玻璃卡 + 冷青强调 + 网格，理科/AI 的高级暗场",
    substrate: "dark",
    bg: "#0a0c11",
    surface: "#12151d",
    surfaceAlt: "#171b25",
    ink: "#e9edf5",
    ink2: "#a6afc0",
    ink3: "#6f7a8d",
    border: "#232a37",
    accent: "#3fd0d8",
    accentInk: "#7fe4ea",
    accentSoft: "#0f2a2d",
    fontDisplay: "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', sans-serif",
    fontBody: "system-ui, -apple-system, 'PingFang SC', 'Segoe UI', sans-serif",
    fontMono: "ui-monospace, 'SF Mono', Menlo, monospace",
    displayWeight: 800,
    displayTracking: "-0.03em",
    radius: 16,
    texture:
      "linear-gradient(rgba(120,160,200,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(120,160,200,.045) 1px, transparent 1px)",
    ease: "cubic-bezier(0.32, 0.72, 0, 1)",
  },
  {
    key: "blueprint",
    label: "工程蓝图",
    mood: "冷青网格 + 等宽标题 + 蓝白，工具/实战的图纸感",
    substrate: "light",
    bg: "#eaf1f5",
    surface: "#f7fafc",
    surfaceAlt: "#dfeaf0",
    ink: "#0f2230",
    ink2: "#3a5464",
    ink3: "#6b8494",
    border: "#cadbe5",
    accent: "#0e7490",
    accentInk: "#0a5a72",
    accentSoft: "#d9edf3",
    fontDisplay: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace",
    fontBody: "system-ui, -apple-system, 'PingFang SC', sans-serif",
    fontMono: "ui-monospace, 'SF Mono', Menlo, monospace",
    displayWeight: 700,
    displayTracking: "-0.01em",
    radius: 6,
    texture:
      "linear-gradient(rgba(14,116,144,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(14,116,144,.08) 1px, transparent 1px)",
    ease: "cubic-bezier(0.16, 1, 0.3, 1)",
  },
  {
    key: "soft_structure",
    label: "银白柔构",
    mood: "银白底 + 超大无衬线 + 去饱和柔色 + 柔和环境阴影，克制高级",
    substrate: "light",
    bg: "#f1f2f4",
    surface: "#ffffff",
    surfaceAlt: "#e9ebef",
    ink: "#191b1f",
    ink2: "#565b64",
    ink3: "#878d97",
    border: "#e2e4e8",
    accent: "#5f6bb0",
    accentInk: "#4b5699",
    accentSoft: "#eceef7",
    fontDisplay: "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', sans-serif",
    fontBody: "system-ui, -apple-system, 'PingFang SC', sans-serif",
    fontMono: "ui-monospace, 'SF Mono', Menlo, monospace",
    displayWeight: 800,
    displayTracking: "-0.035em",
    radius: 20,
    texture: "none",
    ease: "cubic-bezier(0.16, 1, 0.3, 1)",
  },
  {
    key: "scoreboard",
    label: "冲刺计分",
    mood: "高对比暖白 + 警示红 + 等宽数字，备考/考点的紧凑高能",
    substrate: "light",
    bg: "#faf9f6",
    surface: "#ffffff",
    surfaceAlt: "#f1efe9",
    ink: "#161719",
    ink2: "#4f5157",
    ink3: "#82858c",
    border: "#e6e3db",
    accent: "#d5261d",
    accentInk: "#b01c15",
    accentSoft: "#fbe3e1",
    fontDisplay: "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', sans-serif",
    fontBody: "system-ui, -apple-system, 'PingFang SC', sans-serif",
    fontMono: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace",
    displayWeight: 800,
    displayTracking: "-0.02em",
    radius: 10,
    texture: "none",
    ease: "cubic-bezier(0.32, 0.72, 0, 1)",
  },
  {
    key: "storybook",
    label: "剧场绘本",
    mood: "柔紫幕布 + 大圆角 + 圆润字，口语/青少/银发的代入感",
    substrate: "light",
    bg: "#f7f1fb",
    surface: "#fdfbff",
    surfaceAlt: "#efe4f6",
    ink: "#2c2338",
    ink2: "#5b4f6b",
    ink3: "#8a7d9a",
    border: "#e7d9f0",
    accent: "#9333c7",
    accentInk: "#7a27a8",
    accentSoft: "#f1e3f9",
    fontDisplay: "'PingFang SC', system-ui, -apple-system, 'Segoe UI', sans-serif",
    fontBody: "'PingFang SC', system-ui, -apple-system, sans-serif",
    fontMono: "ui-monospace, 'SF Mono', Menlo, monospace",
    displayWeight: 700,
    displayTracking: "-0.01em",
    radius: 24,
    texture: "none",
    ease: "cubic-bezier(0.16, 1, 0.3, 1)",
  },
  // —— v3.5：参照开源课件模板库（20 源侦察）衍生的新方向，扩展视觉世界 ——
  {
    // 参照 vibe-slides 的 cinematic/neon/玻璃拟态；比 dark_tech 更戏剧化（电光紫、发光）。
    key: "cinematic_neon",
    label: "霓虹剧场",
    mood: "深空黑幕 + 电光紫 + 发光玻璃卡，产品发布会级的科技戏剧感",
    substrate: "dark",
    bg: "#07070d",
    surface: "#12121f",
    surfaceAlt: "#191a2c",
    ink: "#f0eefb",
    ink2: "#b2adcf",
    ink3: "#7d7899",
    border: "#2a2a44",
    accent: "#a06bff",
    accentInk: "#c4a3ff",
    accentSoft: "#1e1638",
    fontDisplay: "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', sans-serif",
    fontBody: "system-ui, -apple-system, 'PingFang SC', 'Segoe UI', sans-serif",
    fontMono: "ui-monospace, 'SF Mono', Menlo, monospace",
    displayWeight: 800,
    displayTracking: "-0.03em",
    radius: 18,
    texture: "radial-gradient(circle at 1px 1px, rgba(160,120,255,.08) 1px, transparent 0)",
    ease: "cubic-bezier(0.32, 0.72, 0, 1)",
  },
  {
    // 参照 slidev/reveal 的代码课件；GitHub 深色 + 等宽标题 + 终端绿，写给编程/技术课。
    key: "dev_terminal",
    label: "终端代码",
    mood: "GitHub 深色 + 等宽标题 + 终端绿，写给编程课/技术课的 IDE 质感",
    substrate: "dark",
    bg: "#0d1117",
    surface: "#161b22",
    surfaceAlt: "#1c2129",
    ink: "#e6edf3",
    ink2: "#adbac7",
    ink3: "#768390",
    border: "#30363d",
    accent: "#3fb950",
    accentInk: "#57c96a",
    accentSoft: "#12261a",
    fontDisplay: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace",
    fontBody: "system-ui, -apple-system, 'PingFang SC', 'Segoe UI', sans-serif",
    fontMono: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace",
    displayWeight: 700,
    displayTracking: "-0.01em",
    radius: 8,
    texture: "none",
    ease: "cubic-bezier(0.16, 1, 0.3, 1)",
  },
  {
    // 参照 remark 的极简讲义 + 学术课程站；象牙纸 + 深墨衬线 + 学院蓝，排版讲究的大学讲义。
    key: "academic_lecture",
    label: "学术讲义",
    mood: "象牙纸 + 深墨衬线 + 学院蓝，像一份排版讲究的大学讲义",
    substrate: "light",
    bg: "#f6f4ee",
    surface: "#fffdf8",
    surfaceAlt: "#eeebe1",
    ink: "#1e242e",
    ink2: "#4a5260",
    ink3: "#7a8290",
    border: "#ddd8c9",
    accent: "#2f5c8f",
    accentInk: "#244a75",
    accentSoft: "#e3ecf5",
    fontDisplay: "Georgia, 'Songti SC', 'Noto Serif SC', 'Times New Roman', serif",
    fontBody: "Georgia, 'Songti SC', 'Noto Serif SC', serif",
    fontMono: "ui-monospace, 'SF Mono', Menlo, monospace",
    displayWeight: 700,
    displayTracking: "-0.01em",
    radius: 8,
    texture: "radial-gradient(circle at 1px 1px, rgba(60,70,90,.045) 1px, transparent 0)",
    ease: "cubic-bezier(0.16, 1, 0.3, 1)",
  },
  {
    key: "magazine_bold",
    label: "大胆杂志",
    mood: "高对比奶油纸 + 巨型黑体 + 珊瑚红，适合观点鲜明的编辑专题",
    substrate: "light",
    bg: "#f5f0e8", surface: "#fffaf2", surfaceAlt: "#e9dfd1", ink: "#171412", ink2: "#514941", ink3: "#81776d",
    border: "#d9ccbd", accent: "#d94c32", accentInk: "#a93120", accentSoft: "#f6ddd6",
    fontDisplay: "system-ui, -apple-system, 'PingFang SC', sans-serif", fontBody: "Georgia, 'Songti SC', serif", fontMono: "ui-monospace, 'SF Mono', Menlo, monospace",
    displayWeight: 900, displayTracking: "-0.045em", radius: 4,
    texture: "linear-gradient(90deg, rgba(40,30,20,.035) 1px, transparent 1px)", ease: "cubic-bezier(0.16, 1, 0.3, 1)",
  },
  {
    key: "zen_mono",
    label: "禅意极简",
    mood: "雾白留白 + 墨灰细线 + 单一苔绿，安静而精确",
    substrate: "light",
    bg: "#f3f4ef", surface: "#fbfcf8", surfaceAlt: "#e9ece5", ink: "#20231f", ink2: "#555d53", ink3: "#858d82",
    border: "#d8ddd3", accent: "#58755b", accentInk: "#3f5d43", accentSoft: "#e2ebe2",
    fontDisplay: "Georgia, 'Songti SC', serif", fontBody: "system-ui, -apple-system, 'PingFang SC', sans-serif", fontMono: "ui-monospace, 'SF Mono', Menlo, monospace",
    displayWeight: 600, displayTracking: "-0.015em", radius: 2, texture: "none", ease: "cubic-bezier(0.16, 1, 0.3, 1)",
  },
  {
    key: "journal_washi",
    label: "和纸手账",
    mood: "暖和纸 + 胶带拼贴 + 靛青与朱砂，亲切但不幼稚",
    substrate: "light",
    bg: "#f4eddf", surface: "#fffaf0", surfaceAlt: "#ebe0ce", ink: "#2b2925", ink2: "#615b52", ink3: "#91877a",
    border: "#ddcfb9", accent: "#b74b3d", accentInk: "#91382e", accentSoft: "#f2dcd4",
    fontDisplay: "'Kaiti SC', 'Songti SC', Georgia, serif", fontBody: "system-ui, -apple-system, 'PingFang SC', sans-serif", fontMono: "ui-monospace, 'SF Mono', Menlo, monospace",
    displayWeight: 700, displayTracking: "-0.01em", radius: 12,
    texture: "radial-gradient(circle at 1px 1px, rgba(80,60,35,.055) 1px, transparent 0)", ease: "cubic-bezier(0.16, 1, 0.3, 1)",
  },
];

const ART_BY_KEY = new Map(ART_DIRECTIONS.map((a) => [a.key, a]));

/**
 * 赛道/模板 → 候选艺术方向（软映射：先按内容契合过滤，再在候选里按种子挑一个，兼顾契合与多样）。
 * category 见 tracks.ts；template 见 templates.ts。未命中用全体做候选。
 */
const CATEGORY_CANDIDATES: Record<string, string[]> = {
  ai_skill: ["dark_tech", "cinematic_neon", "soft_structure", "blueprint", "dev_terminal"],
  english_oral: ["storybook", "editorial_paper", "soft_structure"],
  english_foundation: ["academic_lecture", "editorial_paper", "soft_structure", "scoreboard"],
  silver_english: ["storybook", "soft_structure"],
  life: ["editorial_paper", "soft_structure", "storybook", "academic_lecture"],
};

const TEMPLATE_ART_CANDIDATES: Record<string, string[]> = {
  classic: ["editorial_paper", "academic_lecture", "zen_mono"],
  case_driven: ["magazine_bold", "editorial_paper", "blueprint"],
  story: ["storybook", "cinematic_neon", "journal_washi"],
  socratic: ["dark_tech", "academic_lecture", "zen_mono"],
  workshop: ["dev_terminal", "blueprint", "soft_structure"],
  exam_sprint: ["scoreboard", "academic_lecture", "magazine_bold"],
  language_immersion: ["storybook", "soft_structure", "journal_washi"],
  kids_bright: ["storybook", "journal_washi", "magazine_bold"],
};

/**
 * 内容信号路由（吸收 20 源侦察的「内容类型→课件风格」思想）：标题命中强信号时，
 * 直接路由到最契合的艺术方向（编程课→终端代码、讲义/精读→学术讲义）。优先级仅次于已落库 designJson。
 * 只在关键词明确时触发，避免误伤；未命中则回落模板提示/赛道候选。
 */
const CONTENT_HINTS: Array<{ art: string; re: RegExp }> = [
  { art: "dev_terminal", re: /编程|代码|程序|python|java(?:script)?|前端|后端|算法|开发者?|命令行|terminal|函数|接口|\bapi\b|\bsql\b|\bgit\b|debug|脚本|部署|数据库/i },
  { art: "academic_lecture", re: /讲义|精读|阅读理解|论文|学术|考研|雅思|托福|语法|文献|讲座|通识|读写|文言|古文/i },
];

function artKeyByContent(title?: string | null): string | undefined {
  if (!title) return undefined;
  for (const h of CONTENT_HINTS) if (h.re.test(title)) return h.art;
  return undefined;
}

/** 稳定字符串哈希（FNV-1a 32 位）—— 可复现种子源，避免 Math.random（保证同课稳定、跨课分化）。 */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 本课的最终设计系统（艺术方向 + 三旋钮）。designJson 落库即序列化此对象。 */
export interface CourseDesign {
  art: ArtDirection;
  /** 变化度 1-10：影响 Variance 抽样的发散程度。 */
  variance: number;
  /** 动效强度 1-10：影响入场/滚动动效数量与幅度。 */
  motion: number;
  /** 视觉密度 1-10：影响留白与每屏信息量。 */
  density: number;
}

/**
 * 赛道/模板 → 三旋钮基线（银发低动效低密度；科技/理科高变化高动效）。
 * 蓝图 A6：全赛道差异化——此前只特判 3 个赛道，其余全落 7/6/5，评估证实现库 designJson 数值三维死钉。
 */
function knobsFor(category: string | null | undefined): { variance: number; motion: number; density: number } {
  switch (category) {
    case "silver_english":
      return { variance: 4, motion: 3, density: 3 };
    case "ai_skill":
      return { variance: 8, motion: 7, density: 5 };
    case "english_oral":
      return { variance: 7, motion: 6, density: 4 };
    case "english_foundation":
      return { variance: 6, motion: 5, density: 6 }; // 备考向：信息密度高、动效克制
    case "life":
      return { variance: 5, motion: 4, density: 4 }; // 生活实用：冷静克制，不炫技
    case "user_imported":
      return { variance: 6, motion: 5, density: 5 }; // 导入课：素材主导，中性基线
    default:
      return { variance: 7, motion: 6, density: 5 };
  }
}

/** 蓝图 A6：按课 id 给旋钮 ±1 确定性抖动——同赛道不同课不再共享同一组数值（可复现，无随机源）。 */
function jitterKnob(name: string, courseId: string, base: number): number {
  return clampKnob(base + ((hashSeed(`knob:${name}:${courseId}`) % 3) - 1));
}

/**
 * 解析一门课的设计系统（确定性、可复现、对任意课都成立，含无 designJson 的旧课）。
 * 优先级：已落库的 designJson > 模板提示 > 赛道候选按 courseId 种子挑选。
 */
export function resolveCourseDesign(course: {
  id: string;
  category?: string | null;
  template?: string | null;
  designJson?: string | null;
  /** 课程标题：用于内容信号路由（编程课→终端、讲义→学术）。缺省则不参与路由。 */
  title?: string | null;
}): CourseDesign {
  // 已落库的设计系统直接用（造课时可由更强逻辑/LLM 生成后持久化）。
  if (course.designJson) {
    try {
      const parsed = JSON.parse(course.designJson) as { artKey?: string; variance?: number; motion?: number; density?: number };
      const art = parsed.artKey ? ART_BY_KEY.get(parsed.artKey) : undefined;
      if (art) {
        const k = knobsFor(course.category);
        return {
          art,
          variance: clampKnob(parsed.variance ?? k.variance),
          motion: clampKnob(parsed.motion ?? k.motion),
          density: clampKnob(parsed.density ?? k.density),
        };
      }
    } catch {
      /* 脏 designJson → 回落到下方推导 */
    }
  }

  // 内容信号路由优先（标题命中强信号→最契合方向），仅次于已落库 designJson。
  const contentArt = artKeyByContent(course.title);
  // 否则模板签名候选：同一模板仍可在一组相近视觉世界内确定性分化。
  const templateCandidates = course.template ? TEMPLATE_ART_CANDIDATES[course.template] : undefined;
  const templateArt = templateCandidates?.length
    ? ART_BY_KEY.get(templateCandidates[hashSeed(`template-art:${course.id}:${course.template}`) % templateCandidates.length])
    : undefined;
  let art = (contentArt && ART_BY_KEY.get(contentArt)) || templateArt;

  // 否则按赛道候选 + courseId 种子挑一个（软映射保契合，种子保多样）。
  if (!art) {
    const candidates = (course.category && CATEGORY_CANDIDATES[course.category]) || ART_DIRECTIONS.map((a) => a.key);
    const seed = hashSeed(`art:${course.id}`);
    const picked = candidates[seed % candidates.length];
    art = ART_BY_KEY.get(picked) ?? ART_DIRECTIONS[0];
  }

  const k = knobsFor(course.category);
  return {
    art,
    variance: jitterKnob("variance", course.id, k.variance),
    motion: jitterKnob("motion", course.id, k.motion),
    density: jitterKnob("density", course.id, k.density),
  };
}

function clampKnob(n: number): number {
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(10, Math.round(n)));
}

/** 序列化设计系统为可落库的 designJson（造课时持久化，之后渲染直接读，稳定不漂移）。 */
export function serializeCourseDesign(d: CourseDesign): string {
  return JSON.stringify({ artKey: d.art.key, variance: d.variance, motion: d.motion, density: d.density });
}

/** 取某艺术方向（未知 → 第一个）。供 UI/报表引用。 */
export function getArtDirection(key?: string | null): ArtDirection {
  return (key && ART_BY_KEY.get(key)) || ART_DIRECTIONS[0];
}
