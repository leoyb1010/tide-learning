import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { writeLessonBlocks, scoreLesson } from "@/lib/course-gen";

export const dynamic = "force-dynamic";

/**
 * POST /api/lessons/:id/rollback —— L4 可控造课：把本节回滚到某个历史版本（免费，纯 DB 恢复）。
 *
 * body: { revisionId }。把目标版本的 blocksJson 经唯一写入口 writeLessonBlocks 写回：
 *   它会先把「当前版本」存为新 revision（后悔药可叠加）、清派生 HTML 层、shared 课回 pending 重审。
 * 回滚后本节 htmlJson 被清空，课程进入复核，学习端暂用基础块课件。
 * 本路由不自动重排、不调用 LLM；后续“继续生成”会让 AI 重新复核，并可能改写已恢复的内容。
 * 无 LLM 花费 → 只需 requireUser + 归属校验，不走 canUseLLM 权益门。
 * 越权/IDOR 铁律：assertSameOrigin + authorUserId===user.id + revision.lessonId===路由 id + blocksJson 非空。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const { id } = await params;
    const user = await requireUser();

    const body = (await req.json().catch(() => null)) as { revisionId?: string } | null;
    const revisionId = body?.revisionId?.trim();
    if (!revisionId) return fail("缺少 revisionId");

    const lesson = await prisma.lesson.findUnique({
      where: { id },
      select: {
        id: true,
        course: {
          select: { id: true, authorUserId: true, template: true, status: true, genStatus: true, presentationRevision: true },
        },
      },
    });
    if (!lesson || !lesson.course) return fail("章节不存在", 404);
    if (lesson.course.authorUserId !== user.id) throw new AppError("无权操作该课程", 403);
    if (lesson.course.status === "archived") return fail("已归档课程不能回滚", 409);
    if (["generating", "paused", "outline_draft"].includes(lesson.course.genStatus ?? "")) {
      return fail("课程正在生成或暂停中，请先等待任务收敛", 409);
    }

    const revision = await prisma.lessonRevision.findUnique({
      where: { id: revisionId },
      select: { id: true, lessonId: true, blocksJson: true },
    });
    // IDOR：版本必须属于本节。rerender 版（blocksJson=null，仅 HTML 快照）不可回滚。
    if (!revision || revision.lessonId !== id) return fail("版本不存在", 404);
    if (!revision.blocksJson) return fail("该版本无内容层，无法回滚（仅排版快照）", 409);

    // 重算质量档案（LessonRevision 不存 qualityJson，回滚后按当前模板重新评分，保持一致口径）。
    let qualityJson = "{}";
    try {
      const parsed = JSON.parse(revision.blocksJson) as { blocks?: { type: string }[] };
      const blocks = Array.isArray(parsed?.blocks) ? parsed.blocks : [];
      const q = scoreLesson(blocks, lesson.course.template);
      qualityJson = JSON.stringify({
        score: q.score,
        passed: false,
        status: "manual_review_required",
        rulePassed: q.passed,
        flags: q.flags,
        rolledBack: true,
      });
    } catch {
      /* 脏 blocksJson 理论上不会入档；兜底空档案，不阻塞回滚 */
    }

    await writeLessonBlocks({
      lessonId: id,
      courseId: lesson.course.id,
      blocksJson: revision.blocksJson,
      qualityJson,
      reason: "manual",
      expectedPresentationRevision: lesson.course.presentationRevision,
    });

    return ok({
      rolledBack: true,
      lessonId: id,
      requiresReview: true,
      presentationStatus: "incomplete" as const,
    });
  });
}
