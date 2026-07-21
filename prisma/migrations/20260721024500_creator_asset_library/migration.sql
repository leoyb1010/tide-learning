CREATE TABLE "Asset" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "storagePath" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Asset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Asset_storagePath_key" ON "Asset"("storagePath");
CREATE INDEX "Asset_userId_kind_createdAt_idx" ON "Asset"("userId", "kind", "createdAt");
CREATE INDEX "Asset_userId_fileName_idx" ON "Asset"("userId", "fileName");
