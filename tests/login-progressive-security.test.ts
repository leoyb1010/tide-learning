import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("登录页 hydration 前凭据保护", () => {
  it("SSR 表单只允许同源 POST，且 hydration 前禁用提交", () => {
    const page = readFileSync("src/app/login/page.tsx", "utf8");
    expect(page).toContain('method="post" action="/api/auth/login"');
    expect(page).toContain("useEffect(() => setHydrated(true), [])");
    expect(page).toContain("disabled={!hydrated || loading}");
    expect(page).not.toContain('<form onSubmit={submit}');
  });
});
