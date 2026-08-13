-- LLM 积分预占/结算。新表承载冻结状态；历史 LlmUsage 仅追加 nullable 字段，无需回填或重建。
CREATE TABLE "CreditReservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reservationKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scene" TEXT NOT NULL,
    "estimatedCredits" INTEGER NOT NULL,
    "remainingCredits" INTEGER NOT NULL,
    "actualCredits" INTEGER NOT NULL DEFAULT 0,
    "maxAdditionalCredits" INTEGER NOT NULL DEFAULT 0,
    "additionalCredits" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expiresAt" DATETIME NOT NULL,
    "settledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CreditReservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "LlmUsage" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "LlmUsage" ADD COLUMN "reservationId" TEXT REFERENCES "CreditReservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "CreditReservation_reservationKey_key" ON "CreditReservation"("reservationKey");
CREATE INDEX "CreditReservation_userId_status_idx" ON "CreditReservation"("userId", "status");
CREATE INDEX "CreditReservation_status_expiresAt_idx" ON "CreditReservation"("status", "expiresAt");
-- SQLite UNIQUE 允许多个 NULL：历史/普通 LLM usage 兼容，预占路径的非空幂等键受数据库强制。
CREATE UNIQUE INDEX "LlmUsage_idempotencyKey_key" ON "LlmUsage"("idempotencyKey");
CREATE INDEX "LlmUsage_reservationId_idx" ON "LlmUsage"("reservationId");
