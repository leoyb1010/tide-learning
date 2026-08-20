import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("复习数据分页边界", () => {
  it("错题本拒绝非法游标，不把错误请求伪装成空列表", () => {
    const source = readFileSync("src/app/api/me/mistakes/route.ts", "utf8");
    expect(source).toContain("分页游标非法");
    expect(source).toContain("^[A-Za-z0-9_-]{8,100}$");
  });
});
