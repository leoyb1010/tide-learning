import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { audit } from "@/lib/audit";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || `course-${Date.now()}`;
}

// GET /api/admin/courses — 课程列表（后台）
export async function GET() {
  return handle(async () => {
    await requirePermission("course:write");
    const courses = await prisma.course.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { lessons: true, updateLogs: true } } },
    });
    return ok({ courses });
  });
}

// POST /api/admin/courses — 新建课程（草稿）
export async function POST(req: NextRequest) {
  return handle(async () => {
    const admin = await requirePermission("course:write");
    assertSameOrigin(req);
    const body = (await req.json()) as {
      title: string;
      subtitle?: string;
      description?: string;
      category?: string;
      level?: string;
      instructorName?: string;
      reviewerName?: string;
    };
    if (!body.title?.trim()) return fail("请填写课程标题");
    const course = await prisma.course.create({
      data: {
        slug: slugify(body.title) + "-" + Math.random().toString(36).slice(2, 6),
        title: body.title.trim(),
        subtitle: body.subtitle,
        description: body.description,
        category: body.category ?? "ai_skill",
        level: body.level ?? "L1",
        status: "draft",
        ownerId: admin.id,
        instructorName: body.instructorName,
        reviewerName: body.reviewerName,
      },
    });
    await audit({ operatorId: admin.id, action: "course.create", targetType: "course", targetId: course.id, detail: course.title });
    return ok(course);
  });
}
