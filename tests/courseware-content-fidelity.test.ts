import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateBlocks } from "@/lib/blocks";
import {
  assessBespokeContentSafety,
  assessFinalCoursewareContent,
} from "@/lib/ai/courseware-gen";

function concept(markdown: string) {
  return validateBlocks([{ type: "concept", title: "概念", markdown }]);
}

describe("LLM HTML is presentation, not a second content author", () => {
  it.each([
    "截至 2026-08-12 的当前 API 价格",
    "药物用量与医疗治疗建议",
    "Current legal advice and tax rates as of 2026-08-12",
    "Current stock investment advice",
  ])("来源敏感 blocks 不调用可自由改写正文的视觉模型: %s", (text) => {
    expect(assessBespokeContentSafety({ blocks: concept(text), category: "ai_skill" }))
      .toEqual({ eligible: false, reason: "source_sensitive_deterministic_only" });
  });

  it("过长 blocks 不截断前半再冒充完整课件", () => {
    const longBlocks = validateBlocks(Array.from({ length: 30 }, (_, index) => ({
      type: "concept",
      title: `概念 ${index + 1}`,
      markdown: `稳定基础内容 ${index + 1} ` + "详细解释".repeat(250),
    })));
    expect(assessBespokeContentSafety({
      blocks: longBlocks,
      maxInputChars: 12_000,
    })).toEqual({ eligible: false, reason: "blocks_exceed_bespoke_input_cap" });
  });

  it("普通 blocks 允许原创布局，但 HTML 新增快变/高风险断言必须回落", () => {
    const blocks = concept("闭包是函数与其词法环境的组合。");
    expect(assessBespokeContentSafety({
      blocks,
      html: "<!doctype html><html><body><h1>闭包</h1><p>用于保留状态。</p></body></html>",
    }).eligible).toBe(true);

    expect(assessBespokeContentSafety({
      blocks,
      html: "<!doctype html><html><body><h1>闭包</h1><p>当前药价和具体用药建议</p></body></html>",
    })).toEqual({ eligible: false, reason: "bespoke_html_added_sensitive_claim" });
  });

  it("不把会在落库前被剥离的模型 script/style 当可见课程文本", () => {
    expect(assessBespokeContentSafety({
      blocks: concept("稳定基础概念"),
      html: "<html><head><style>.current-price{color:red}</style></head><body>基础概念<script>const note='当前药价';</script></body></html>",
    }).eligible).toBe(true);
  });

  it("禁止伪元素的非空 CSS content，并解码 CSS 属性名转义", () => {
    const blocks = concept("稳定基础概念");
    expect(assessFinalCoursewareContent({
      blocks,
      html: '<html><head><style>body::before{content:"当前药价与用药建议"}</style></head><body>基础概念</body></html>',
    })).toEqual({ eligible: false, reason: "bespoke_html_nonempty_css_content" });

    expect(assessFinalCoursewareContent({
      blocks,
      html: '<html><head><style>body::before{c\\6f ntent:"\\5f53 \\524d \\836f \\4ef7"}</style></head><body>基础概念</body></html>',
    })).toEqual({ eligible: false, reason: "bespoke_html_nonempty_css_content" });

    expect(assessFinalCoursewareContent({
      blocks,
      html: '<html><body><span style="c&#x6f;ntent:\'attr(data-note)\'">基础概念</span></body></html>',
    })).toEqual({ eligible: false, reason: "bespoke_html_nonempty_css_content" });
  });

  it("仍允许不生成文本的空 content 装饰", () => {
    expect(assessFinalCoursewareContent({
      blocks: concept("稳定基础概念"),
      html: '<html><head><style>body::before{content:""}.x::after{content:normal!important}</style></head><body>基础概念</body></html>',
    })).toEqual({ eligible: true, reason: "" });
  });

  it.each([
    '<html><head><style>@counter-style risky{system:cyclic;symbols:"当前药价";suffix:" "}ul{list-style:risky}</style></head><body><ul><li>基础概念</li></ul></body></html>',
    '<html><head><style>li{list-style-type:"当前股票投资建议"}</style></head><body><ol><li>基础概念</li></ol></body></html>',
    '<html><head><style>q{quotes:"当前法律建议" "当前税率"}</style></head><body><q>基础概念</q></body></html>',
  ])("CSS 其他文本生成机制也必须 fail closed", (html) => {
    expect(assessFinalCoursewareContent({ blocks: concept("稳定基础概念"), html }))
      .toEqual({ eligible: false, reason: "bespoke_html_css_generated_text" });
  });

  it("JS 被禁用时会显示的 noscript 属于可感知文本", () => {
    expect(assessFinalCoursewareContent({
      blocks: concept("稳定基础概念"),
      html: '<html><body>基础概念<noscript>当前药价与用药建议</noscript></body></html>',
    })).toEqual({ eligible: false, reason: "bespoke_html_added_sensitive_claim" });
  });

  it("保留常规列表关键字、默认 quotes 与安全 noscript", () => {
    expect(assessFinalCoursewareContent({
      blocks: concept("稳定基础概念"),
      html: '<html><head><style>ol{list-style-type:decimal}ul{list-style:none inside}.quiet{list-style-type:""}q{quotes:auto}.mark::before{content:""}</style></head><body><ol><li>基础概念</li></ol><noscript>离线时仍可阅读基础概念</noscript></body></html>',
    })).toEqual({ eligible: true, reason: "" });
  });

  it("把 alt/aria/title 属性当成用户可感知文本，包括 HTML 实体解码", () => {
    const blocks = concept("稳定基础概念");
    for (const html of [
      '<html><body><img alt="药物用量和医疗治疗建议"></body></html>',
      '<html><body><div aria-label="Current stock investment advice">基础概念</div></body></html>',
      '<html><body><span title="&#x7528;&#x836F;建议">基础概念</span></body></html>',
      '<html><body><input value="当前药价与用药建议"></body></html>',
      '<html><body><input placeholder="Current legal advice"></body></html>',
    ]) {
      expect(assessFinalCoursewareContent({ blocks, html }))
        .toEqual({ eligible: false, reason: "bespoke_html_added_sensitive_claim" });
    }
  });

  it("option/optgroup 优先显示的 label 属性也是可感知文本", () => {
    const blocks = concept("稳定基础概念");
    expect(assessFinalCoursewareContent({
      blocks,
      html: '<html><body><select><optgroup label="当前药价"><option label="当前股票投资建议">基础</option></optgroup></select></body></html>',
    })).toEqual({ eligible: false, reason: "bespoke_html_added_sensitive_claim" });

    expect(assessFinalCoursewareContent({
      blocks,
      html: '<html><body><select><optgroup label="练习类型"><option label="基础练习">基础</option></optgroup></select></body></html>',
    })).toEqual({ eligible: true, reason: "" });
  });

  it("检查点击后会被可信 adapter 写入页面的 data-ct-feedback", () => {
    const blocks = concept("稳定基础概念");
    const html = '<html><body><div class="ct-route-card"><button data-ct-target="lesson-2" data-ct-feedback="&#x5F53;&#x524D;&#x836F;&#x4EF7;与用药建议">继续</button><p class="ct-route-feedback" hidden></p></div></body></html>';
    expect(assessFinalCoursewareContent({ blocks, html }))
      .toEqual({ eligible: false, reason: "bespoke_html_added_sensitive_claim" });

    expect(assessFinalCoursewareContent({
      blocks,
      html: '<html><body><div class="ct-route-card"><button data-ct-target="lesson-2" data-ct-feedback="已完成练习">继续</button><p class="ct-route-feedback" hidden></p></div></body></html>',
    })).toEqual({ eligible: true, reason: "" });
  });

  it("禁止 bespoke data URI 的 SVG 文本旁路", () => {
    const blocks = concept("稳定基础概念");
    const encodedSvg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><text>当前药价</text></svg>');
    const base64Svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>Current stock advice</text></svg>')
      .toString("base64");
    for (const html of [
      '<html><body><img src="data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\'><text>当前药价</text></svg>" alt="装饰"></body></html>',
      `<html><body><img src="data:image/svg+xml,${encodedSvg}" alt="装饰"></body></html>`,
      `<html><body><img src="data:image/svg+xml;base64,${base64Svg}" alt="装饰"></body></html>`,
      `<html><body><img src="da&#10;ta&colon;image/svg+xml;base64,${base64Svg}" alt="装饰"></body></html>`,
      `<html><head><style>body{background-image:url("data:image/svg+xml,${encodedSvg}")}</style></head><body>基础概念</body></html>`,
    ]) {
      expect(assessFinalCoursewareContent({ blocks, html }))
        .toEqual({ eligible: false, reason: "bespoke_html_data_uri" });
    }
  });

  it("资源属性、CSS url 与 @import 统一拒绝 blob/外部/协议相对 URL", () => {
    const blocks = concept("稳定基础概念");
    for (const html of [
      '<html><body><img src="blob:https://example.com/asset" alt="图"></body></html>',
      '<html><body><img src="https://evil.example/claim.svg" alt="图"></body></html>',
      '<html><body><img src="//evil.example/claim.svg" alt="图"></body></html>',
      '<html><head><style>.x{background:url(blob:https://example.com/asset)}</style></head><body class="x">基础</body></html>',
      '<html><head><style>.x{background:url(https://evil.example/claim.svg)}</style></head><body class="x">基础</body></html>',
      '<html><head><style>@import "https://evil.example/style.css";</style></head><body>基础</body></html>',
    ]) {
      expect(assessFinalCoursewareContent({ blocks, html }))
        .toEqual({ eligible: false, reason: "bespoke_html_forbidden_resource" });
    }
  });

  it("资源白名单保留站内素材、片段锚点和明确静态相对文件", () => {
    expect(assessFinalCoursewareContent({
      blocks: concept("稳定基础概念"),
      html: '<html><head><style>.x{background-image:url("./texture.webp");filter:url(#soften)}</style></head><body><svg><filter id="soften"></filter><use href="#shape"/></svg><img src="/api/assets/cmrtestasset123" alt="概念图"><img src="/courseware/grid.svg" alt="网格"></body></html>',
    })).toEqual({ eligible: true, reason: "" });
  });

  it("保留内联 SVG 和站内素材路径", () => {
    const blocks = concept("稳定基础概念");
    expect(assessFinalCoursewareContent({
      blocks,
      html: '<html><body><svg viewBox="0 0 20 20" aria-label="概念图"><circle cx="10" cy="10" r="8"/></svg><img src="/api/assets/asset-1" alt="概念图"></body></html>',
    })).toEqual({ eligible: true, reason: "" });
  });

  it("LLM bespoke 禁止 SVG SMIL 动态改写资源属性", () => {
    const payload = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><text>当前药价</text></svg>');
    expect(assessFinalCoursewareContent({
      blocks: concept("稳定基础概念"),
      html: `<html><body><svg><image href="/api/assets/asset-1"><set attributeName="href" to="data:image/svg+xml,${payload}"/></image></svg></body></html>`,
    })).toEqual({ eligible: false, reason: "bespoke_html_svg_smil" });

    expect(assessFinalCoursewareContent({
      blocks: concept("稳定基础概念"),
      html: '<html><head><style>.dot{animation:pulse 1s infinite}@keyframes pulse{50%{opacity:.5}}</style></head><body><svg><circle class="dot" cx="10" cy="10" r="8"/></svg></body></html>',
    })).toEqual({ eligible: true, reason: "" });
  });

  it("LLM bespoke 完全禁止 template，阻断 Declarative Shadow DOM 可见内容旁路", () => {
    const blocks = concept("稳定基础概念");
    for (const html of [
      '<html><body><div><template shadowrootmode="open"><p>当前药价与用药建议</p></template></div></body></html>',
      '<html><body><template><p>稳定的备用内容</p></template></body></html>',
    ]) {
      expect(assessFinalCoursewareContent({ blocks, html }))
        .toEqual({ eligible: false, reason: "bespoke_html_template" });
    }

    expect(assessFinalCoursewareContent({
      blocks,
      html: '<html><body><section><p>稳定的普通课程内容</p></section></body></html>',
    })).toEqual({ eligible: true, reason: "" });
  });

  it("缓存快返、旧 HTML 复用、新生成和落库前共用同一终检", () => {
    const source = readFileSync("src/lib/ai/courseware-gen.ts", "utf8");
    const cachePath = source.slice(
      source.indexOf("const cacheSatisfiesRequest"),
      source.indexOf("const staleBefore"),
    );
    const reusePath = source.slice(
      source.indexOf("复用已经带逐节原创 token"),
      source.indexOf("if (opts.enhance && bespokeContentEligible && engine !== \"llm\""),
    );
    const newGenerationPath = source.slice(
      source.indexOf("for (let attempt = 0; attempt < 4"),
      source.indexOf("if (engine !== \"llm\")"),
    );
    const preStorePath = source.slice(
      source.indexOf("最后一道防线紧挨 buildContract"),
      source.indexOf("const contract = buildContract(html)"),
    );

    for (const path of [cachePath, reusePath, newGenerationPath, preStorePath]) {
      expect(path).toContain("assessFinalCoursewareContent({");
    }
    expect(cachePath.indexOf("assessFinalCoursewareContent({"))
      .toBeLessThan(cachePath.indexOf("cacheHit: true"));
    expect(newGenerationPath.indexOf("assessFinalCoursewareContent({"))
      .toBeLessThan(newGenerationPath.indexOf("judgeCoursewareDesign({"));
  });
});
