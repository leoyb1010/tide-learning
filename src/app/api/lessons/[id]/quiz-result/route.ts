import { NextRequest, after } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getLessonForUser } from "@/lib/queries";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { recordActivity } from "@/lib/gamification";
import { track } from "@/lib/analytics";
import { validateBlocks } from "@/lib/blocks";

export const dynamic = "force-dynamic";

/**
 * POST /api/lessons/[id]/quiz-result —— 课件内答题结果落库（蓝图 D2 / 审查 P0-6）。
 *
 * 数据链：课件沙箱 quiz 作答 → ct-quiz postMessage → HtmlCourseware 宿主 → 本路由。
 * 落两处：LessonQuizResult（掌握度，(user,lesson,block) 幂等 upsert，重答取最新）；
 * 答错时把该题转 ReviewCard（front=题干 / back=正确选项+解析，dueAt=now 立即进复习队列，
 * 同题去重）。课件练习从「白学」接入错题本/SRS 闭环。
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    assertUserRateLimit(user.id, "quiz_result", 120, 60_000);
    const { id: lessonId } = await ctx.params;

    const body = (await req.json().catch(() => null)) as {
      blockId?: string;
      answerIndex?: number;
    } | null;
    const blockId = body?.blockId?.trim();
    if (!blockId || !/^[A-Za-z0-9_-]{1,64}$/.test(blockId)) return fail("blockId 非法");
    if (!Number.isInteger(body?.answerIndex)) return fail("参数非法");
    const answerIndex = body!.answerIndex as number;
    if (answerIndex < 0 || answerIndex > 31) return fail("answerIndex 非法");

    // 归属 + 权益双门（与 /api/progress 同口径）：无权访问的节不接受任何写入。
    const view = await getLessonForUser(lessonId, user.id);
    if (!view || !view.access) return fail("无权访问该课节", 403);

    // 审计加固：blockId 必须真实存在于本节 blocks——否则任意串也能占一行掌握度记录
    // (虽只污染本人数据,但会让掌握度统计失真)。blocks 在下方错题转卡还要用,一次解析两用。
    const parsedBlocks = (() => {
      try {
        const parsed = JSON.parse(view.lesson.blocksJson ?? "null") as { blocks?: unknown };
        return validateBlocks(parsed?.blocks ?? parsed);
      } catch {
        return [];
      }
    })();
    const matchedBlock = parsedBlocks.find((b) => b.id === blockId);
    if (!matchedBlock) return fail("blockId 不存在于本节");
    if (matchedBlock.type !== "quiz") return fail("blockId 不是测验块");
    if (answerIndex >= matchedBlock.options.length) return fail("answerIndex 超出选项范围");
    // blocksJson 是教学真值。客户端只能声明选了哪项，不能声明自己答对。
    const correct = answerIndex === matchedBlock.answerIndex;

    await prisma.lessonQuizResult.upsert({
      where: { userId_lessonId_blockId: { userId: user.id, lessonId, blockId } },
      create: { userId: user.id, lessonId, blockId, answerIndex, correct },
      update: { answerIndex, correct },
    });

    // 答错 → 错题转复习卡（幂等：同 front 已有卡不重复建）。blocks 复用上方同一次解析。
    let reviewCardCreated = false;
    if (!correct) {
      const front = matchedBlock.question.slice(0, 500);
      const correctOption = matchedBlock.options[matchedBlock.answerIndex] ?? "";
      const back = `${correctOption}${matchedBlock.explain ? `\n\n${matchedBlock.explain}` : ""}`.slice(0, 2000);
      const existing = await prisma.reviewCard.findFirst({
        where: { userId: user.id, front },
        select: { id: true },
      });
      if (!existing) {
        await prisma.reviewCard.create({
          data: { userId: user.id, courseId: view.course.id, front, back, dueAt: new Date() },
        });
        reviewCardCreated = true;
      }
    }

    await track({
      eventName: "courseware_quiz_result",
      userId: user.id,
      properties: { lessonId, blockId, answerIndex, correct, reviewCardCreated },
    });
    after(() => recordActivity(user.id, { minutes: 1 }).catch(() => {}));

    return ok({
      saved: true,
      answerIndex,
      correct,
      correctAnswerIndex: matchedBlock.answerIndex,
      reviewCardCreated,
    });
  });
}
