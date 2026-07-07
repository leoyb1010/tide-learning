import { describe, it, expect } from "vitest";
import {
  resolveCourseDesign,
  serializeCourseDesign,
  ART_DIRECTIONS,
  getArtDirection,
} from "@/lib/ai/courseware-design";
import { resolveLessonVariance } from "@/lib/ai/courseware-variance";
import {
  renderCoursewareHtml,
  validateCoursewareHtml,
  buildContract,
  enforceTrustedCsp,
  CSP_META,
} from "@/lib/ai/courseware-html";
import { heroMotif, cornerMotif } from "@/lib/ai/courseware-motifs";
import { resolveCoursewareMode, getModeProfile, llmStyleBrief, MODE_PROFILES } from "@/lib/ai/courseware-catalog";
import type { Block } from "@/lib/blocks";

/**
 * v3.3 多样化 HTML 课件引擎：确定性设计系统 + Variance 抽签 + 渲染器/校验/契约。
 * 锁死"多样、安全、可复现"三条，防回归。
 */

function sampleBlocks(): (Block & { id: string })[] {
  return [
    { id: "b0", type: "scene", title: "会议室里没接住的那句话", markdown: "老板问你 ROI 是多少，你张了张嘴。" },
    { id: "b1", type: "objectives", items: ["能说出 ROI 的算法", "能判断一个方案值不值得做"] },
    { id: "b2", type: "concept", title: "什么是 ROI", markdown: "投资回报率 = 收益 / 成本。**越高越值**。" },
    { id: "b3", type: "example", markdown: "花 1 万带来 3 万收益，ROI = 200%。" },
    { id: "b4", type: "steps", steps: [{ title: "算收益", detail: "列出全部收益" }, { title: "算成本" }] },
    { id: "b5", type: "compare", left: { heading: "误区", items: ["只看收益"] }, right: { heading: "正确", items: ["收益÷成本"] } },
    { id: "b6", type: "quiz", question: "ROI 200% 意味着？", options: ["亏了", "赚了两倍"], answerIndex: 1, explain: "收益是成本的两倍。" },
    { id: "b7", type: "flashcard", front: "ROI 公式？", back: "收益 / 成本" },
    { id: "b8", type: "summary", markdown: "你学会了算 ROI。", next: "下节学如何汇报它。" },
  ];
}

describe("resolveCourseDesign —— 课级设计系统（确定性）", () => {
  it("同一课稳定可复现，且返回合法艺术方向", () => {
    const c = { id: "course_abc", category: "ai_skill", template: null, designJson: null };
    const d1 = resolveCourseDesign(c);
    const d2 = resolveCourseDesign(c);
    expect(d1.art.key).toBe(d2.art.key);
    expect(ART_DIRECTIONS.some((a) => a.key === d1.art.key)).toBe(true);
    expect(d1.variance).toBeGreaterThanOrEqual(1);
    expect(d1.motion).toBeLessThanOrEqual(10);
  });

  it("模板提示优先命中（story → storybook）", () => {
    const d = resolveCourseDesign({ id: "x", category: "life", template: "story", designJson: null });
    expect(d.art.key).toBe("storybook");
  });

  it("已落库 designJson 精确复原", () => {
    const design = resolveCourseDesign({ id: "y", category: "ai_skill", template: null, designJson: null });
    const json = serializeCourseDesign(design);
    const back = resolveCourseDesign({ id: "y", category: "ai_skill", template: null, designJson: json });
    expect(back.art.key).toBe(design.art.key);
  });

  it("不同课程 id 会分化到不同艺术方向（同赛道候选内）", () => {
    const keys = new Set(
      ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"].map(
        (id) => resolveCourseDesign({ id, category: "ai_skill", template: null, designJson: null }).art.key,
      ),
    );
    expect(keys.size).toBeGreaterThan(1); // 不是所有课都同一个方向
  });
});

