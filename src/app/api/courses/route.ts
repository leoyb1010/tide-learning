import { NextRequest } from "next/server";
import { listCourses } from "@/lib/queries";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { slugifyCourse } from "@/lib/course-gen";
import { track } from "@/lib/analytics";

// GET /api/courses?category=&sort=&q=
export async function GET(req: NextRequest) {
  return handle(async () => {
    const sp = req.nextUrl.searchParams;
    const courses = await listCourses({
      category: sp.get("category") ?? undefined,
      sort: sp.get("sort") ?? undefined,
      q: sp.get("q") ?? undefined,
    });
    return ok({ courses });
  });
}

/** POST /api/courses：普通创作者新建一门空白课程，不调用 AI。 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    assertUserRateLimit(user.id, "course_manual_create", 30, 3_600_000);
    const body = (await req.json().catch(() => null)) as {
      title?: string;
      subtitle?: string;
      description?: string;
      category?: string;
      level?: string;
    } | null;
    const title = body?.title?.trim().slice(0, 120);
    if (!title) return fail("请填写课程标题");
    const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    const course = await prisma.course.create({
      data: {
        slug: `${slugifyCourse(title)}-${suffix}`,
        title,
        subtitle: body?.subtitle?.trim().slice(0, 180) || null,
        description: body?.description?.trim().slice(0, 4000) || null,
        category: body?.category?.trim().slice(0, 40) || "ai_skill",
        level: ["L1", "L2", "L3"].includes(body?.level ?? "") ? body!.level! : "L1",
        status: "draft",
        origin: "user_created",
        authorUserId: user.id,
        ownerId: user.id,
        visibility: "private",
        sharedStatus: "private",
        genStatus: "ready",
        qualityTier: "premium",
      },
      select: { id: true, slug: true, title: true, status: true, origin: true, visibility: true, createdAt: true },
    });
    await track({ eventName: "course_manual_create", userId: user.id, properties: { courseId: course.id } });
    return ok({ course });
  });
}
