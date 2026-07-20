/**
 * v5 造课设计 brief 生成——一次小成本 LLM 调用，为本课定制专属视觉方向。
 *
 * 位置：造课大纲落库前。输入课题/大纲，输出一个 DesignBrief（枚举 + 色相），
 * 平台再确定性合成完整配色。固定用便宜 free 档模型、低权重计费、20s 超时、失败静默降级为 null
 * （降级即回落原 12 套固定皮肤的种子挑选，不炸整门课创建）。
 */

import { chatJson } from "@/lib/llm";
import { creditingOnUsage } from "@/lib/credits";
import { sanitizeBrief, type DesignBrief, CHROMA, PAPER_TINT, FONT_PERSONALITY, LAYOUT, MOTION_SIG, RADIUS_STEP, TEXTURE } from "./design-brief";

// 生成 brief 用最便宜的 free 档模型（注册表无 deepseek-chat，gpt-5.6-sol 是 free 且 costWeight=1）。
const BRIEF_MODEL = "gpt-5.6-sol";

export const BRIEF_SYSTEM =
  "你是一位为在线微课设计视觉识别的艺术总监。给你一门课的主题与大纲，你要为这门课定一套**专属的视觉方向**——" +
  "让它一眼看上去就是「讲这个主题的课」，而不是随便一套模板皮肤。\n\n" +
  "只输出一个 JSON 对象，字段与取值严格如下（不得杜撰值、不写任何解释文字）：\n" +
  `- accentHue: 0-359 的整数色相，本课的品牌主色调。**由主题气质决定**：\n` +
  "    自然/海洋/环保→青绿(150-200)；医疗/健康→青或正蓝(180-230)；金融/职场/效率→靛蓝或石墨蓝(220-250)；\n" +
  "    法律/历史/人文→勃艮第红或墨绿(自选 350-20 或 140-170)；美食/语言/生活→暖橙赤陶(20-45)；\n" +
  "    艺术/设计/心理→紫红或品红(300-340)；科技/编程/AI→冷青或电蓝(185-215)；考试/冲刺→警示红橙(5-30)。\n" +
  "    **禁止无理由默认紫/靛(260-290)**——那是 AI 配色的烂大街信号；只有主题真的是艺术/神秘/夜空才用。\n" +
  `- chroma: ${CHROMA.join(" | ")}（色彩浓度：muted 沉稳专业，balanced 通用，vivid 活力鲜明）\n` +
  "- substrate: light | dark（基底明暗。dark 只给 科技/编程/AI/影视/夜间气质的课；多数课用 light）\n" +
  `- paperTint: ${PAPER_TINT.join(" | ")}（底色微色温：warm 暖纸感、cool 冷调、neutral 中性）\n` +
  `- font: ${FONT_PERSONALITY.join(" | ")}\n` +
  "    serif-editorial 衬线编辑感(人文/历史/深度阅读)；sans-clean 无衬线克制(通用/商务)；\n" +
  "    mono-technical 等宽工程感(编程/工具/数据)；rounded-friendly 圆润亲和(语言/少儿/银发/生活)；grotesk-bold 粗黑杂志感(冲刺/营销/潮流)\n" +
  `- layout: ${LAYOUT.join(" | ")}\n` +
  "    editorial 超大衬线左对齐；terminal 等宽终端；magazine 巨型粗黑封面；zen 极简大留白；soft 柔和居中(通用默认)\n" +
  `- motionSig: ${MOTION_SIG.join(" | ")}\n` +
  "    rise 淡入上浮(通用)；draw 线条描画(工程/流程/图解)；type 终端逐字(编程)；curtain 幕帘揭示(故事/人文/沉浸)；slide 侧滑(杂志/冲刺/高能)\n" +
  `- radius: ${RADIUS_STEP.join(" | ")}（sharp 锐利专业、soft 通用、round 圆润亲和）\n` +
  `- texture: ${TEXTURE.join(" | ")}（none 干净、grid 工程网格、dots 印刷点、topo 等高线、grain 纸纹颗粒）\n\n` +
  "取舍要协调：font/layout/motionSig/texture 应共同烘托同一种气质（如编程课→mono-technical+terminal+type+grid+dark；" +
  "人文课→serif-editorial+editorial+curtain+grain+light）。不要各挑各的拼成四不像。";

interface BriefInput {
  title: string;
  subtitle?: string | null;
  category?: string | null;
  outline?: string[]; // 章节标题若干，帮助判断气质
  userId: string;
}

/**
 * 生成并钳制本课设计 brief；任何失败（LLM 错误/超时/脏输出）→ 返回 null 交由上层降级。
 * 绝不抛：大纲那次调用可能已扣费，装饰性的 brief 生成不能拖垮整门课创建。
 */
export async function generateDesignBrief(input: BriefInput): Promise<DesignBrief | null> {
  try {
    const outlineLines = (input.outline ?? []).slice(0, 8).map((t, i) => `${i + 1}. ${t}`).join("\n");
    const user =
      `课程标题：${input.title}\n` +
      (input.subtitle ? `副标题：${input.subtitle}\n` : "") +
      (input.category ? `赛道：${input.category}\n` : "") +
      (outlineLines ? `大纲：\n${outlineLines}\n` : "") +
      "\n为这门课定一套专属视觉方向，只输出 JSON。";

    const raw = await chatJson<Record<string, unknown>>({
      system: BRIEF_SYSTEM,
      user,
      model: BRIEF_MODEL,
      temperature: 0.6, // 略高，鼓励色相多样，但结构由词表钳死
      maxTokens: 400,
      retries: 0,
      timeoutMs: 20_000,
      onUsage: creditingOnUsage(input.userId, "generate_design_brief"),
    });
    return sanitizeBrief(raw);
  } catch {
    return null;
  }
}