describe("新艺术方向 + 内容信号路由（吸收 20 源模板：扩展视觉世界 + 内容→风格）", () => {
  it("新增 3 个方向(cinematic_neon/dev_terminal/academic_lecture)存在且各自母题不同", () => {
    for (const k of ["cinematic_neon", "dev_terminal", "academic_lecture"]) {
      expect(ART_DIRECTIONS.some((a) => a.key === k)).toBe(true);
    }
    // 共 9 个方向
    expect(ART_DIRECTIONS.length).toBeGreaterThanOrEqual(9);
  });

  it("内容信号路由：编程课→dev_terminal，讲义/精读→academic_lecture", () => {
    const dev = resolveCourseDesign({ id: "c1", category: "ai_skill", template: "workshop", designJson: null, title: "Python 编程入门：从函数到部署" });
    expect(dev.art.key).toBe("dev_terminal"); // 内容信号优先于 template hint(workshop→blueprint)
    const aca = resolveCourseDesign({ id: "c2", category: "english_foundation", template: null, designJson: null, title: "考研英语精读讲义" });
    expect(aca.art.key).toBe("academic_lecture");
    // 无强信号 → 回落赛道候选（不强制）
    const plain = resolveCourseDesign({ id: "c3", category: "life", template: null, designJson: null, title: "阳台种菜指南" });
    expect(ART_DIRECTIONS.some((a) => a.key === plain.art.key)).toBe(true);
  });

  it("已落库 designJson 仍优先于内容信号（稳定不漂移）", () => {
    const design = resolveCourseDesign({ id: "c4", category: "ai_skill", template: null, designJson: null, title: "深度学习" });
    const json = serializeCourseDesign({ ...design, art: getArtDirection("storybook") });
    const back = resolveCourseDesign({ id: "c4", category: "ai_skill", template: null, designJson: json, title: "Python 编程" });
    expect(back.art.key).toBe("storybook"); // designJson 赢过内容信号
  });

  it("新方向渲染产物恒过安全/反slop 校验", () => {
    for (const k of ["cinematic_neon", "dev_terminal", "academic_lecture"]) {
      const d = { ...resolveCourseDesign({ id: "x", category: "ai_skill", template: null, designJson: null }), art: getArtDirection(k) };
      const v = resolveLessonVariance("x", { id: "l", title: "t", sortOrder: 0 }, d);
      const html = renderCoursewareHtml({ title: "算清 ROI", blocks: sampleBlocks(), design: d, variance: v });
      expect(validateCoursewareHtml(html).ok).toBe(true);
    }
  });
});

describe("课件风格智能层 catalog（内容类型→mode→风格）", () => {
  it("每个 mode 档案的艺术方向候选都是合法 key", () => {
    for (const p of Object.values(MODE_PROFILES)) {
      expect(p.artCandidates.length).toBeGreaterThan(0);
      for (const k of p.artCandidates) expect(ART_DIRECTIONS.some((a) => a.key === k)).toBe(true);
    }
  });

  it("内容类型→mode 路由：编程→developer-training，讲义→editorial-academic，测验→interactive-quiz", () => {
    expect(resolveCoursewareMode({ title: "Python 数据库开发实战" })).toBe("developer-training");
    expect(resolveCoursewareMode({ title: "考研英语精读讲义" })).toBe("editorial-academic");
    expect(resolveCoursewareMode({ title: "高考语文刷题冲刺" })).toBe("interactive-quiz");
    // 无标题信号→按艺术方向蕴含
    expect(resolveCoursewareMode({ artKey: "cinematic_neon" })).toBe("cinematic-tech");
    // 兜底
    expect(resolveCoursewareMode({})).toBe("scroll-lesson");
  });

  it("llmStyleBrief 产出含 mode 指令 + 页型节奏（供 enhance 注入）", () => {
    const d = resolveCourseDesign({ id: "x", category: "ai_skill", template: null, designJson: null, title: "Python 编程" });
    const brief = llmStyleBrief(d, "Python 编程");
    expect(brief).toContain("developer-training");
    expect(brief).toContain("页型节奏");
    expect(getModeProfile("developer-training").blockEmphasis).toContain("code");
  });
});

