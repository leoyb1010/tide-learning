import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = () => readFileSync("src/app/api/admin/billing/reconciliation/route.ts", "utf8");

describe("billing reconciliation admin contract", () => {
  it("is finance-gated and CSRF-protected for mutations", () => {
    const source = route();
    expect(source).toContain('requirePermission("order:refund")');
    expect(source).toContain("assertSameOrigin(req)");
    expect(source).toContain('status !== "resolved" && status !== "waived"');
    expect(source).toContain("reason.length < 8");
    expect(source).toContain("audit({");
  });

  it("never deletes pending records and rejects repeat processing", () => {
    const source = route();
    expect(source).not.toContain("delete({ where: { id }");
    expect(source).toContain('current.status !== "pending"');
    expect(source).toContain('return fail("该对账记录已经处理", 409)');
  });
});
