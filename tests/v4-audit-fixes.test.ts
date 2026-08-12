import { describe, it, expect } from "vitest";
import { validateBlocks } from "@/lib/blocks";
import {
  splitCoursewareLint,
  normalizeCoursewareStyle,
  injectBespokeAdapter,
  sanitizeBespokeHtml,
  scoreCoursewareVisual,
} from "@/lib/ai/courseware-html";
import { scanContentSafety } from "@/lib/content-safety";
import { illustrationSvg, pickIllustrationKind } from "@/lib/ai/courseware-illustrations";
import { getArtDirection } from "@/lib/ai/courseware-design";

/**
 * v4 审计修复回归测试——锁死本轮修掉的缺陷,防再次回归。
 */

describe("块 id 确定性(审计修复:D2 错题转卡依赖稳定 id)", () => {
  const raw = [
    { type: "quiz", question: "1+1?", options: ["1", "2"], answerIndex: 1, explain: "二" },
    { type: "concept", title: "标题", markdown: "正文" },
  ];

  it("同一输入多次 validate 得到相同 id(此前带 Math.random 后缀每次都变)", () => {
    const a = validateBlocks(raw).map((b) => b.id);
    const b = validateBlocks(raw).map((b) => b.id);
    expect(a).toEqual(b);
    expect(a[0]).toBe("blk_0");
  });

  it("已带合法 id 的块(存量 blocksJson)原样保留 id", () => {
    const withId = [{ id: "blk_0_przdfc", type: "concept", title: "t", markdown: "m" }];
    expect(validateBlocks(withId)[0].id).toBe("blk_0_przdfc");
  });

  it("非法 id 回落纯序号", () => {
    const bad = [{ id: "has space!", type: "concept", title: "t", markdown: "m" }];
    expect(validateBlocks(bad)[0].id).toBe("blk_0");
  });
});

describe("QC 分级(审计修复:性能硬伤不放行 / 正文纯黑不误伤)", () => {
  const base =
    '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; connect-src \'none\'">' +
    "<style>@media (prefers-reduced-motion:reduce){*{animation:none}}</style></head><body>";

  it("scroll 监听归入拒收桶(security),不再只记录", () => {
    const h = base + "<script>window.addEventListener('scroll',function(){})</script></body></html>";
    expect(splitCoursewareLint(h).security).toContain("用了 scroll 监听(性能杀手)");
  });

  it("layout 属性动画归入拒收桶", () => {
    const h = base + "<style>@keyframes x{from{left:0}to{left:9px}}</style></body></html>";
    expect(splitCoursewareLint(h).security.some((s) => s.includes("layout"))).toBe(true);
  });

  it("正文色 rgba(0,0,0,.85) 不判硬黑投影(只认 shadow 声明)", () => {
    const h = base + '<p style="color:rgba(0,0,0,.85)">正文</p></body></html>';
    expect(splitCoursewareLint(h).style.some((s) => s.includes("硬黑投影"))).toBe(false);
  });

  it("box-shadow 纯黑仍判违规", () => {
    const h = base + '<div style="box-shadow:0 2px 8px rgba(0,0,0,.3)">卡</div></body></html>';
    expect(splitCoursewareLint(h).style.some((s) => s.includes("硬黑投影"))).toBe(true);
  });
});

describe("normalizeCoursewareStyle(v6:只补安全降级,不改原创风格)", () => {
  it("正文色 rgba(0,0,0,.85) 不被改写", () => {
    const h = '<p style="color:rgba(0,0,0,.85)">x</p>';
    expect(normalizeCoursewareStyle(h).html).toContain("rgba(0,0,0,.85)");
  });

  it("box-shadow 不再被平台改成统一色", () => {
    const { html, fixes } = normalizeCoursewareStyle('<div style="box-shadow:0 2px 8px rgba(0,0,0,.3)">x</div>');
    expect(html).toContain("rgba(0,0,0,.3)");
    expect(fixes).toEqual(["注入 reduce-motion 降级"]);
  });

  it("缺 reduce-motion 时只注入无障碍降级", () => {
    const { html, fixes } = normalizeCoursewareStyle("<html><head></head><body>x</body></html>");
    expect(html).toContain("prefers-reduced-motion");
    expect(fixes).toEqual(["注入 reduce-motion 降级"]);
  });
});