describe("resolveLessonVariance —— 场景级抽签（确定性 + 分化）", () => {
  const design = resolveCourseDesign({ id: "cc", category: "ai_skill", template: null, designJson: null });

  it("同节稳定可复现", () => {
    const l = { id: "l1", title: "第一节", sortOrder: 0 };
    const v1 = resolveLessonVariance("cc", l, design);
    const v2 = resolveLessonVariance("cc", l, design);
    expect(v1.seed).toBe(v2.seed);
    expect(v1.opener).toBe(v2.opener);
  });

  it("相邻节倾向分化（种子含 sortOrder）", () => {
    const seeds = [0, 1, 2, 3, 4].map(
      (i) => resolveLessonVariance("cc", { id: `l${i}`, title: `第${i}节`, sortOrder: i }, design).seed,
    );
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it("motion 旋钮低 → 动效集合更小", () => {
    const lowMotion = { ...design, motion: 2 };
    const v = resolveLessonVariance("cc", { id: "l", title: "t", sortOrder: 0 }, lowMotion);
    expect(v.motionSet.length).toBeLessThanOrEqual(2);
    expect(v.motionSet.length).toBeGreaterThanOrEqual(1);
  });
});

describe("renderCoursewareHtml —— 渲染器产物安全且高级", () => {
  const design = resolveCourseDesign({ id: "cc", category: "ai_skill", template: null, designJson: null });
  const variance = resolveLessonVariance("cc", { id: "l1", title: "算清 ROI", sortOrder: 0 }, design);
  const html = renderCoursewareHtml({ title: "算清 ROI", blocks: sampleBlocks(), design, variance });

  it("产物恒过安全/反slop 校验", () => {
    const lint = validateCoursewareHtml(html);
    expect(lint.issues).toEqual([]);
    expect(lint.ok).toBe(true);
  });

  it("含 CSP、reduce-motion、connect-src none；无外链", () => {
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("prefers-reduced-motion");
    expect(/src\s*=\s*["']https?:\/\//.test(html)).toBe(false);
  });

  it("对内容做 HTML 转义（防破坏结构/注入）", () => {
    const evil: (Block & { id: string })[] = [
      { id: "e", type: "concept", title: "<script>x</script>", markdown: "a < b & c > d" },
    ];
    const out = renderCoursewareHtml({ title: "t", blocks: evil, design, variance });
    expect(out).not.toContain("<script>x</script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("不同艺术方向 → 不同产物（多样性）", () => {
    const d2 = { ...design, art: getArtDirection("dark_tech") };
    const html2 = renderCoursewareHtml({ title: "算清 ROI", blocks: sampleBlocks(), design: d2, variance });
    expect(html2).not.toBe(html);
    expect(html2).toContain(getArtDirection("dark_tech").accent);
  });
});

describe("页型档案 + 签名母题（§2 P0：破单调）", () => {
  const design = resolveCourseDesign({ id: "cc", category: "ai_skill", template: null, designJson: null });
  const variance = resolveLessonVariance("cc", { id: "l1", title: "算清 ROI", sortOrder: 0 }, design);
  const html = renderCoursewareHtml({ title: "算清 ROI", blocks: sampleBlocks(), design, variance });

  it("每个 block 都被包进 page 舞台，且 scene/summary 用 hero 母题背景", () => {
    // sampleBlocks 有 9 块 → 9 个 page 舞台
    expect((html.match(/class="page page--/g) || []).length).toBe(9);
    // scene(b0)、summary(b8) → hero；且 hero 注入了签名母题（sec-fig SVG）
    expect(html).toContain("page page--hero");
    expect(html).toContain('class="sec-fig"');
  });

  it("同一节内出现 ≥3 种页型（构图分化，不再千篇一律）", () => {
    const stages = new Set(Array.from(html.matchAll(/page page--(\w+)/g), (m) => m[1]));
    expect(stages.size).toBeGreaterThanOrEqual(3);
  });

  it("相邻页不同型（翻页有对比）", () => {
    const seq = Array.from(html.matchAll(/page page--(\w+)/g), (m) => m[1]);
    let adjacentSame = 0;
    for (let i = 1; i < seq.length; i++) if (seq[i] === seq[i - 1]) adjacentSame++;
    // 允许 hero(scene/summary 强制) 偶发相邻，但整体应高度分化
    expect(adjacentSame).toBeLessThanOrEqual(1);
  });

  it("heroMotif 确定性 + 用该方向确切强调色 + 内联 SVG 无外链", () => {
    const m1 = heroMotif(design.art, 7);
    const m2 = heroMotif(design.art, 7);
    expect(m1).toBe(m2); // 同输入同输出
    expect(m1).toContain(design.art.accent); // 用方向确切色
    expect(m1).toContain("<svg");
    expect(/(?:src|href)\s*=\s*["']https?:\/\//.test(m1)).toBe(false); // 无外链
  });

  it("不同艺术方向 → 不同签名母题", () => {
    const a = heroMotif(getArtDirection("blueprint"), 3);
    const b = heroMotif(getArtDirection("storybook"), 3);
    expect(a).not.toBe(b);
    expect(cornerMotif(getArtDirection("dark_tech"))).not.toBe(cornerMotif(getArtDirection("scoreboard")));
  });

  it("含页型舞台的产物仍恒过安全/反slop 校验", () => {
    expect(validateCoursewareHtml(html).ok).toBe(true);
  });

  it("code 块渲染为终端镜框 + 逐行行号，且过安全校验", () => {
    const codeBlocks: (Block & { id: string })[] = [
      { id: "c", type: "code", lang: "python", code: "def f(x):\n    return x*2", explanation: "翻倍" },
    ];
    const out = renderCoursewareHtml({ title: "t", blocks: codeBlocks, design, variance });
    expect(out).toContain("code-term");
    expect(out).toContain("ct-bar"); // 终端标题栏
    expect((out.match(/class="cl"/g) || []).length).toBe(2); // 两行 → 两个行元素
    expect(validateCoursewareHtml(out).ok).toBe(true);
  });
});

describe("validateCoursewareHtml —— 门禁能抓到问题", () => {
  it("缺 CSP / 外链 / 廉价字体 / 硬黑投影 都被拦", () => {
    expect(validateCoursewareHtml("<html><body>hi</body></html>").ok).toBe(false);
    const bad =
      `<!doctype html><meta http-equiv="Content-Security-Policy" content="connect-src 'none'">` +
      `<style>@media (prefers-reduced-motion: reduce){} body{font-family:Inter} .c{box-shadow:0 2px 8px rgba(0,0,0,0.3)}</style>` +
      `<img src="https://evil.com/x.png">`;
    const r = validateCoursewareHtml(bad);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes("外链"))).toBe(true);
    expect(r.issues.some((i) => i.includes("字体"))).toBe(true);
    expect(r.issues.some((i) => i.includes("投影"))).toBe(true);
  });
});

describe("enforceTrustedCsp —— LLM 产物强制注入可信 CSP（不信任模型自带 CSP）", () => {
  it("剥离模型放宽的 CSP，注入我方受限 CSP 作 head 第一个元素", () => {
    const evil =
      `<!doctype html><html><head>` +
      `<meta http-equiv="Content-Security-Policy" content="default-src *; img-src *; connect-src 'none'">` +
      `<title>x</title></head><body>hi</body></html>`;
    const safe = enforceTrustedCsp(evil);
    // 模型那条放宽 CSP（default-src *）被剥离
    expect(safe).not.toContain("default-src *");
    // 我方可信 CSP 存在
    expect(safe).toContain(CSP_META);
    // 且紧跟 <head>（第一个元素）
    expect(/<head[^>]*>\s*<meta http-equiv="Content-Security-Policy"/i.test(safe)).toBe(true);
  });

  it("协议相对外链(//host)也被校验拦下（防 img/JS 外带信道）", () => {
    const withProtoRel =
      `<!doctype html><head>${CSP_META}<style>@media (prefers-reduced-motion: reduce){}</style></head>` +
      `<body><img src="//evil.com/x.png"></body>`;
    expect(validateCoursewareHtml(withProtoRel).ok).toBe(false);
    expect(validateCoursewareHtml(withProtoRel).issues.some((i) => i.includes("外链"))).toBe(true);
  });
});

describe("buildContract —— 渲染契约", () => {
  it("checksum 为 sha256 前缀、hasScript 恒 true、contractVersion=2（翻页运行时）", () => {
    const c = buildContract("<html></html>");
    expect(c.checksum.startsWith("sha256:")).toBe(true);
    expect(c.hasScript).toBe(true);
    expect(c.renderMode).toBe("sandbox_srcdoc");
    expect(c.contractVersion).toBe(2);
  });
});

describe("翻页运行时（v2）—— 默认翻页、可切滚动、协议齐备", () => {
  const design = resolveCourseDesign({ id: "cc", category: "ai_skill", template: null, designJson: null });
  const variance = resolveLessonVariance("cc", { id: "l1", title: "算清 ROI", sortOrder: 0 }, design);
  const html = renderCoursewareHtml({ title: "算清 ROI", blocks: sampleBlocks(), design, variance });

  it("产物含翻页 CSS（ct-paged/ct-fit/ct-pager）与运行时协议消息", () => {
    expect(html).toContain("body.ct-paged");
    expect(html).toContain("ct-fit");
    expect(html).toContain("ct-pager");
    // 协议：能力宣告 + 页码上报 + 模式/翻页指令监听 + 滚动模式高度上报
    expect(html).toContain("ct-ready");
    expect(html).toContain("ct-page");
    expect(html).toContain("ct-mode");
    expect(html).toContain("ct-nav");
    expect(html).toContain("ct-height");
    // 默认翻页
    expect(html).toContain("setMode('paged')");
  });

  it("翻页运行时仍恒过安全/反slop 校验（无 scroll 监听、无网络调用）", () => {
    const lint = validateCoursewareHtml(html);
    expect(lint.issues).toEqual([]);
    expect(lint.ok).toBe(true);
  });
});
