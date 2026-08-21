import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("商业化运营健康诊断", () => {
  it("管理员 AI 诊断同时暴露费用/积分/生成积压", () => {
    const source = readFileSync("src/app/api/admin/ai/diagnostics/route.ts", "utf8");
    for (const key of ["pendingBillingReconciliations", "expiredActiveReservations", "negativeCreditAccounts", "runningGenerationJobs", "failedCourses", "operationalHealth"]) {
      expect(source).toContain(key);
    }
  });
});