describe("协议壳注入(A5)", () => {
  it("幂等:重复注入只有一份适配器", () => {
    const once = injectBespokeAdapter("<body>x</body>");
    const twice = injectBespokeAdapter(once);
    expect((twice.match(/data-ct-bespoke-adapter/g) || []).length).toBe(1);
  });

  it("bespoke 明确声明长滚动能力，不冒充翻页协议", () => {
    const html = injectBespokeAdapter("<body>x</body>");
    expect(html).toContain("ct-scroll-ready");
    expect(html).toContain("ct-height");
    expect(html).not.toContain("type:'ct-ready'");
  });

  it("bespoke 判分 UI 不信任模型 data-answer，只消费宿主 ct-quiz-result", () => {
    const html = injectBespokeAdapter('<body><div class="quiz" data-answer="0" data-bid="q1"><button class="opt">A</button><button class="opt">B</button></div></body>');
    expect(html).toContain("ct-quiz-result");
    expect(html).toContain("correctAnswerIndex");
    expect(html).not.toContain("getAttribute('data-answer')");
  });

  it("存量 v1 适配器会被替换为 v2，而不是因旧标记被跳过", () => {
    const old = '<body>x<script data-ct-bespoke-adapter>window.__ctBespokeAdapter=true;</script></body>';
    const html = injectBespokeAdapter(old);
    expect(html).toContain('data-ct-bespoke-adapter="2"');
    expect(html).toContain("__ctBespokeAdapterV2");
    expect(html).not.toContain("window.__ctBespokeAdapter=true");
    expect((html.match(/data-ct-bespoke-adapter/g) || []).length).toBe(1);
  });

  it("历史恶意 LLM HTML 的自发平台消息/内联事件被清空，只剩可信 adapter", () => {
    const hostile = `<!doctype html><html><head>
      <meta http-equiv="refresh" content="0;url=javascript:alert(1)">
      <script>window.__evil=1;parent.postMessage({type:'ct-page',index:999,total:1},'*')</script>
      </head><body onload="parent.postMessage({type:'ct-complete'},'*')">
      <iframe srcdoc="<script>parent.postMessage({type:'ct-quiz'},'*')</script>"></iframe>
      <a href="jav&#x61;script:alert(1)">链接</a><button onclick="window.__evil=2">点击</button>
      <section data-ct-target="lesson_ok">声明式交互</section></body></html>`;
    const sanitized = sanitizeBespokeHtml(hostile);
    expect(sanitized).not.toMatch(/<script\b/i);
    expect(sanitized).not.toMatch(/\sonload=|\sonclick=|\ssrcdoc=|\shref=/i);
    expect(sanitized).not.toMatch(/<(?:iframe|meta\b[^>]*http-equiv)/i);

    const injected = injectBespokeAdapter(hostile);
    expect(injected).not.toContain("window.__evil");
    expect(injected).not.toContain("type:'ct-page'");
    expect((injected.match(/<script\b/g) || []).length).toBe(1);
    expect((injected.match(/data-ct-bespoke-adapter/g) || []).length).toBe(1);
    expect(injected).toContain('data-ct-target="lesson_ok"');
  });

  it("读路径可只给平台 adapter 注入响应级 CSP nonce", () => {
    const nonce = "abcdefghijklmnop12345678";
    const injected = injectBespokeAdapter("<body><script>window.evil=1</script>x</body>", nonce);
    expect(injected).not.toContain("window.evil");
    expect(injected).toContain(`<script nonce="${nonce}" data-ct-bespoke-adapter="2">`);
    expect((injected.match(/\bnonce=/g) || []).length).toBe(1);
  });
});

describe("内容安全层(C4)", () => {
  it("违法内容 block 级", () => {
    expect(scanContentSafety("教你自制炸弹").level).toBe("block");
  });
  it("违规承诺 review 级", () => {
    expect(scanContentSafety("本课带你稳赚不赔").level).toBe("review");
  });
  it("正常学习内容 ok", () => {
    expect(scanContentSafety("本节讲解函数与递归的区别").level).toBe("ok");
  });
});

describe("确定性插图(B4)", () => {
  it("caption 关键词路由到对应插图族", () => {
    expect(pickIllustrationKind("三步流程", 0)).toBe("flow");
    expect(pickIllustrationKind("各项占比", 0)).toBe("ratio");
    expect(pickIllustrationKind("数据对比", 0)).toBe("bars");
  });
  it("产出自包含 SVG,无外链资源(xmlns 命名空间不算)", () => {
    const svg = illustrationSvg(getArtDirection("dev_terminal"), 7, "关系结构");
    expect(svg).toMatch(/^<svg /);
    // 只禁真正的外链加载:src=/href=/url( 指向 http;xmlns 命名空间 URI 合法。
    expect(svg).not.toMatch(/(?:src|href)\s*=\s*["']https?:|url\(\s*["']?https?:/i);
  });
  it("同输入确定性可复现", () => {
    const a = illustrationSvg(getArtDirection("storybook"), 3, "流程");
    const b = illustrationSvg(getArtDirection("storybook"), 3, "流程");
    expect(a).toBe(b);
  });
});

describe("视觉高级分(C2)", () => {
  it("纯文字墙低分、含分区+图形高分", () => {
    const wall = "<body>" + "<p>纯文字</p>".repeat(3) + "</body>";
    const rich =
      "<body>" +
      Array.from({ length: 6 }, (_, i) => `<section style="background:#${i}${i}${i}">区块${i} 内容内容内容内容</section>`).join("") +
      "<svg></svg></body>";
    expect(scoreCoursewareVisual(rich).score).toBeGreaterThan(scoreCoursewareVisual(wall).score);
  });
});
