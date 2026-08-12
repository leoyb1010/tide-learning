-- Durable, privacy-minimized audit trail for provider attempts whose usage cannot be proven locally.
CREATE TABLE "LlmBillingReconciliation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reservationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scene" TEXT NOT NULL,
    "attemptKey" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "providerStatus" INTEGER,
    "providerRequestId" TEXT,
    "usageJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME
);

CREATE UNIQUE INDEX "LlmBillingReconciliation_reservationId_key"
ON "LlmBillingReconciliation"("reservationId");

CREATE UNIQUE INDEX "LlmBillingReconciliation_attemptKey_key"
ON "LlmBillingReconciliation"("attemptKey");

CREATE INDEX "LlmBillingReconciliation_status_createdAt_idx"
ON "LlmBillingReconciliation"("status", "createdAt");

CREATE INDEX "LlmBillingReconciliation_userId_createdAt_idx"
ON "LlmBillingReconciliation"("userId", "createdAt");
