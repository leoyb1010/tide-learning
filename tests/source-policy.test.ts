import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sourcePolicyForFinalCourseOutline, sourcePolicyForFinalLessonDraft, sourcePolicyForTopic } from "@/lib/ai/source-policy";
import { validateBlocks } from "@/lib/blocks";

describe("快变与高风险主题来源门", () => {
  it("最新价格必须同时有来源和明确截至日期", () => {
    expect(sourcePolicyForTopic("截至2026-08-12的 OpenAI API 最新价格", "ai_skill")).toMatchObject({
      topicType: "tech",
      requiresSource: true,
      requiresAsOfDate: true,
      asOfDate: "2026-08-12",
    });
    expect(sourcePolicyForTopic("OpenAI API 最新价格", "ai_skill")).toMatchObject({
      requiresSource: true,
      requiresAsOfDate: true,
      asOfDate: null,
    });
  });

  it("时事即使没有最新字样也要求来源", () => {
    expect(sourcePolicyForTopic("本周要闻解读")).toMatchObject({ topicType: "current", requiresSource: true });
  });

  it("医疗法律金融高风险事实必须有外部真值", () => {
    expect(sourcePolicyForTopic("药物 X 的用药建议").requiresSource).toBe(true);
    expect(sourcePolicyForTopic("合同效力与现行法条").requiresSource).toBe(true);
    expect(sourcePolicyForTopic("股票投资建议").requiresSource).toBe(true);
  });

  it("NFKC + lowercase 后覆盖英文快变与医疗/法律/税务/投资词表", () => {
    expect(sourcePolicyForTopic("ＣＵＲＲＥＮＴ OpenAI API ＰＲＩＣＩＮＧ as of ２０２６－０８－１２")).toMatchObject({
      requiresSource: true,
      requiresAsOfDate: true,
      asOfDate: "2026-08-12",
    });
    expect(sourcePolicyForTopic("Medical treatment and drug dosage advice").requiresSource).toBe(true);
    expect(sourcePolicyForTopic("Legal contract basics").requiresSource).toBe(true);
    expect(sourcePolicyForTopic("Current legal advice and tax rates")).toMatchObject({
      requiresSource: true,
      requiresAsOfDate: true,
    });
    expect(sourcePolicyForTopic("Investment advice for stocks and mutual funds").requiresSource).toBe(true);
  });

  it("稳定基础技能不被无差别拦截", () => {
    expect(sourcePolicyForTopic("学习 JavaScript 闭包基础", "ai_skill")).toMatchObject({
      topicType: "tech", requiresSource: false, requiresAsOfDate: false,
    });
    expect(sourcePolicyForTopic("学习 Git 版本控制基础", "ai_skill")).toMatchObject({
      requiresSource: false, requiresAsOfDate: false,
    });
  });

  it("按最终课名、原始请求和全部课节重算，不沿用旧大纲判定", () => {
    expect(sourcePolicyForFinalCourseOutline({
      courseTitle: "OpenAI API 最新价格",
      originalRequest: "学习 API 基础",
      lessons: [{ title: "计费结构", summary: "对比当前费率" }],
      category: "ai_skill",
      sourceAvailable: false,
    })).toMatchObject({
      requiresSource: true,
      requiresAsOfDate: true,
      missingSource: true,
      missingAsOfDate: true,
    });

    expect(sourcePolicyForFinalCourseOutline({
      courseTitle: "药物常识",
      originalRequest: "做一门基础课",
      lessons: [{ title: "风险边界", summary: "给出具体用药建议" }],
      sourceAvailable: false,
    })).toMatchObject({ requiresSource: true, missingSource: true });
  });

  it("快变大纲只认可信日期，模型最终文本自写日期不能解锁", () => {
    const base = {
      courseTitle: "OpenAI API 最新价格",
      originalRequest: "学习 API 基础",
      lessons: [{ title: "计费结构" }],
      sourceAvailable: true,
    };
    expect(sourcePolicyForFinalCourseOutline(base)).toMatchObject({
      missingSource: false, missingAsOfDate: true, effectiveAsOfDate: null,
    });
    expect(sourcePolicyForFinalCourseOutline({ ...base, persistedSourceAsOf: "2026-08-12" })).toMatchObject({
      missingSource: false, missingAsOfDate: false, effectiveAsOfDate: "2026-08-12",
    });
    expect(sourcePolicyForFinalCourseOutline({ ...base, courseTitle: "截至 2026年8月12日的 OpenAI API 最新价格" })).toMatchObject({
      missingSource: false, missingAsOfDate: true, effectiveAsOfDate: null, asOfDate: null,
    });
    expect(sourcePolicyForFinalCourseOutline({ ...base, originalRequest: "截至 2026-08-12 的用户请求" })).toMatchObject({
      missingSource: false, missingAsOfDate: true, effectiveAsOfDate: null,
    });
    expect(sourcePolicyForFinalCourseOutline({ ...base, trustedDateText: "用户确认截至 2026/08/12" })).toMatchObject({
      missingSource: false, missingAsOfDate: false, effectiveAsOfDate: "2026-08-12",
    });
    expect(sourcePolicyForFinalCourseOutline({
      ...base,
      sourceAvailable: false,
      actualSourceText: "官方 reference 原文，更新于 2026-08-12",
    })).toMatchObject({
      missingSource: false, missingAsOfDate: false, effectiveAsOfDate: "2026-08-12",
    });
  });

  it("安全改名不需要来源", () => {
    expect(sourcePolicyForFinalCourseOutline({
      courseTitle: "JavaScript 闭包基础",
      originalRequest: "学习 JavaScript 基础",
      lessons: [{ title: "作用域" }],
      category: "ai_skill",
      sourceAvailable: false,
    })).toMatchObject({ missingSource: false, missingAsOfDate: false });
    expect(sourcePolicyForFinalCourseOutline({
      courseTitle: "JavaScript 闭包基础",
      originalRequest: "学习 JavaScript 基础",
      lessons: [{ title: "作用域", summary: "读取当前作用域的值" }, { title: "实时系统原理" }],
      category: "ai_skill",
      sourceAvailable: false,
    })).toMatchObject({ missingSource: false, missingAsOfDate: false });
  });

  it("最终模型稿自行升级成快变/高风险事实时，不能自写日期或假引用解锁", () => {
    const generated = "截至 2026-08-12，当前 API 费率是每百万 token 3 美元，并给出股票投资建议。来源：官方文档。";
    expect(sourcePolicyForFinalLessonDraft({
      trustedText: "JavaScript API 基础\n学习请求方法",
      generatedText: generated,
      category: "ai_skill",
      actualSourceText: "",
    })).toMatchObject({
      requiresSource: true,
      requiresAsOfDate: true,
      missingSource: true,
      missingAsOfDate: true,
      asOfDate: null,
    });
  });

  it("最终 blocks 门必须检查校验后的全部字段", () => {
    const blocks = validateBlocks([
      {
        type: "dialog",
        turns: [{ speaker: "A", text: "稳定教学对话", note: "Current medical drug dosage advice" }],
      },
      {
        type: "dragwords",
        segments: ["选择", "。"],
        blanks: ["正确词"],
        distractors: ["latest investment pricing"],
      },
    ]);
    expect(sourcePolicyForFinalLessonDraft({
      trustedText: "稳定课程",
      generatedText: JSON.stringify(blocks),
      actualSourceText: "",
    })).toMatchObject({
      requiresSource: true,
      requiresAsOfDate: true,
      missingSource: true,
      missingAsOfDate: true,
    });

    const courseGenSource = readFileSync("src/lib/course-gen.ts", "utf8");
    const gateStart = courseGenSource.indexOf("const finalTopicPolicy = sourcePolicyForFinalLessonDraft");
    const gateEnd = courseGenSource.indexOf("if (finalTopicPolicy.missingSource || finalTopicPolicy.missingAsOfDate)", gateStart);
    const gateSource = courseGenSource.slice(gateStart, gateEnd);
    expect(gateStart).toBeGreaterThan(-1);
    expect(gateEnd).toBeGreaterThan(gateStart);
    expect(gateSource).toContain("generatedText: JSON.stringify(blocks)");
    expect(gateSource).not.toContain("generatedText: blocksToPlainText(blocks)");
  });

  it("最终课节稿只认实际注入来源与已持久截至日期", () => {
    expect(sourcePolicyForFinalLessonDraft({
      trustedText: "截至 2026-08-12 的 API 价格课",
      generatedText: "对比当前费率",
      actualSourceText: "官方资料原文",
    })).toMatchObject({ missingSource: false, missingAsOfDate: false, asOfDate: "2026-08-12" });
  });

  it("本节实际召回来源中的日期是可信日期，但无日期来源不能解锁快变断言", () => {
    const base = {
      trustedText: "API 基础课",
      generatedText: "对比当前费率",
    };
    expect(sourcePolicyForFinalLessonDraft({
      ...base,
      actualSourceText: "官方价格文档，截至 2026-08-12",
    })).toMatchObject({ missingSource: false, missingAsOfDate: false, asOfDate: "2026-08-12" });
    expect(sourcePolicyForFinalLessonDraft({
      ...base,
      actualSourceText: "官方价格文档，未标明截至日期",
    })).toMatchObject({ missingSource: false, missingAsOfDate: true, asOfDate: null });
  });

  it("模型生成的课名/大纲日期只能触发风险，不能自我解锁", () => {
    expect(sourcePolicyForFinalLessonDraft({
      triggerText: "截至 2026-08-12 的 OpenAI API 当前价格",
      trustedDateText: "",
      generatedText: "对比当前费率",
      actualSourceText: "官方价格文档，未标明截至日期",
    })).toMatchObject({
      requiresSource: true,
      requiresAsOfDate: true,
      missingSource: false,
      missingAsOfDate: true,
      asOfDate: null,
    });
  });
});
