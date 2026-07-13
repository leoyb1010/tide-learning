import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { audit } from "@/lib/audit";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { readPrivateMedia } from "@/lib/private-media";

// POST /api/admin/courses/:id/lessons — 新增章节
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requirePermission("course:write");
    assertSameOrigin(req);
    const { id: courseId } = await params;
    const body = (await req.json()) as {
      title: string;
      summary?: string;
      contentType?: string;
      durationSec?: number;
      isFree?: boolean;
      articleMd?: string;
      videoAssetId?: string;
    };
    if (!body.title?.trim()) return fail("请填写章节标题");
    const contentType = body.contentType ?? "video";
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
    const maxOrder = await prisma.lesson.aggregate({ where: { courseId }, _max: { sortOrder: true } });
    const lesson = await prisma.lesson.create({
      data: {
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
      },
    });
    // 更新课程总时长
    const agg = await prisma.lesson.aggregate({ where: { courseId }, _sum: { durationSec: true } });
    await prisma.course.update({
      where: { id: courseId },
      data: { totalDurationSec: agg._sum.durationSec ?? 0, lastUpdatedAt: new Date() },
    });
    await audit({ operatorId: admin.id, action: "lesson.create", targetType: "lesson", targetId: lesson.id, detail: lesson.title });
    return ok(lesson);
  });
}
