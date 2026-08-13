import { describe, it, expect } from "vitest";
import { classifyTopic, topicTaxonomyFragment, TOPIC_PROFILES } from "@/lib/ai/topic-taxonomy";

/**
 * 主题分类学 —— 锁死三件事：
 *  1) 非技能类主题（史实/议题/时事/人物/行业）能被摘出来，不再被硬套技能进阶结构；
 *  2) 无把握时返回 null / 空串——不注入 = 与吸收前行为完全一致，误判不会让课变差；
 *  3) 纯函数：同输入必得同输出（大纲期与逐节期各自现算即一致，这是不落库的前提）。
 */

describe("classifyTopic —— 非技能类主题能被摘出来", () => {
  it("历史类：编年而非难度分级", () => {
    expect(classifyTopic("明清社会经济史")?.type).toBe("history");
    expect(classifyTopic("第二次世界大战全史")?.type).toBe("history");
    expect(classifyTopic("中国互联网发展史")?.type).toBe("history");
  });
  it("社会议题：必须并陈分歧", () => {
    expect(classifyTopic("算法推荐的伦理争议")?.type).toBe("social");
    expect(classifyTopic("人工智能与公共政策")?.type).toBe("social");
  });
  it("时事：要时间点与未定论标注", () => {
    expect(classifyTopic("本周要闻解读")?.type).toBe("current");
  });
  it("人物机构", () => {
    expect(classifyTopic("乔布斯生平与产品哲学")?.type).toBe("person");
  });
  it("行业格局", () => {
    expect(classifyTopic("新能源汽车产业链全解")?.type).toBe("industry");
  });
  it("成熟学科", () => {
    expect(classifyTopic("线性代数导论")?.type).toBe("academic");
  });
  it("快变技术", () => {
    expect(classifyTopic("Python 数据分析入门")?.type).toBe("tech");
    expect(classifyTopic("大模型应用开发")?.type).toBe("tech");
  });
});

describe("classifyTopic —— 优先级与边界", () => {
  it("「发展史」压过技术关键词：AI 发展史是史实不是技术教程", () => {
    expect(classifyTopic("人工智能发展史")?.type).toBe("history");
  });
  it("「行业应用」不误判为行业格局（负向前瞻断言生效）", () => {
    expect(classifyTopic("大模型的行业应用")?.type).toBe("tech");
  });
  it("无强信号 + 无赛道 → null（不注入任何片段）", () => {
    expect(classifyTopic("沟通表达提升")).toBeNull();
    expect(classifyTopic("")).toBeNull();
  });
  it("无强信号时用赛道弱先验兜底", () => {
    expect(classifyTopic("沟通表达提升", "vocational")?.type).toBe("skill");
    expect(classifyTopic("每日一课", "ai_skill")?.type).toBe("tech");
    expect(classifyTopic("随便什么", "unknown_track")).toBeNull();
  });
  it("正则强信号压过赛道先验", () => {
    expect(classifyTopic("英语学习简史", "english_oral")?.type).toBe("history");
  });
  it("原始社会议题上下文压过生成后的技术标题与赛道", () => {
    const stableContext = "算法推荐造成的不平等应该怎么治理 推荐系统治理实战";
    expect(classifyTopic(stableContext, "ai_skill")?.type).toBe("social");
  });
  it("通用导入标题可由正文中的历史信号正确分类", () => {
    expect(classifyTopic("我的笔记 明清社会经济史与海禁政策", null)?.type).toBe("history");
  });
});

describe("topicTaxonomyFragment —— 注入片段", () => {
  it("无把握 → 空串（拼进 prompt 是无操作）", () => {
    expect(topicTaxonomyFragment("沟通表达提升")).toBe("");
    expect(topicTaxonomyFragment("", null)).toBe("");
  });
  it("命中 → 含结构预期 / 举证标准 / 特别避免三段", () => {
    const frag = topicTaxonomyFragment("明清社会经济史");
    expect(frag).toContain("历史事件");
    expect(frag).toContain("结构预期");
    expect(frag).toContain("举证标准");
    expect(frag).toContain("本类主题特别避免");
  });
  it("不规定块型 / 块数 / 章节数（v6 铁律：只表达预期，不发骨架）", () => {
    for (const profile of Object.values(TOPIC_PROFILES)) {
      const frag = topicTaxonomyFragment("x", null) + [profile.structure, profile.evidence, profile.avoid].join(" ");
      expect(frag).not.toMatch(/至少\s*\d+\s*(个块|节)|必须包含\s*(scene|objectives|quiz|summary)|固定\s*\d+\s*节/);
    }
  });
  it("社会议题片段带「不制造虚假共识」这条硬纪律", () => {
    expect(topicTaxonomyFragment("算法推荐的伦理争议")).toContain("虚假共识");
  });
  it("纯函数：同输入同输出", () => {
    const a = topicTaxonomyFragment("Python 数据分析入门", "ai_skill");
    const b = topicTaxonomyFragment("Python 数据分析入门", "ai_skill");
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
});
