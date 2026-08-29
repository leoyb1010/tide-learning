import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("笔记写入质量与边界", () => {
  it("编辑正文同步更新 excerpt，并限制自动保存频率", () => {
    const source = readFileSync("src/app/api/notes/[id]/route.ts", "utf8");
    expect(source).toContain("excerpt: buildExcerpt(body.contentMd)");
    expect(source).toContain('assertRateLimit(req, "note_update", 120, 60_000)');
    expect(source).toContain("prisma.$transaction(async (tx)");
    expect(source).toContain("正文类型错误");
  });
  it("附件上传使用严格 base64 和私有文件名", () => {
    const source = readFileSync("src/app/api/notes/attachments/route.ts", "utf8");
    expect(source).toContain("decodeBase64Attachment");
    expect(source).toContain("sanitizeAttachmentFileName");
  });
});
