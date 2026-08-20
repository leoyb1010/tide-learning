import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { audit } from "@/lib/audit";
import { AppError, ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { readPrivateMedia } from "@/lib/private-media";
import { claimCourseContentMutation } from "@/lib/course-gen";

// POST /api/admin/courses/:id/lessons — 新增章节
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requirePermission("course:write");
    assertSameOrigin(req);
    const { id: courseId } = await params;
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, status: true, genStatus: true, presentationRevision: true },
    });
    if (!course) return fail("课程不存在", 404);
    if (course.status === "archived") return fail("已归档课程不能新增课节", 409);
    const body = (await req.json()) as {
      title: string;
      summary?: string;
      contentType?: string;
      durationSec?: number;
      isFree?: boolean;
      articleMd?: string;
      videoAssetId?: string;
    };
    if (typeof body.title !== "string" || !body.title.trim()) return fail("请填写章节标题");
    if (body.summary !== undefined && typeof body.summary !== "string") return fail("章节摘要类型错误", 400);
    if (body.articleMd !== undefined && typeof body.articleMd !== "string") return fail("图文正文类型错误", 400);
    if (body.videoAssetId !== undefined && typeof body.videoAssetId !== "string") return fail("视频资产类型错误", 400);
    if (body.durationSec !== undefined && (!Number.isSafeInteger(body.durationSec) || body.durationSec < 0 || body.durationSec > 24 * 60 * 60)) return fail("章节时长非法", 400);
    if (body.isFree !== undefined && typeof body.isFree !== "boolean") return fail("试看标记非法", 400);
    const contentType = typeof body.contentType === "string" ? body.contentType.trim() : "video";
    if (!['video', 'article'].includes(contentType)) return fail("不支持的章节类型", 400);
    if (contentType === "article" && !body.articleMd?.trim()) return fail("图文章节必须填写正文", 400);
    const requiresVideo = contentType === "video";
    const requestedAssetId = body.videoAssetId?.trim();
    if (requiresVideo && process.env.NODE_ENV === "production") {
      if (!requestedAssetId) return fail("生产环境的视频章节必须先上传真实私有视频");
      if (!(await readPrivateMedia(requestedAssetId))) return fail("视频资产不存在或完整性校验失败");
    }
    // 非生产环境可用占位资源走模拟播放器；生产已在上方强制真实私有资产。
    const videoAssetId =
      requiresVideo
        ? (requestedAssetId || `asset_${courseId}_${Date.now()}`)
        : null;
    const lesson = await prisma.$transaction(async (tx) => {
      const presentationRevision = await claimCourseContentMutation(tx, {
        courseId,
        expectedPresentationRevision: course.presentationRevision,
      });
      const maxOrder = await tx.lesson.aggregate({ where: { courseId }, _max: { sortOrder: true } });
      const created = await tx.lesson.create({ data: {
        courseId,
        title: body.title.trim(),
        summary: body.summary,
        contentType,
        durationSec: body.durationSec ?? 0,
        isFree: body.isFree ?? false,
        articleMd: body.articleMd,
        videoAssetId,
        sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
        status: "published",
        publishedAt: new Date(),
      } });
      const agg = await tx.lesson.aggregate({ where: { courseId }, _sum: { durationSec: true } });
      const total = await tx.course.updateMany({
        where: { id: courseId, presentationRevision },
        data: { totalDurationSec: agg._sum.durationSec ?? 0 },
      });
      if (total.count !== 1) throw new AppError("课程已变更，请刷新后重试", 409);
      return created;
    });
    await audit({ operatorId: admin.id, action: "lesson.create", targetType: "lesson", targetId: lesson.id, detail: lesson.title });
    return ok(lesson);
  });
}
