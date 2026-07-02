import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { audit } from "@/lib/audit";
import { ok, handle } from "@/lib/api";

// PATCH /api/admin/lessons/:id — 编辑章节（含设置免费试看）
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requirePermission("course:write");
    const { id } = await params;
    const body = (await req.json()) as Record<string, unknown>;
    const allowed = ["title", "summary", "contentType", "durationSec", "isFree", "articleMd", "status", "sortOrder"];
    const data: Record<string, unknown> = {};
    for (const k of allowed) if (k in body) data[k] = body[k];
    const lesson = await prisma.lesson.update({ where: { id }, data });
    await audit({ operatorId: admin.id, action: "lesson.update", targetType: "lesson", targetId: id, detail: JSON.stringify(data) });
    return ok(lesson);
  });
}
