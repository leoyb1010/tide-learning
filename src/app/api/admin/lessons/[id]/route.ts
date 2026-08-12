import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { audit } from "@/lib/audit";
import { AppError, ok, handle, assertSameOrigin } from "@/lib/api";
import { claimCourseContentMutation } from "@/lib/course-gen";

const DERIVED_PRESENTATION_FIELDS = new Set(["title", "summary", "contentType", "articleMd", "sortOrder"]);
const COURSE_TRUTH_FIELDS = new Set([...DERIVED_PRESENTATION_FIELDS, "status"]);

// PATCH /api/admin/lessons/:id — 编辑章节（含设置免费试看）
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requirePermission("course:write");
    assertSameOrigin(req);
    const { id } = await params;
    const body = (await req.json()) as Record<string, unknown>;
    const allowed = ["title", "summary", "contentType", "durationSec", "isFree", "articleMd", "status", "sortOrder"];
    const data: Record<string, unknown> = {};
    for (const k of allowed) if (k in body) data[k] = body[k];
    const presentationChanged = Object.keys(data).some((key) => DERIVED_PRESENTATION_FIELDS.has(key));
    const courseTruthChanged = Object.keys(data).some((key) => COURSE_TRUTH_FIELDS.has(key));
    const lesson = await prisma.$transaction(async (tx) => {
      const target = await tx.lesson.findUnique({
        where: { id },
        select: {
          blocksJson: true,
          htmlJson: true,
          renderEngine: true,
          contentType: true,
          course: { select: { id: true, status: true, genStatus: true, presentationRevision: true } },
        },
      });
      if (!target?.course) throw new AppError("章节不存在", 404);
      if (target.course.status === "archived") throw new AppError("已归档课程不能编辑课节", 409);
      if (presentationChanged && (target.contentType === "scorm" || target.renderEngine === "faithful_import")) {
        throw new AppError("忠实导入/SCORM 课节不能修改内容或排序，以免丢失原课件", 409);
      }
      if (courseTruthChanged) {
        await claimCourseContentMutation(tx, {
          courseId: target.course.id,
          expectedPresentationRevision: target.course.presentationRevision,
        });
      }

      if (presentationChanged && target.htmlJson && target.renderEngine === "llm") {
        await tx.lessonRevision.create({
          data: { lessonId: id, blocksJson: target.blocksJson, htmlJson: target.htmlJson, reason: "manual" },
        });
        const keep = await tx.lessonRevision.findMany({
          where: { lessonId: id },
          orderBy: { createdAt: "desc" },
          take: 3,
          select: { id: true },
        });
        await tx.lessonRevision.deleteMany({
          where: { lessonId: id, id: { notIn: keep.map((revision) => revision.id) } },
        });
      }

      const updated = await tx.lesson.update({
        where: { id },
        data: {
          ...data,
          ...(presentationChanged ? {
            htmlJson: null,
            renderEngine: null,
            renderSourceHash: null,
            renderRejectReason: null,
            renderDurationMs: null,
            htmlGenClaimedAt: null,
            qualityJson: null,
            designJson: null,
          } : {}),
        },
      });
      await tx.course.update({
        where: { id: target.course.id },
        data: { lastUpdatedAt: new Date() },
      });
      return updated;
    });
    await audit({ operatorId: admin.id, action: "lesson.update", targetType: "lesson", targetId: id, detail: JSON.stringify(data) });
    return ok(lesson);
  });
}
