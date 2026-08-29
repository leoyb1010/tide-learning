import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const WRITE_ROUTES = [
  "src/app/api/auth/login/route.ts",
  "src/app/api/auth/signup/route.ts",
  "src/app/api/auth/logout/route.ts",
  "src/app/api/auth/password-reset/route.ts",
  "src/app/api/auth/password-reset/confirm/route.ts",
  "src/app/api/analytics/route.ts",
] as const;

describe("browser-facing unauthenticated write routes", () => {
  it.each(WRITE_ROUTES)("%s enforces the shared same-origin boundary", (path) => {
    const source = readFileSync(path, "utf8");
    expect(source).toContain("assertSameOrigin(req);");
  });
});
