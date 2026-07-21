import { NextRequest, after } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { lessonTargetsFromBlocks, validateBlocks } from "@/lib/blocks";
import { writeLessonBlocks, scoreLesson, renderCourseHtmlBestEffort } from "@/lib/course-gen";
import { validateLessonGraph } from "@/lib/lesson-graph";

export const dynamic = "force-dynamic";

/**
 * GET /api/lessons/:id/blocks —— L4 块编辑器：读本节可编辑块（作者本人）。
 * 返回 blocksJson 里的 blocks 数组（含 id/type/各字段），供前端块编辑器加载。只读。
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const user = await requireUser();
    const lesson = await prisma.lesson.findUnique({
      where: { id },
      select: {
        blocksJson: true,
        course: {
          select: {
            authorUserId: true,
            lessons: { orderBy: { sortOrder: "asc" }, select: { id: true, title: true } },
          },
        },
      },
    });
    if (!lesson || !lesson.course) return fail("章节不存在", 404);
    if (lesson.course.authorUserId !== user.id) throw new AppError("无权操作该课程", 403);
    let blocks: unknown[] = [];
    try {
      const parsed = JSON.parse(lesson.blocksJson || "{}") as { blocks?: unknown[] };
      if (Array.isArray(parsed?.blocks)) blocks = parsed.blocks;
    } catch {
      /* 脏 blocksJson → 空 */
    }
    return ok({ blocks, lessons: lesson.course.lessons });
  });
}

/**
 * PUT /api/lessons/:id/blocks —— L4 块编辑器：保存编辑后的整块数组（免费，无 LLM）。
 *
 * body: { blocks: [...] }。整块数组经 validateBlocks 校验（非法块丢弃、字段截断、id 去重保留），
 * 再经唯一写入口 writeLessonBlocks 落库（存旧版档、清派生 HTML、shared 课回 pending 重审），
 * 后台补渲 HTML。空数组或全非法 → 拒绝（不允许把课节编成空）。
 * 越权铁律：assertSameOrigin + requireUser + authorUserId===user.id。
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const { id } = await params;
    const user = await requireUser();

    const body = (await req.json().catch(() => null)) as { blocks?: unknown } | null;
    if (!body || !Array.isArray(body.blocks)) return fail("缺少 blocks");

    const lesson = await prisma.lesson.findUnique({
      where: { id },
      select: {
        id: true,
        course: {
          select: {
            id: true, authorUserId: true, template: true,
            lessons: { select: { id: true } },
            lessonEdges: { select: { fromLessonId: true, toLessonId: true, label: true, conditionJson: true, sortOrder: true } },
          },
        },
      },
    });
    if (!lesson || !lesson.course) return fail("章节不存在", 404);
    if (lesson.course.authorUserId !== user.id) throw new AppError("无权操作该课程", 403);

    const validated = validateBlocks(body.blocks);
    if (validated.length === 0) return fail("编辑后内容为空或全部非法，未保存", 400);
    const targets = lessonTargetsFromBlocks(validated);
    if (targets.length > 0) {
      const count = await prisma.lesson.count({ where: { id: { in: targets }, courseId: lesson.course.id } });
      if (count !== targets.length) return fail("跳转目标必须是当前课程内的有效课节", 400);
    }
    // 课件内声明的跳转也是课程图的一部分：先与已有手工边合并做 DAG 校验，杜绝积木绕过图编辑器制造循环。
    const retainedEdges = lesson.course.lessonEdges.filter((edge) => {
      try { return (JSON.parse(edge.conditionJson ?? "{}") as { source?: string }).source !== "block_target" || edge.fromLessonId !== id; }
      catch { return true; }
    });
    const graphCandidate = [
      ...retainedEdges.map((edge) => ({ ...edge, condition: (() => { try { return JSON.parse(edge.conditionJson ?? '{"type":"always"}'); } catch { return { type: "always" }; } })() })),
      ...targets.map((target, index) => ({
        fromLessonId: id, toLessonId: target, label: "课件交互", sortOrder: 500 + index,
        condition: { type: "choice", blockId: `route_${index}`, optionIndex: 0 },
      })),
    ];
    const graph = validateLessonGraph(lesson.course.lessons.map((row) => row.id), graphCandidate);
    if (!graph.ok) return fail(`课件跳转会破坏课程路径图：${graph.issues.join("；")}`, 400);

    const quality = scoreLesson(validated, lesson.course.template);
    await writeLessonBlocks({
      lessonId: id,
      courseId: lesson.course.id,
      blocksJson: JSON.stringify({ version: 1, blocks: validated }),
      qualityJson: JSON.stringify({ score: quality.score, passed: quality.passed, flags: quality.flags, manualEdit: true }),
      reason: "manual",
    });

    await prisma.$transaction(async (tx) => {
      await tx.lessonEdge.deleteMany({
        where: { courseId: lesson.course.id, fromLessonId: id, conditionJson: { contains: '"source":"block_target"' } },
      });
      if (targets.length > 0) {
        await tx.lessonEdge.createMany({
          data: targets.map((target, index) => ({
            courseId: lesson.course.id, fromLessonId: id, toLessonId: target, label: "课件交互", sortOrder: 500 + index,
            conditionJson: JSON.stringify({ type: "choice", blockId: `route_${index}`, optionIndex: 0, source: "block_target" }),
          })),
        });
        await tx.course.update({ where: { id: lesson.course.id }, data: { navigationMode: "graph" } });
      } else {
        const remainingEdges = await tx.lessonEdge.count({ where: { courseId: lesson.course.id } });
        if (remainingEdges === 0) await tx.course.update({ where: { id: lesson.course.id }, data: { navigationMode: "linear" } });
      }
    });

    const courseId = lesson.course.id;
    after(async () => {
      await renderCourseHtmlBestEffort(courseId);
    });

    return ok({ saved: true, blocks: validated.length });
  });
}
