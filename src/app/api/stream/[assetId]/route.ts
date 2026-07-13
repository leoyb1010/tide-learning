import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement, canAccessLesson } from "@/lib/entitlement";
import { hasPurchasedCourse } from "@/lib/queries";
import { fail, handle } from "@/lib/api";
import { parseByteRange, privateMediaStream, readPrivateMedia, verifyStreamSignature } from "@/lib/private-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function serve(req: NextRequest, assetId: string, headOnly: boolean) {
  const exp = Number(req.nextUrl.searchParams.get("exp") ?? 0);
  const signature = req.nextUrl.searchParams.get("sig");
  if (!verifyStreamSignature(assetId, exp, signature)) return fail("链接已过期或签名无效，请刷新页面", 403);

  const lesson = await prisma.lesson.findFirst({
    where: { videoAssetId: assetId },
    include: { course: { select: { id: true, category: true } } },
  });
  if (!lesson) return fail("资源不存在", 404);

  const user = await getCurrentUser();
  const snapshot = await resolveEntitlement(user?.id ?? null);
  const owned = await hasPurchasedCourse(lesson.course.id, user?.id ?? null);
  if (!canAccessLesson(lesson.course.category, lesson.isFree, snapshot, owned)) {
    return fail("无权访问该资源，请先订阅", 403);
  }

  const media = await readPrivateMedia(assetId);
  if (!media) {
    // 历史 mock asset 仅在非生产环境保留调试回显，生产绝不伪装成真视频。
    if (process.env.NODE_ENV !== "production" && assetId.startsWith("asset_")) {
      return NextResponse.json(
        { ok: true, assetId, kind: "mock-hls", note: "非生产占位资源" },
        { headers: { "cache-control": "private, no-store" } },
      );
    }
    return fail("私有视频文件不存在或完整性校验失败", 404);
  }

  const range = parseByteRange(req.headers.get("range"), media.metadata.size);
  if (range === "invalid") {
    return new NextResponse(null, {
      status: 416,
      headers: { "content-range": `bytes */${media.metadata.size}`, "cache-control": "private, no-store" },
    });
  }
  const contentLength = range ? range.end - range.start + 1 : media.metadata.size;
  const headers = new Headers({
    "accept-ranges": "bytes",
    "cache-control": "private, no-store",
    "content-length": String(contentLength),
    "content-type": media.metadata.mimeType,
    "x-content-type-options": "nosniff",
  });
  if (range) headers.set("content-range", `bytes ${range.start}-${range.end}/${media.metadata.size}`);
  return new NextResponse(headOnly ? null : privateMediaStream(media.dataPath, range), {
    status: range ? 206 : 200,
    headers,
  });
}

/** 受控视频流：短时 HMAC URL + 章节所属课程权益二次校验 + HTTP Range。 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  return handle(async () => serve(req, (await params).assetId, false));
}

export async function HEAD(req: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  return handle(async () => serve(req, (await params).assetId, true));
}
