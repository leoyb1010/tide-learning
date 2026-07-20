import { NextRequest, after } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { assertCanSpend } from "@/lib/credits";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { initGenJob, runCourseGenBackground } from "@/lib/course-gen";

export const dynamic = "force-dynamic";

/**
 * POST /api/courses/:id/outline/confirm —— L2 可控造课：确认大纲，开始逐节生成。
 *
 * 把 outline_draft 的课转成 generating，建进度 job，注册 after() 后台扇出（与首次造课收尾一致）。
 * 逐节扇出成本由 runCourseGenBackground 的逐节积分门按实时余额兜底；此处按课级模型再做一次预检
 * （与 resume-gen 一致），避免用户多次重生成大纲后余额已不足、确认后立刻落 failed。
 * 越权铁律：assertSameOrigin + requireUser + authorUserId + genStatus==='outline_draft'。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const { id } = await params;
    const user = await requireUser();

    // 权益 + 限流（与首次造课/续造一致：确认=真正开始花钱的那一步）。
    assertUserRateLimit(user.id, "ai_gen_course", 5, 86_400_000);
    const snapshot = await resolveEntitlement(user.id);
    if (!snapshot.canUseLLM) throw new AppError("AI 功能需订阅后使用", 402);

    const course = await prisma.course.findUnique({
      where: { id },
      select: { id: true, authorUserId: true, genStatus: true, modelUsed: true, category: true },
    });
    if (!course) return fail("课程不存在", 404);
    if (course.authorUserId !== user.id) throw new AppError("无权操作该课程", 403);
    if (course.genStatus !== "outline_draft") {
      return fail("该课程不在大纲待确认状态", 409);
    }

    // 课级模型的余额预检（不对非作者做扣费预检——归属已在上方校验）。
    await assertCanSpend(user.id, "generate_course", course.modelUsed ?? undefined);

    const total = await prisma.lesson.count({ where: { courseId: course.id } });
    if (total === 0) return fail("大纲为空，请先补充章节", 400);

    await prisma.course.update({ where: { id: course.id }, data: { genStatus: "generating" } });
    await initGenJob(course.id, user.id, total, { category: course.category ?? undefined });

    const courseId = course.id;
    after(async () => {
      await runCourseGenBackground(courseId, user.id);
    });

    return ok({ confirmed: true, genStatus: "generating", total });
  });
}
