import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("管理员商业化运营看板", () => {
  it("直接展示费用对账、预占、负余额、任务和失败课程", () => {
    const source = readFileSync("src/app/admin/page.tsx", "utf8");
    for (const label of ["待对账费用", "过期预占", "负余额账户", "运行中任务", "失败课程", "运营健康"]) expect(source).toContain(label);
  });
});
