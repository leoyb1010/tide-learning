import { NextRequest, after } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { validateBlocks } from "@/lib/blocks";
import { writeLessonBlocks, scoreLesson, renderCourseHtmlBestEffort } from "@/lib/course-gen";

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
      select: { blocksJson: true, course: { select: { authorUserId: true } } },
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
    return ok({ blocks });
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
      select: { id: true, course: { select: { id: true, authorUserId: true, template: true } } },
    });
    if (!lesson || !lesson.course) return fail("章节不存在", 404);
    if (lesson.course.authorUserId !== user.id) throw new AppError("无权操作该课程", 403);

    const validated = validateBlocks(body.blocks);
    if (validated.length === 0) return fail("编辑后内容为空或全部非法，未保存", 400);

    const quality = scoreLesson(validated, lesson.course.template);
    await writeLessonBlocks({
      lessonId: id,
      courseId: lesson.course.id,
      blocksJson: JSON.stringify({ version: 1, blocks: validated }),
      qualityJson: JSON.stringify({ score: quality.score, passed: quality.passed, flags: quality.flags, manualEdit: true }),
      reason: "manual",
    });

    const courseId = lesson.course.id;
    after(async () => {
      await renderCourseHtmlBestEffort(courseId);
    });

    return ok({ saved: true, blocks: validated.length });
  });
}
