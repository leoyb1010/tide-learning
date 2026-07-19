import { describe, it, expect } from "vitest";
import { hetiSpacing } from "@/lib/cjk-spacing";

/**
 * heti CJK⇄半角间距（标签感知）—— 锁死：只碰文本、跳过标签/脚本/代码、幂等。
 */

describe("hetiSpacing —— 基本插入", () => {
  it("中文后接英文 → 插入间距 span", () => {
    expect(hetiSpacing("学习English")).toBe('学习<span class="hs"></span>English');
  });
  it("英文后接中文 → 插入间距 span", () => {
    expect(hetiSpacing("Python课程")).toBe('Python<span class="hs"></span>课程');
  });
  it("中文后接数字 / 数字后接中文", () => {
    expect(hetiSpacing("共89节")).toBe('共<span class="hs"></span>89<span class="hs"></span>节');
  });
  it("纯中文 / 纯英文不插入", () => {
    expect(hetiSpacing("学习课程")).toBe("学习课程");
    expect(hetiSpacing("hello world")).toBe("hello world");
  });
});

describe("hetiSpacing —— 标签感知", () => {
  it("不在标签内部插入（属性含 CJK+alnum 不触发）", () => {
    const h = '<div class="a1">学习abc</div>';
    expect(hetiSpacing(h)).toBe('<div class="a1">学习<span class="hs"></span>abc</div>');
  });
  it("跳过 <script> 内容", () => {
    const h = '<script>var 学习="abc123"</script>后文A';
    const out = hetiSpacing(h);
    expect(out).toContain('<script>var 学习="abc123"</script>');
    expect(out).toBe('<script>var 学习="abc123"</script>后文<span class="hs"></span>A');
  });
  it("跳过 <style> 内容", () => {
    const h = "<style>.x{a:1}</style>共5个";
    expect(hetiSpacing(h)).toBe('<style>.x{a:1}</style>共<span class="hs"></span>5<span class="hs"></span>个');
  });
  it("跳过 <pre>/<code> 代码块（等宽不加间距）", () => {
    const h = "<pre><code>中文abc</code></pre>正文X";
    const out = hetiSpacing(h);
    expect(out).toContain("<pre><code>中文abc</code></pre>");
    expect(out).toBe('<pre><code>中文abc</code></pre>正文<span class="hs"></span>X');
  });
});

describe("hetiSpacing —— 幂等", () => {
  it("二次处理不重复插入", () => {
    const once = hetiSpacing("学习English");
    const twice = hetiSpacing(once);
    expect(twice).toBe(once);
  });
  it("空/无边界输入原样", () => {
    expect(hetiSpacing("")).toBe("");
    expect(hetiSpacing("！？。")).toBe("！？。");
  });
});
