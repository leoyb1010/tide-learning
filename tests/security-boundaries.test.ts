import { describe, expect, it } from "vitest";
import { COURSE_PUBLIC_SELECT, LESSON_OUTLINE_SELECT } from "@/lib/course-public-select";
import { normalizeAccountIdentifier } from "@/lib/session";
import { canTransitionDemand } from "@/lib/demand-status";
import { safeInternalPath } from "@/lib/safe-redirect";
import { validateWebhookOrder } from "@/lib/payment";

const PAID_CONTENT_FIELDS = [
  "articleMd",
  "blocksJson",
  "htmlJson",
  "videoUrl",
  "videoAssetId",
  "videoScriptJson",
] as const;

describe("课程公开 DTO 边界", () => {
  it("课程元数据不嵌套 lessons，章节大纲不选择任何付费正文", () => {
    expect(COURSE_PUBLIC_SELECT).not.toHaveProperty("lessons");
    for (const field of PAID_CONTENT_FIELDS) expect(LESSON_OUTLINE_SELECT).not.toHaveProperty(field);
    expect(Object.keys(LESSON_OUTLINE_SELECT).sort()).toEqual(
      ["contentType", "durationSec", "id", "isFree", "sortOrder", "summary", "title"].sort(),
    );
  });
});

describe("站内返回路径与需求状态机", () => {
  it("拒绝外部重定向并保留合法课程学习位置", () => {
    expect(safeInternalPath("/courses/demo/learn/lesson?t=42", "/me")).toBe("/courses/demo/learn/lesson?t=42");
    expect(safeInternalPath("//evil.example/path", "/me")).toBe("/me");
    expect(safeInternalPath("https://evil.example", "/me")).toBe("/me");
  });

  it("只允许需求沿既定状态推进或原状态编辑", () => {
    expect(canTransitionDemand("pending_review", "collecting")).toBe(true);
    expect(canTransitionDemand("producing", "launched")).toBe(true);
    expect(canTransitionDemand("collecting", "launched")).toBe(false);
    expect(canTransitionDemand("rejected", "collecting")).toBe(false);
    expect(canTransitionDemand("scheduled", "scheduled")).toBe(true);
  });
});

describe("账号 identifier 边界", () => {
  it("归一化邮箱、手机号并保留预置用户名", () => {
    expect(normalizeAccountIdentifier(" User@Example.COM ")).toEqual({ kind: "email", value: "user@example.com" });
    expect(normalizeAccountIdentifier("+86 138-0013-8000")).toEqual({ kind: "phone", value: "+8613800138000" });
    expect(normalizeAccountIdentifier("admin")).toEqual({ kind: "username", value: "admin" });
  });
});

describe("支付回调对账边界", () => {
  const order = { channel: "stripe", amountCents: 4990, currency: "CNY" };

  it("只放行同渠道、同金额、同币种", () => {
    expect(() => validateWebhookOrder("stripe", { amountCents: 4990, currency: "cny" }, order)).not.toThrow();
  });

  it("拒绝跨渠道、小额/负额/非整数金额和错币种", () => {
    expect(() => validateWebhookOrder("mock", { amountCents: 4990, currency: "CNY" }, order)).toThrow(/渠道/);
    expect(() => validateWebhookOrder("stripe", { amountCents: 1, currency: "CNY" }, order)).toThrow(/金额/);
    expect(() => validateWebhookOrder("stripe", { amountCents: -1, currency: "CNY" }, order)).toThrow(/金额/);
    expect(() => validateWebhookOrder("stripe", { amountCents: 4990.5, currency: "CNY" }, order)).toThrow(/金额/);
    expect(() => validateWebhookOrder("stripe", { amountCents: 4990, currency: "USD" }, order)).toThrow(/币种/);
  });
});
