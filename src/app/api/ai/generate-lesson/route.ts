import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { requireLessonGenAccess } from "@/lib/ai-guard";
import { claimCourseGenerationStart, failGenJobLease, finishGenJobLeaseOnly, generateLessonCore, initGenJob, runCourseGenBackground } from "@/lib/course-gen";
import { after } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/ai/generate-lesson —— AI 自习室 引擎A · Step1..N：逐节生成块课件。
 *
 * v3.0：生成/校验/降级/扣费/收尾核心已抽到 course-gen.ts 的 generateLessonCore
 *（含 12 块协议叙事 prompt、越权铁律、幂等、genStatus=ready 收尾），
 * 本 route 只保留请求级闸门（同源 / 登录 / 权益 / 余额预检 / 限流）与结构性错误映射。
 * 权益：需 canUseLLM。限流：每用户每小时 60 节。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);

    // 审计修复：鉴权+限流必须先于任何业务 DB 触达——否则匿名请求可用随机 lessonId
    // 无限流打库。requireUser 在最前（401 短路），限流其次，之后才查归属。
    const preUser = await requireUser();
    assertUserRateLimit(preUser.id, "ai_gen_lesson", 60, 3_600_000);

    const body = (await req.json().catch(() => null)) as { lessonId?: string } | null;
    const lessonId = body?.lessonId?.trim();
    if (!lessonId) return fail("缺少 lessonId");

    // 蓝图 D5：取目标节归属，免费用户对「自己名下的体验课」放行逐节流水（重试/续跑可用）；
    // 其余仍走会员门。余额预检按 generate_lesson 最坏成本，扣费在内核按真实 token 记。
    const target = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: {
        courseId: true,
        course: { select: { authorUserId: true, status: true, genStatus: true, presentationRevision: true } },
      },
    });
    if (!target) return fail("章节不存在", 404);
    if (target.course?.authorUserId !== preUser.id) throw new AppError("无权操作该课程", 403);
    if (target.course.status === "archived") return fail("已归档课程不能生成课节", 409);
    if (target.course.genStatus === "outline_draft") {
      return fail("请先在大纲检查点确认课程，不能绕过来源与截至日期审核直接生成", 409);
    }
    const { user } = await requireLessonGenAccess(target.course.authorUserId, { spendScene: "generate_lesson" });
    const total = await prisma.lesson.count({ where: { courseId: target.courseId } });
    const lease = await initGenJob(target.courseId, user.id, total, {}, { allowCompletedReopen: true });
    if (!lease) return fail("该课程正在生成中，请稍后重试", 409);
    const started = await claimCourseGenerationStart({
      courseId: target.courseId,
      userId: user.id,
      lease,
      expectedGenStatus: target.course.genStatus,
      expectedPresentationRevision: target.course.presentationRevision,
    });
    if (!started) {
      await finishGenJobLeaseOnly(lease, "lesson generation state changed");
      return fail("该课程状态已变更，请刷新后重试", 409);
    }

    // 内核负责：越权校验 / LLM 生成 / 校验重试 / 降级 / 扣费 / 写库 / genStatus 收尾。
    // 结构性错误（章节不存在 / 越权）以 Error 抛出，这里映射为 4xx。
    let result;
    try {
      result = await generateLessonCore(lessonId, user.id, { jobLease: lease });
    } catch (e) {
      await failGenJobLease(
        target.courseId,
        lease,
        e instanceof Error ? e.message : "lesson generation failed",
        { genStatus: "generating" },
      );
      const msg = e instanceof Error ? e.message : "";
      if (msg === "章节不存在") return fail("章节不存在", 404);
      if (msg === "无权操作该课程") throw new AppError("无权操作该课程", 403);
      throw e; // 其余交由 handle 折叠为 500
    }

    const data = { lessonId, ...result };
    // 内核已写入占位/最佳努力稿不等于质量成功；必须保留 ok/failed 并返回非 2xx，
    // 否则前端仅看 HTTP/envelope 就会把失败节标成完成。
    if (!result.ok || result.failed) {
      await failGenJobLease(target.courseId, lease, "lesson quality gate failed", { genStatus: "generating" });
      return NextResponse.json(
        { ok: false, error: "本节未通过生成质量检查，请重试", data },
        { status: 422 },
      );
    }
    after(() => runCourseGenBackground(target.courseId, user.id, lease));
    return ok(data);
  });
}
