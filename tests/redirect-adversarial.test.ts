import { describe, expect, it } from "vitest";
import { safeInternalPath } from "@/lib/safe-redirect";
describe("same-origin navigation", () => {
  it.each(["/\\evil.example", "/\t/evil.example", "/\n/evil.example", "//evil.example", "https://evil.example"])('rejects browser-normalized external path %j', value => {
    expect(safeInternalPath(value, "/me")).toBe("/me");
  });
  it("preserves legitimate path, query and hash", () => {
    expect(safeInternalPath("/courses/a?next=%2Fdesk#chapter", "/me")).toBe("/courses/a?next=%2Fdesk#chapter");
  });
});
