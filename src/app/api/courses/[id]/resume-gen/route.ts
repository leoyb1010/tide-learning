import { NextRequest, after } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { assertCanSpend } from "@/lib/credits";
import { assertUserRateLimit } from "@/lib/rate-limit";
import {
  assessCourseGenerationReadiness,
  claimCourseGenerationStart,
  ensureDesignBrief,
  failGenJobLease,
  finishGenJobLeaseOnly,
  finalizeCourseGeneration,
  initGenJob,
  runCourseGenBackground,
} from "@/lib/course-gen";

export const dynamic = "force-dynamic";

/**
 * POST /api/courses/:id/resume-gen —— 断点续造入口。
 *
 * 对 genStatus=generating/failed 的课，从第一个 blocksJson=null 的节继续 after() 后台生成。
 * 幂等：已有 course_gen job 处于 running 视为「已在跑」直接拒绝（避免并发重复扣费/重复生成）。
 * 越权铁律：requireUser + authorUserId===user.id。权益：需 canUseLLM + 余额预检。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const { id } = await params;
    const user = await requireUser();

    // 限流 + 权益闸门 + 余额预检（与首次造课 generate-course 完全一致，避免续造成为绕过门槛的口子）。
    // 此前无限流、且 assertCanSpend 未传 scene（门槛仅 1 分）——余额 1 分即可续造整门课欠账。
    // 独立作用域（2026-07-20 修复）：续造是给「已存在的课」补空节,不该吃掉当天的新造课名额
    // （此前共用 ai_gen_course 5/天,续两次课当天就不能再造新课）。
    assertUserRateLimit(user.id, "ai_gen_resume", 20, 86_400_000);
    const snapshot = await resolveEntitlement(user.id);
    if (!snapshot.canUseLLM) throw new AppError("AI 功能需订阅后使用", 402);

    const course = await prisma.course.findUnique({
      where: { id },
      select: { id: true, authorUserId: true, status: true, genStatus: true, modelUsed: true, presentationRevision: true },
    });
    if (!course) return fail("课程不存在", 404);
    if (course.authorUserId !== user.id) throw new AppError("无权操作该课程", 403);
    if (course.status === "archived") return fail("已归档课程不能续造", 409);

    // 余额预检按该课所用模型设门槛（P1-3：与首次造课一致），置于归属校验之后（不对非作者做扣费预检）。
    // 整课扇出成本仍由 runCourseGenBackground 的逐节积分门按累计预估兜住。
    await assertCanSpend(user.id, "generate_course", course.modelUsed ?? undefined);

    // 只有 generating / failed / paused 的课可续造（ready 无需续、其它态非造课课程）。
    // paused 是 L3 用户主动暂停（可控造课），续造入口与 failed 同路：复位 generating + 重跑后台。
    if (
      course.genStatus !== "generating" &&
      course.genStatus !== "failed" &&
      course.genStatus !== "paused"
    ) {
      return fail("该课程无需续造", 409);
    }

    // 无空节 = 已全部生成：顺手把 genStatus 收敛为 ready，返回 done
    // 口径与 runCourseGenBackground 一致(B3,2026-07-21):待处理 = 空节 + 降级占位节。
    // 否则占位节课走「无空节 → 直接置 ready」捷径,「继续生成」点了等于什么都没修。
    const readiness = await assessCourseGenerationReadiness(course.id);
    const remaining = readiness.retryLessons.length;
    if (readiness.ready) {
      // 无待重试节也必须先 acquire：设计 brief/整课终审/HTML 都是付费且会写真值的阶段。
      const total = readiness.total;
      const lease = await initGenJob(course.id, user.id, total, {}, { allowCompletedReopen: true });
      if (!lease) return fail("该课程正在生成中，请稍后查看进度", 409);
      const started = await claimCourseGenerationStart({
        courseId: course.id,
        userId: user.id,
        lease,
        expectedGenStatus: course.genStatus,
        expectedPresentationRevision: course.presentationRevision,
      });
      if (!started) {
        await finishGenJobLeaseOnly(lease, "course resume state changed");
        return fail("课程状态已变更，请刷新后重试", 409);
      }
      await ensureDesignBrief(course.id, user.id, lease);
      const finalization = await finalizeCourseGeneration(course.id, {
        userId: user.id,
        settleIncomplete: true,
        jobLease: lease,
      });
      if (finalization.ready) return ok({ resumed: false, remaining: 0, genStatus: "ready" });
      return fail("课程整课终审未通过，请修订后重试", 409);
    }

    // 复位为 generating，重置/复用进度 job（total 以现有 lesson 数为准）
    const total = await prisma.lesson.count({ where: { courseId: course.id } });
    const lease = await initGenJob(course.id, user.id, total, {}, { allowCompletedReopen: true });
    if (!lease) return fail("该课程正在生成中，请稍后查看进度", 409);
    const started = await claimCourseGenerationStart({
      courseId: course.id,
      userId: user.id,
      lease,
      expectedGenStatus: course.genStatus,
      expectedPresentationRevision: course.presentationRevision,
    });
    if (!started) {
      await finishGenJobLeaseOnly(lease, "course resume state changed");
      return fail("课程状态已变更，请刷新后重试", 409);
    }

    // 已完成的节数写回 done（continue，不从 0 重算），交给后台推进剩余空节
    const courseId = course.id;
    after(async () => {
      await runCourseGenBackground(courseId, user.id, lease);
    });

    return ok({ resumed: true, remaining, genStatus: "generating" });
  });
}
