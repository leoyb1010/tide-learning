import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("笔记导入配额与安全契约", () => {
  it.each(["src/app/api/notes/import-pdf/route.ts", "src/app/api/notes/import-url/route.ts"])("%s 在最终写入时重新校验免费配额", (path) => {
    const source = readFileSync(path, "utf8");
    expect(source).toContain("prisma.$transaction(async (tx)");
    expect(source).toContain("snapshot.noteFreeLimit");
  });
  it("URL 导入保留同源、限流和 SSRF 保护", () => {
    const source = readFileSync("src/app/api/notes/import-url/route.ts", "utf8");
    expect(source).toContain("assertSameOrigin(req)");
    expect(source).toContain("pinnedAgentFor");
    expect(source).toContain("MAX_REDIRECTS");
  });
});
