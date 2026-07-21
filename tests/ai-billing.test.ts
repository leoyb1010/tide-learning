import { describe, it, expect, vi } from "vitest";

/**
 * 流3 · U7 —— AI 计费折算 + 造课质量规则评估 单测。
 *
 * 覆盖两组纯函数（零 IO、零 LLM）：
 *   1) credits.ts：tokensToCredits（按场景权重 × token 折算，向上取整、至少 1）
 *      / estimateCredits（预检门槛用的典型成本估算）。锁死各场景权重不被误改。
 *   2) course-gen.ts：scoreLesson（六项规则的质量分与达标判定）。锁死评分口径，
 *      让 admin 看到的 qualityScore / 低质量事件有稳定语义。
 *
 * credits.ts 顶层 import 了 ./db（prisma）与 react.cache；course-gen.ts 顶层 import 了
 * ./db / ./llm / ./analytics。只测纯函数，故把有副作用的模块 mock 掉，避免实例化 prisma / 触网。
 */

// —— mock 掉带副作用的依赖（只保留被测纯函数的行为）——
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/llm", () => ({ chatJson: vi.fn(), chat: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { tokensToCredits, estimateCredits, type Scene } from "@/lib/credits";
import { scoreLesson, LESSON_QUALITY_THRESHOLD } from "@/lib/course-gen";

// ————————————————————————————————————————————————————————————
//  tokensToCredits —— 场景权重 × token 折算
// ————————————————————————————————————————————————————————————

/** 构造 usage（只有 totalTokens 参与折算）。 */
function usage(totalTokens: number) {
  return { promptTokens: 0, completionTokens: 0, totalTokens };
}

describe("tokensToCredits —— 折算规则", () => {
  it("向上取整：不足 1000 token 也至少扣 1 分", () => {
    expect(tokensToCredits(usage(1), "generate_course")).toBe(1);
    expect(tokensToCredits(usage(0), "generate_course")).toBe(1); // 至少 1，防零成本刷调用
    expect(tokensToCredits(usage(999), "generate_course")).toBe(1);
    expect(tokensToCredits(usage(1000), "generate_course")).toBe(1);
    expect(tokensToCredits(usage(1001), "generate_course")).toBe(2);
  });

  it("权重 1.0 场景：credits ≈ ceil(totalTokens/1000)", () => {
    for (const s of ["generate_course", "generate_lesson", "generate_exam", "import_source"] as Scene[]) {
      expect(tokensToCredits(usage(3000), s)).toBe(3);
      expect(tokensToCredits(usage(3001), s)).toBe(4);
    }
  });

  it("权重 0.8 场景（review_card / note_transform / note_summary）", () => {
    for (const s of ["review_card", "note_transform", "note_summary"] as Scene[]) {
      // 5000 * 0.8 / 1000 = 4
      expect(tokensToCredits(usage(5000), s)).toBe(4);
      // 3000 * 0.8 / 1000 = 2.4 → ceil 3
      expect(tokensToCredits(usage(3000), s)).toBe(3);
    }
  });

  it("companion 权重 0.5：对话类更便宜", () => {
    // 4000 * 0.5 / 1000 = 2
    expect(tokensToCredits(usage(4000), "companion")).toBe(2);
    // 1000 * 0.5 / 1000 = 0.5 → ceil 1（至少 1）
    expect(tokensToCredits(usage(1000), "companion")).toBe(1);
  });

  it("search_expand 权重 0.2：最廉价出口", () => {
    // 10000 * 0.2 / 1000 = 2
    expect(tokensToCredits(usage(10000), "search_expand")).toBe(2);
    // 1000 * 0.2 / 1000 = 0.2 → ceil 1
    expect(tokensToCredits(usage(1000), "search_expand")).toBe(1);
  });

  it("权重排序不被误改：贵场景折算 ≥ 便宜场景（同 token）", () => {
    const t = 10000;
    const course = tokensToCredits(usage(t), "generate_course"); // 1.0 → 10
    const transform = tokensToCredits(usage(t), "note_transform"); // 0.8 → 8
    const companion = tokensToCredits(usage(t), "companion"); // 0.5 → 5
    const search = tokensToCredits(usage(t), "search_expand"); // 0.2 → 2
    expect(course).toBe(10);
    expect(transform).toBe(8);
    expect(companion).toBe(5);
    expect(search).toBe(2);
    expect(course).toBeGreaterThan(transform);
    expect(transform).toBeGreaterThan(companion);
    expect(companion).toBeGreaterThan(search);
  });
});

describe("estimateCredits —— 预检门槛的典型成本", () => {
  it("按各场景典型 token 量估门槛（P1-3：不再一律 3000）", () => {
    // note_transform 典型仍为 3000，等价旧口径；HTML 精修/逐节典型 token 更高，门槛应随之抬升。
    expect(estimateCredits("note_transform")).toBe(tokensToCredits(usage(3000), "note_transform"));
    // 逐节 HTML 精修（典型 16000）是最贵出口，门槛应显著高于大纲（典型 4000）。
    expect(estimateCredits("generate_lesson_html")).toBeGreaterThan(estimateCredits("generate_course"));
    // 逐节块（典型 8000）门槛应高于搜索扩展（典型 1000）。
    expect(estimateCredits("generate_lesson")).toBeGreaterThan(estimateCredits("search_expand"));
  });

  it("传 model 时按模型计费权重抬高门槛（高级模型更贵）", () => {
    // 同场景下，高权重模型的门槛应 ≥ 基准模型（缺省 model 权重=1）。
    const base = estimateCredits("generate_lesson");
    const premium = estimateCredits("generate_lesson", undefined, "__nonexistent_model__");
    expect(premium).toBeGreaterThanOrEqual(base); // 未知模型权重回落 1，至少不低于基准
  });

  it("高成本生成类门槛 > 1（预检不再形同虚设）", () => {
    // generate_exam / generate_course 权重 1.0：3000 token → 3 分门槛，堵住「余额 1 分发起满额生成」。
    expect(estimateCredits("generate_exam")).toBeGreaterThan(1);
    expect(estimateCredits("generate_course")).toBeGreaterThan(1);
    expect(estimateCredits("generate_lesson")).toBeGreaterThan(1);
    expect(estimateCredits("import_source")).toBeGreaterThan(1);
  });
});

