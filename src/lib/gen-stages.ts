/**
 * AI 造课引擎的四站流程 —— 单一事实源。
 * ---------------------------------------------------------------------------
 * 造课 / 导入两种模式共用同一条四站生产线：understand → outline → lessons → done。
 * 曾出现「首页演示卡步骤文案与真实引擎不同步」的问题（DeskDemo 硬编码一套、GenStage
 * 另一套），根因是两处各自维护。此处抽为共享常量：
 *   - GEN_STATIONS：GenStage 真实进度轨道用的精简站名（generate / import 各一套）。
 *   - GEN_DEMO_STEPS：首页 DeskDemo 演示卡用的稍详细步骤文案（过程导向、更易读）。
 * 二者的「站序与语义」绑定同一四站；文案因场景（紧凑轨道 vs 营销演示）可各有繁简，
 * 但都从本文件取，改流程时只动这一处。纯常量、无运行时依赖、server/client 通用。
 */

/** 四站的稳定 key（与后端阶段 understand/outline/lessons/done 对齐）。 */
export const GEN_STAGE_KEYS = ["understand", "outline", "lessons", "done"] as const;
export type GenStageKey = (typeof GEN_STAGE_KEYS)[number];

/** GenStage 真实进度轨道站名（精简，配紧凑轨道）。 */
export const GEN_STATIONS = {
  generate: ["理解需求", "设计大纲", "逐节写作", "装订成册"],
  import: ["通读资料", "拆分章节", "逐章升维", "装订成册"],
} as const;

/** 首页 DeskDemo 演示卡步骤文案（稍详细、过程导向，配演示节奏）。 */
export const GEN_DEMO_STEPS = [
  "理解你的需求",
  "设计课程大纲",
  "逐节写作讲义",
  "装订成册",
] as const;
