import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { validateLessonGraph } from "@/lib/lesson-graph";

export const dynamic = "force-dynamic";

async function authorCourse(id: string, userId: string) {
  const course = await prisma.course.findUnique({
    where: { id },
    select: {
      id: true, authorUserId: true, navigationMode: true,
      lessons: { orderBy: { sortOrder: "asc" }, select: { id: true, title: true, sortOrder: true } },
      lessonEdges: { orderBy: [{ fromLessonId: "asc" }, { sortOrder: "asc" }], select: { id: true, fromLessonId: true, toLessonId: true, label: true, conditionJson: true, sortOrder: true } },
    },
  });
  if (!course) throw new AppError("课程不存在", 404);
  if (course.authorUserId !== userId) throw new AppError("无权操作该课程", 403);
  return course;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const course = await authorCourse(id, user.id);
    return ok({
      navigationMode: course.navigationMode,
      lessons: course.lessons,
      edges: course.lessonEdges.map((edge) => ({
        ...edge,
        condition: (() => { try { return JSON.parse(edge.conditionJson ?? '{"type":"always"}'); } catch { return { type: "always" }; } })(),
        conditionJson: undefined,
      })),
    });
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    assertUserRateLimit(user.id, "lesson_graph_save", 80, 3_600_000);
    const { id } = await params;
    const course = await authorCourse(id, user.id);
    const body = (await req.json().catch(() => null)) as { navigationMode?: string; edges?: unknown } | null;
    const navigationMode = body?.navigationMode === "graph" ? "graph" : "linear";
    const checked = validateLessonGraph(course.lessons.map((lesson) => lesson.id), body?.edges ?? []);
    if (!checked.ok) return fail(checked.issues.join("；").slice(0, 800), 400);
    if (navigationMode === "graph" && course.lessons.length > 1 && checked.edges.length === 0) return fail("图导航模式至少需要一条连接", 400);
    await prisma.$transaction(async (tx) => {
      await tx.lessonEdge.deleteMany({ where: { courseId: course.id } });
      if (checked.edges.length > 0) {
        await tx.lessonEdge.createMany({
          data: checked.edges.map((edge) => ({
            courseId: course.id, fromLessonId: edge.fromLessonId, toLessonId: edge.toLessonId,
            label: edge.label, conditionJson: JSON.stringify(edge.condition), sortOrder: edge.sortOrder,
          })),
        });
      }
      await tx.course.update({ where: { id: course.id }, data: { navigationMode, lastUpdatedAt: new Date() } });
    });
    return ok({ navigationMode, edges: checked.edges });
  });
}
