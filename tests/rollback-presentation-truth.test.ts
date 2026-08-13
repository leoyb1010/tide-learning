import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("课件回滚表现层诚实契约", () => {
  it("后端明确返回需复核与表现层不完整，不宣称自动重排", () => {
    const route = source("src/app/api/lessons/[id]/rollback/route.ts");
    expect(route).toContain("requiresReview: true");
    expect(route).toContain('presentationStatus: "incomplete"');
    expect(route).toContain("本路由不自动重排、不调用 LLM");
  });

  it("前端说明恢复后的真实状态与继续生成的改写风险", () => {
    const manager = source("src/components/CoursewareManager.tsx");
    expect(manager).toContain("已恢复内容版本，课程进入复核");
    expect(manager).toContain("继续生成会让 AI 复核并可能改写");
    expect(manager).not.toContain("回滚后本节课件会重排，学员端即时更新");
    expect(manager).not.toContain('toast("已回滚到该版本"');
  });
});
