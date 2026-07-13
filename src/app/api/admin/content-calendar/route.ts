import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";

const STATUSES = new Set(["planned", "recording", "editing", "review", "scheduled", "published", "delayed"]);
const RISKS = new Set(["low", "medium", "high"]);

// GET /api/admin/content-calendar — 内容排期（§8.2.2）
export async function GET() {
  return handle(async () => {
    await requirePermission("course:write");
    const items = await prisma.contentCalendar.findMany({
      orderBy: { plannedPublishDate: "asc" },
      include: { course: { select: { title: true, slug: true } } },
    });
    return ok({ items });
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const admin = await requirePermission("course:write");
    assertSameOrigin(req);
    const body = (await req.json()) as {
      courseId?: string; title?: string; plannedPublishDate?: string; owner?: string;
      status?: string; riskLevel?: string; demandId?: string;
    };
    const title = body.title?.trim();
    const date = body.plannedPublishDate ? new Date(body.plannedPublishDate) : null;
    if (!body.courseId || !title || title.length > 200 || !date || Number.isNaN(date.getTime())) {
      return fail("请填写有效的课程、内容标题和发布日期");
    }
    if (body.status && !STATUSES.has(body.status)) return fail("排期状态无效");
    if (body.riskLevel && !RISKS.has(body.riskLevel)) return fail("风险等级无效");
    const course = await prisma.course.findUnique({ where: { id: body.courseId }, select: { id: true } });
    if (!course) return fail("课程不存在", 404);
    const item = await prisma.contentCalendar.create({
      data: {
        courseId: body.courseId,
        title,
        plannedPublishDate: date,
        owner: body.owner?.trim().slice(0, 100) || null,
        status: body.status ?? "planned",
        riskLevel: body.riskLevel ?? "low",
        demandId: body.demandId?.trim() || null,
      },
      include: { course: { select: { title: true, slug: true } } },
    });
    await audit({ operatorId: admin.id, action: "content_calendar.create", targetType: "content_calendar", targetId: item.id, detail: title });
    return ok({ item }, 201);
  });
}

export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const admin = await requirePermission("course:write");
    assertSameOrigin(req);
    const body = (await req.json()) as { id?: string; status?: string; riskLevel?: string; delayReason?: string };
    if (!body.id) return fail("缺少排期 ID");
    if (body.status && !STATUSES.has(body.status)) return fail("排期状态无效");
    if (body.riskLevel && !RISKS.has(body.riskLevel)) return fail("风险等级无效");
    const exists = await prisma.contentCalendar.findUnique({ where: { id: body.id }, select: { id: true } });
    if (!exists) return fail("排期不存在", 404);
    const item = await prisma.contentCalendar.update({
      where: { id: body.id },
      data: {
        ...(body.status ? { status: body.status } : {}),
        ...(body.riskLevel ? { riskLevel: body.riskLevel } : {}),
        ...(body.delayReason !== undefined ? { delayReason: body.delayReason.trim().slice(0, 500) || null } : {}),
      },
      include: { course: { select: { title: true, slug: true } } },
    });
    await audit({ operatorId: admin.id, action: "content_calendar.update", targetType: "content_calendar", targetId: item.id, detail: JSON.stringify({ status: body.status, riskLevel: body.riskLevel }) });
    return ok({ item });
  });
}

export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const admin = await requirePermission("course:write");
    assertSameOrigin(req);
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return fail("缺少排期 ID");
    const deleted = await prisma.contentCalendar.deleteMany({ where: { id } });
    if (!deleted.count) return fail("排期不存在", 404);
    await audit({ operatorId: admin.id, action: "content_calendar.delete", targetType: "content_calendar", targetId: id });
    return ok({ deleted: true });
  });
}
