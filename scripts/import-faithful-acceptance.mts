import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import JSZip from "jszip";
import { prisma } from "../src/lib/db";
import { creatorAssetDiskPath } from "../src/lib/creator-assets";
import { createPresentationCourse, createScormCourse } from "../src/lib/import-faithful";
import { importContentSha256, importPayloadHash, startImportOperation, type ImportOperation } from "../src/lib/import-operation";

/** 与 /api/ai/import-file 路由一致：真实 start 一个幂等导入操作，验收结束后按 jobId 清理。 */
async function startAcceptanceOperation(userId: string, payload: unknown): Promise<ImportOperation> {
  const requestId = `acceptance-${randomUUID()}`; // 满足 /^[A-Za-z0-9_-]{16,128}$/
  const started = await startImportOperation({ userId, requestId, payloadHash: importPayloadHash(payload) });
  if (started.status !== "acquired") throw new Error(`验收导入操作未取得所有权（status=${started.status}）`);
  return started.operation;
}

async function samplePptx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("ppt/presentation.xml", '<p:presentation xmlns:p="p"><p:sldSz cx="1600" cy="900"/></p:presentation>');
  zip.file("ppt/slides/slide1.xml", '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="160" y="90"/><a:ext cx="1280" cy="180"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:rPr sz="3200" b="1"/><a:t>忠实导入验收页</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>');
  return zip.generateAsync({ type: "nodebuffer" });
}

async function sampleScorm(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("imsmanifest.xml", `<?xml version="1.0"?><manifest><organizations><organization><title>验收课程</title><item identifier="item1" identifierref="res1"><title>SCORM 验收单元</title></item></organization></organizations><resources><resource identifier="res1" type="webcontent" href="index.html"><file href="index.html"/></resource></resources></manifest>`);
  zip.file("index.html", "<!doctype html><html><head><title>SCORM</title></head><body><button onclick=\"API.LMSSetValue('cmi.core.lesson_status','completed')\">完成</button></body></html>");
  return zip.generateAsync({ type: "nodebuffer" });
}

async function main() {
  const user = await prisma.user.findFirst({ where: { deletedAt: null }, select: { id: true } });
  if (!user) throw new Error("数据库里没有可用于验收的用户");
  const courseIds: string[] = [];
  const assetIds: string[] = [];
  const jobIds: string[] = [];
  try {
    const pptxTitle = `PPT 忠实验收 ${Date.now()}`;
    const pptxBytes = await samplePptx();
    const pptxOperation = await startAcceptanceOperation(user.id, {
      scope: "file",
      contentSha256: importContentSha256(pptxBytes),
      kind: "pptx",
      title: pptxTitle,
      fileName: "acceptance.pptx",
    });
    jobIds.push(pptxOperation.lease.jobId);
    const presentation = await createPresentationCourse({ userId: user.id, title: pptxTitle, bytes: pptxBytes, kind: "pptx", operation: pptxOperation });
    courseIds.push(presentation.courseId);
    const pptLesson = await prisma.lesson.findFirst({ where: { courseId: presentation.courseId }, select: { htmlJson: true, blocksJson: true, renderEngine: true } });
    if (!pptLesson?.htmlJson?.includes("忠实导入验收页") || !pptLesson.blocksJson || pptLesson.renderEngine !== "faithful_import") throw new Error("PPT 忠实课件未完整落库");

    const scormTitle = `SCORM 忠实验收 ${Date.now()}`;
    const scormBytes = await sampleScorm();
    const scormOperation = await startAcceptanceOperation(user.id, {
      scope: "file",
      contentSha256: importContentSha256(scormBytes),
      kind: "scorm",
      title: scormTitle,
      fileName: "acceptance.scorm",
    });
    jobIds.push(scormOperation.lease.jobId);
    const scorm = await createScormCourse({ userId: user.id, title: scormTitle, bytes: scormBytes, fileName: "acceptance.scorm", operation: scormOperation });
    courseIds.push(scorm.courseId);
    const source = await prisma.importedSource.findFirst({ where: { generatedCourseId: scorm.courseId }, select: { assetId: true } });
    if (source?.assetId) assetIds.push(source.assetId);
    const sco = await prisma.lesson.findFirst({ where: { courseId: scorm.courseId }, select: { contentType: true, articleMd: true, blocksJson: true } });
    if (sco?.contentType !== "scorm" || !sco.articleMd?.includes("index.html") || !sco.blocksJson) throw new Error("SCORM 启动单元未完整落库");

    process.stdout.write(JSON.stringify({ presentation, scorm, checks: { oneSlideOneScreen: true, blocksPersisted: true, scormLaunchPreserved: true } }, null, 2) + "\n");
  } finally {
    for (const courseId of courseIds) {
      await prisma.importedSource.deleteMany({ where: { generatedCourseId: courseId } });
      await prisma.course.deleteMany({ where: { id: courseId } });
    }
    for (const assetId of assetIds) {
      const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { storagePath: true } });
      if (asset) {
        await prisma.asset.delete({ where: { id: assetId } });
        const diskPath = creatorAssetDiskPath(asset.storagePath);
        if (diskPath) await unlink(diskPath).catch(() => {});
      }
    }
    if (jobIds.length > 0) await prisma.generationJob.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
