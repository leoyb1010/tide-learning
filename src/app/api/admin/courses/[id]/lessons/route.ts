import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { audit } from "@/lib/audit";
import { ok, fail, handle } from "@/lib/api";

// POST /api/admin/courses/:id/lessons — 新增章节
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requirePermission("course:write");
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
    // 非图文章节需要视频资源：优先用前端上传拿到的 videoAssetId，没有才生成占位。
    const videoAssetId =
      contentType !== "article"
        ? (body.videoAssetId?.trim() || `asset_${courseId}_${Date.now()}`)
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
