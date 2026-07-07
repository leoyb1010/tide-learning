/**
 * 课件视觉主题层（v3.3）—— 按 course.template 给块课件换「皮肤」，是「六模板看起来一样」的根治层。
 *
 * 背景：此前模板（templates.ts）只改「内容结构」（块的种类/顺序/数量），而播放器
 * （BlockRenderer / BlockSlideshow / 各块组件）永远用同一套 STUDIO 冷灰蓝视觉——所以无论选哪个
 * 模板、用哪个模型，播放出来都长一个样。本层补上缺失的「视觉」维度。
 *
 * 实现（零改块组件）：块组件本就全部消费设计 token（--red* / --surface* / --border* /
 * --radius-card* / --video-grad 等）。本层只在课件外层挂一个 data-ct-theme=<templateKey>，
 * globals.css 的 .ct-theme[data-ct-theme="..."] 作用域内覆盖一小组 token（强调色族、场景板渐变、
 * 圆角、标题字体、背景纹理），即整套课件换肤。亮/暗自适应：软色/墨色用 color-mix 从「模式感知」的
 * --surface/--ink 派生，两种模式都读得清（见 globals.css 对应段）。
 *
 * 本文件是「有哪些主题 + 元信息」的单一真值源：渲染只需把 template key 透传给 data-ct-theme；
 * 元信息（accent 色点 / mood 一句话）供 admin 报表、造课模板选择卡等 UI 引用。
 * data-ct-theme 的取值 = CourseTemplate.key（不再另设映射，少一处要同步的真值）。
 */

export interface CoursewareTheme {
  /** = CourseTemplate.key（globals.css 的 .ct-theme[data-ct-theme="<key>"] 与此对应）。 */
  key: string;
  /** UI 展示名（与模板 label 对齐，便于并列展示）。 */
  label: string;
  /** 主强调色 hex（供 UI 色点 / 报表；CSS 里独立再写一份，此处仅展示用）。 */
  accent: string;
  /** 一句话风格基调（造课模板卡副标 / admin 报表可用）。 */
  mood: string;
}

/**
 * 六套主题与六个内置模板一一对应（key 相同）。accent 均为「亮暗两用」的中间调，
 * 且对白字（步骤徽章 / 下一页按钮等以白字压强调色）保持可读对比。
 */
export const COURSEWARE_THEMES: CoursewareTheme[] = [
  { key: "classic", label: "学院纸面", accent: "#3f51b5", mood: "靛蓝学术、衬线标题、纸感网格，像翻开一本教科书" },
  { key: "case_driven", label: "档案侦探", accent: "#9c5f16", mood: "牛皮纸琥珀、衬线、斜纹卷宗，像摊开一份案卷" },
  { key: "story", label: "剧场连载", accent: "#9333c7", mood: "紫罗兰幕布、大圆角、深色场景像拉开舞台幕布" },
  { key: "socratic", label: "黑板研讨", accent: "#128a5a", mood: "墨绿粉笔、点阵底纹，像围着一块黑板一起想通" },
  { key: "workshop", label: "车间蓝图", accent: "#0e7490", mood: "青蓝蓝图、等宽标题、网格底，像照着图纸动手" },
  { key: "exam_sprint", label: "冲刺计分", accent: "#d5261d", mood: "高对比红、紧凑直角，像倒计时里连打抢分" },
];

const THEME_KEYS = new Set(COURSEWARE_THEMES.map((t) => t.key));

/**
 * 解析 course.template → data-ct-theme 属性值。
 * 未知 / 空（旧课未选模板）→ undefined：不挂 data-ct-theme，回落默认 STUDIO 皮肤，旧课零回归。
 */
export function coursewareThemeAttr(template?: string | null): string | undefined {
  return template && THEME_KEYS.has(template) ? template : undefined;
}

/** 取某主题元信息（未知 → undefined）。供 UI/报表按 key 查展示信息。 */
export function getCoursewareTheme(key?: string | null): CoursewareTheme | undefined {
  return key ? COURSEWARE_THEMES.find((t) => t.key === key) : undefined;
}
