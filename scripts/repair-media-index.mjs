#!/usr/bin/env node
/* Reconcile known seed/private media files with lesson rows after a stale DB restore. */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const apply = process.argv.includes("--apply");
const isProduction = process.env.NODE_ENV === "production";
if (isProduction && !apply) {
  console.error("Refusing production repair without --apply");
  process.exit(2);
}

const root = process.env.MEDIA_ROOT || path.join(process.cwd(), ".data", "media");
const mappings = [
  ["oral-smallclass-001", 0, "media_1e7a9d54-14cc-4ce9-88bd-3d50615ecfe1"],
  ["silver-oral-003", 0, "media_29d71cfb-eb76-42c1-818e-f74d1d1026a5"],
  ["ai-office-005", 0, "media_39264f0d-d25c-49d9-a236-b25d76ec0aec"],
  ["anti-fraud-007", 0, "media_5e7cc35d-a461-426a-b293-4c5c36043194"],
];

const prisma = new PrismaClient();
const report = [];
try {
  for (const [slug, sortOrder, assetId] of mappings) {
    const manifestPath = path.join(root, `${assetId}.json`);
    const binaryPath = path.join(root, `${assetId}.bin`);
    const lesson = await prisma.lesson.findFirst({ where: { course: { slug }, sortOrder }, select: { id: true, title: true, videoAssetId: true, durationSec: true, videoGenStatus: true } });
    if (!lesson) { report.push({ slug, status: "missing_lesson" }); continue; }
    if (!fs.existsSync(manifestPath) || !fs.existsSync(binaryPath)) { report.push({ slug, status: "missing_media_files" }); continue; }
    if (lesson.videoAssetId === assetId) { report.push({ slug, status: "already_linked", lessonId: lesson.id }); continue; }
    if (!apply) { report.push({ slug, status: "would_link", lessonId: lesson.id, assetId }); continue; }
    await prisma.lesson.update({ where: { id: lesson.id }, data: { videoAssetId: assetId, videoUrl: null, videoGenStatus: "ready", videoDurationSec: lesson.durationSec } });
    report.push({ slug, status: "linked", lessonId: lesson.id, assetId });
  }
} finally {
  await prisma.$disconnect();
}
console.log(JSON.stringify({ apply, mediaRoot: root, report }, null, 2));