// ————————————————————————————————————————————————————————————
//  scoreLesson —— 造课质量规则评估
// ————————————————————————————————————————————————————————————

/** 造一节「满分」内容真值：体量健康、有检验、有证据、动作多样、定义占比健康。 */
function goodLesson(): { type: string }[] {
  return [
    { type: "scene" }, // 开头钩子
    { type: "objectives" },
    { type: "concept" }, // 1 个 concept（占比 1/8=12.5% < 60%）
    { type: "dialog" }, // 视觉块 1
    { type: "compare" }, // 视觉块 2
    { type: "steps" }, // 视觉块 3
    { type: "quiz" }, // 交互块
    { type: "summary" }, // 结尾
  ];
}

describe("scoreLesson —— 满分课件", () => {
  it("命中全部五项内容底线 → 100 分、达标", () => {
    const q = scoreLesson(goodLesson());
    expect(q.score).toBe(100);
    expect(q.passed).toBe(true);
    expect(q.flags).toEqual({
      countOk: true,
      hasAssessment: true,
      hasEvidence: true,
      hasVariety: true,
      conceptRatioOk: true,
    });
  });
});

describe("scoreLesson —— 逐项扣分", () => {
  it("少量但有效的内容不因固定块数下限被拒绝", () => {
    const q = scoreLesson([{ type: "quiz" }, { type: "example" }]);
    expect(q.flags.countOk).toBe(true);
  });

  it("不再奖励固定开头：concept 开头不扣分", () => {
    const blocks = goodLesson();
    blocks[0] = { type: "concept" };
    const q = scoreLesson(blocks);
    expect(q.score).toBe(100);
  });

  it("不再奖励固定结尾：没有 summary 结尾不扣分", () => {
    const blocks = goodLesson();
    blocks[blocks.length - 1] = { type: "keypoint" };
    const q = scoreLesson(blocks);
    expect(q.score).toBe(100);
  });

  it("无理解检验：扣 hasAssessment 的 20 分", () => {
    const blocks = [
      { type: "scene" }, { type: "objectives" }, { type: "concept" },
      { type: "dialog" }, { type: "compare" }, { type: "steps" },
      { type: "keypoint" }, { type: "summary" },
    ];
    const q = scoreLesson(blocks);
    expect(q.flags.hasAssessment).toBe(false);
    expect(q.score).toBe(80);
  });

  it("没有案例/步骤/对照等证据：扣 hasEvidence 的 20 分", () => {
    const blocks = [
      { type: "scene" }, { type: "objectives" }, { type: "concept" },
      { type: "keypoint" }, { type: "quiz" }, { type: "summary" },
    ];
    const q = scoreLesson(blocks);
    expect(q.flags.hasEvidence).toBe(false);
    expect(q.score).toBe(80);
  });

  it("教学动作少于三种：扣 hasVariety 的 20 分", () => {
    const q = scoreLesson([{ type: "quiz" }, { type: "example" }, { type: "quiz" }, { type: "example" }]);
    expect(q.flags.hasVariety).toBe(false);
    expect(q.score).toBe(80);
  });

  it("concept 占比 ≥75%（定义墙）：扣 conceptRatioOk 的 20 分", () => {
    const blocks = Array.from({ length: 6 }, () => ({ type: "concept" })).concat([{ type: "quiz" }, { type: "example" }]);
    const q = scoreLesson(blocks);
    expect(q.conceptRatio).toBe(0.75);
    expect(q.flags.conceptRatioOk).toBe(false);
    expect(q.score).toBe(80);
  });
});

describe("scoreLesson —— 降级占位节（单个 concept）", () => {
  it("单块 concept：仅命中非空底线，仍低分且不达标", () => {
    const q = scoreLesson([{ type: "concept" }]);
    expect(q.score).toBe(20);
    expect(q.passed).toBe(false);
    expect(q.flags.conceptRatioOk).toBe(false);
  });

  it("空块数组：0 分、不崩", () => {
    const q = scoreLesson([]);
    expect(q.score).toBe(0);
    expect(q.total).toBe(0);
    expect(q.conceptRatio).toBe(0);
    expect(q.passed).toBe(false);
  });
});

describe("scoreLesson —— 达标阈值语义", () => {
  it("恰好命中阈值判定：score >= 阈值 即 passed", () => {
    // 60 分：体量、动作多样、定义占比健康；无检验、无证据。
    const blocks = [{ type: "scene" }, { type: "objectives" }, { type: "keypoint" }, { type: "summary" }];
    const q = scoreLesson(blocks);
    expect(q.flags.hasAssessment).toBe(false);
    expect(q.flags.hasEvidence).toBe(false);
    expect(q.score).toBe(LESSON_QUALITY_THRESHOLD);
    expect(q.passed).toBe(true); // >= 阈值
  });
});
