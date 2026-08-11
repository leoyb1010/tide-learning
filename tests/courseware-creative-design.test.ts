import { describe, expect, it } from "vitest";
import {
  parseCreativeDesign,
  serializeCreativeDesign,
  validateCreativeDesign,
  verifyCreativeDesignUsage,
} from "@/lib/ai/courseware-creative-design";

const raw = {
  concept: {
    audience: "已经会做基础实验、需要学会判断证据强弱的学习者",
    learnerAction: "根据三组观察记录判断哪一个结论成立并说明理由",
    promise: "像翻阅真实实验日志一样完成一次证据推理",
    surfaceArchetype: "inspect",
    tension: "直觉判断与可核验证据",
    visualMetaphor: "逐层显影的实验档案台",
    directionCandidates: [
      { key: "A", concept: "实验档案台", rationale: "证据天然适合逐页核验", spatialOrganization: "左轴记录右侧证物", informationRhythm: "观察与结论交替", materialRole: "原始记录是主角", motionBehavior: "证据逐层显影", risk: "信息密度偏高" },
      { key: "B", concept: "证据天平", rationale: "适合比较论据权重", spatialOrganization: "双侧对照中央结论", informationRhythm: "先并陈再收束", materialRole: "对照材料承担冲突", motionBehavior: "权重变化只用位移", risk: "可能过度二元化" },
      { key: "C", concept: "黑箱观察窗", rationale: "突出从现象反推机制", spatialOrganization: "环绕观察窗口钻取", informationRhythm: "先未知后揭示", materialRole: "现象片段驱动探索", motionBehavior: "窗口淡入与聚焦", risk: "探索成本较高" },
    ],
    selectedDirection: "A",
    selectionReason: "最忠于本节按证据推进的学习动作，也最容易保持中文长文可读",
    sceneBudget: ["开场的三份互相冲突记录", "最终证据链完整显影"],
    interactionRationale: "学习者需要逐条展开证据并提交判断，互动直接承担推理动作",
    courseFamilyRules: ["始终保留档案编号与证据轴", "正文使用同一人文无衬线家族"],
    lessonVariationRules: ["每节证物形态必须变化", "重点场面的空间轮廓不得复制"],
    reducedMotionPlan: "关闭动画时所有证据默认完整展开，阅读顺序保持不变",
  },
  direction: "冷静的实验日志，以证据推进而非卡片罗列",
  palette: {
    background: { l: 0.97, c: 0.01, h: 80 },
    surface: { l: 0.93, c: 0.012, h: 80 },
    ink: { l: 0.18, c: 0.02, h: 250 },
    muted: { l: 0.36, c: 0.02, h: 250 },
    accent: { l: 0.42, c: 0.14, h: 25 },
    accentInk: { l: 0.98, c: 0.005, h: 80 },
  },
  font: "humanist-sans",
  radiusPx: 9,
  gridColumns: 7,
  spacingUnit: 10,
  motif: "逐层显影的实验记录纸",
  layoutStrategy: "主论证沿左侧纵轴推进，练习穿插在证据节点之间",
  motion: { durationMs: 460, easing: [0.16, 1, 0.3, 1], signature: "结论随证据由下向上显影" },
};

describe("单节原创设计 token 闸门", () => {
  it("接受合法、对比度达标的模型设计并可稳定落库", () => {
    const checked = validateCreativeDesign(raw, { requireConcept: true });
    expect(checked.ok).toBe(true);
    expect(checked.design?.palette.background.hex).toMatch(/^#[0-9a-f]{6}$/);
    const restored = parseCreativeDesign(serializeCreativeDesign(checked.design!));
    expect(restored).toEqual(checked.design);
  });

  it("新生成设计必须先给出三个真正不同的概念方向", () => {
    const checked = validateCreativeDesign({ ...raw, concept: { ...raw.concept, directionCandidates: raw.concept.directionCandidates.slice(0, 2) } }, { requireConcept: true });
    expect(checked.ok).toBe(false);
    expect(checked.issues.some((issue) => issue.includes("A/B/C"))).toBe(true);
  });

  it("历史 v1 token 没有 concept 仍可读取", () => {
    const legacy = { ...raw } as Record<string, unknown>;
    delete legacy.concept;
    const checked = validateCreativeDesign(legacy);
    expect(checked.ok).toBe(true);
    expect(checked.design?.concept).toBeUndefined();
  });

  it("拒绝不可读色板，不替模型自动修色", () => {
    const checked = validateCreativeDesign({
      ...raw,
      palette: { ...raw.palette, ink: { l: 0.9, c: 0.01, h: 80 } },
    });
    expect(checked.ok).toBe(false);
    expect(checked.issues.some((issue) => issue.includes("对比度"))).toBe(true);
  });

  it("确认 bespoke HTML 原样声明并实际使用本节 token", () => {
    const design = validateCreativeDesign(raw).design!;
    const p = design.palette;
    const html = `<style>:root{--cw-bg:${p.background.hex};--cw-surface:${p.surface.hex};--cw-ink:${p.ink.hex};--cw-muted:${p.muted.hex};--cw-accent:${p.accent.hex};--cw-accent-ink:${p.accentInk.hex}}body{background:var(--cw-bg);color:var(--cw-ink)}section{background:var(--cw-surface);color:var(--cw-muted)}button{background:var(--cw-accent);color:var(--cw-accent-ink)}</style>`;
    expect(verifyCreativeDesignUsage(html, design)).toEqual([]);
    expect(verifyCreativeDesignUsage("<style>body{color:red}</style>", design).length).toBeGreaterThan(0);
  });
});
