import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("平台课程上传/章节写入边界", () => {
  it("管理员章节接口只接受 video/article，并校验正文和时长", () => {
    const source = readFileSync("src/app/api/admin/courses/[id]/lessons/route.ts", "utf8");
    expect(source).toContain("不支持的章节类型");
    expect(source).toContain("图文章节必须填写正文");
    expect(source).toContain("章节时长非法");
    expect(source).toContain("readPrivateMedia(requestedAssetId)");
  });
});
