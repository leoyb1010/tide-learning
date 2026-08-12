-- 用户可见的一次 AI 操作可产生多笔 LLM 预占。
-- 操作未交付时整组冲正；墓碑用于阻断冲正后迟到的新预占。
ALTER TABLE "CreditReservation" ADD COLUMN "operationKey" TEXT;
ALTER TABLE "CreditReservation" ADD COLUMN "reversedAt" DATETIME;

CREATE TABLE "LlmBillingOperationReversal" (
    "operationKey" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "scene" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "CreditReservation_operationKey_status_idx"
    ON "CreditReservation"("operationKey", "status");
CREATE INDEX "LlmBillingOperationReversal_userId_createdAt_idx"
    ON "LlmBillingOperationReversal"("userId", "createdAt");
