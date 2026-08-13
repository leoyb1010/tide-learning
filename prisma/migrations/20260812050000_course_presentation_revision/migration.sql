-- Fence concurrent theme / HTML presentation mutations. A stale operation may
-- finish its provider call, but cannot overwrite lessons or restore Course.ready.
ALTER TABLE "Course" ADD COLUMN "presentationRevision" INTEGER NOT NULL DEFAULT 0;
