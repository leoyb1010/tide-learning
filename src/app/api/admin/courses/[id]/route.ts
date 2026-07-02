import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { audit } from "@/lib/audit";
import { ok, handle } from "@/lib/api";

// PATCH /api/admin/courses/:id — 编辑课程 / 变更状态（草稿/内测/已发布/下架）
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requirePermission("course:write");
    const { id } = await params;
    const body = (await req.json()) as Record<string, unknown>;
    const allowed = ["title", "subtitle", "description", "category", "level", "status", "instructorName", "reviewerName", "disclaimer", "updateCadence", "isFeatured"];
    const data: Record<string, unknown> = {};
    for (const k of allowed) if (k in body) data[k] = body[k];
    if (body.status === "published") data.publishedAt = new Date();
    data.lastUpdatedAt = new Date();
    const course = await prisma.course.update({ where: { id }, data });
    await audit({ operatorId: admin.id, action: "course.update", targetType: "course", targetId: id, detail: JSON.stringify(data) });
    return ok(course);
  });
}
