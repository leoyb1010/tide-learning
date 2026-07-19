import { NextRequest, after } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { assertCanSpend } from "@/lib/credits";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { getGenJob, initGenJob, renderCourseHtmlBestEffort, runCourseGenBackground } from "@/lib/course-gen";

export const dynamic = "force-dynamic";

/** running job 心跳超时阈值：超过 15 分钟无心跳视为 stale（进程重启杀死 after() 遗留），允许续造。 */
const GEN_JOB_STALE_MS = 15 * 60_000;

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
    assertUserRateLimit(user.id, "ai_gen_course", 5, 86_400_000);
    const snapshot = await resolveEntitlement(user.id);
    if (!snapshot.canUseLLM) throw new AppError("AI 功能需订阅后使用", 402);

    const course = await prisma.course.findUnique({
      where: { id },
      select: { id: true, authorUserId: true, genStatus: true, modelUsed: true },
    });
    if (!course) return fail("课程不存在", 404);
    if (course.authorUserId !== user.id) throw new AppError("无权操作该课程", 403);

    // 余额预检按该课所用模型设门槛（P1-3：与首次造课一致），置于归属校验之后（不对非作者做扣费预检）。
    // 整课扇出成本仍由 runCourseGenBackground 的逐节积分门按累计预估兜住。
    await assertCanSpend(user.id, "generate_course", course.modelUsed ?? undefined);

    // 只有 generating / failed 的课可续造（ready 无需续、其它态非造课课程）
    if (course.genStatus !== "generating" && course.genStatus !== "failed") {
      return fail("该课程无需续造", 409);
    }

    // 无空节 = 已全部生成：顺手把 genStatus 收敛为 ready，返回 done
    const remaining = await prisma.lesson.count({
      where: { courseId: course.id, blocksJson: null },
    });
    if (remaining === 0) {
      // 此处 genStatus 只可能是 generating/failed（上面已排除其它），一律收敛为 ready。
      // 根因修复(2026-07-20)：收敛前补渲 HTML 课件（幂等，已渲过的节被源哈希短路）——
      // 此前该捷径只置 ready，经此路收尾的课整课无 htmlJson，永远回落旧版块课件。
      await renderCourseHtmlBestEffort(course.id);
      await prisma.course.update({ where: { id: course.id }, data: { genStatus: "ready" } });
      return ok({ resumed: false, remaining: 0, genStatus: "ready" });
    }

    // —— 幂等：已在跑（course_gen job=running）则拒绝，防并发重复生成 ——
    // 但 running 可能是「僵尸」：进程重启杀死 after() 后台后，job 永远停在 running，
    // 课程将永久卡 generating。心跳存 inputJson.heartbeatAt（GenerationJob 无 updatedAt 列），
    // 缺失回退 job.createdAt；超过 15 分钟无心跳视为 stale，放行续造（下方 initGenJob 会复用重置该 job）。
    const job = await getGenJob(course.id);
    if (job?.status === "running") {
      let heartbeat = job.createdAt.getTime();
      try {
        const p = JSON.parse(job.inputJson || "{}");
        if (typeof p.heartbeatAt === "string") {
          const t = Date.parse(p.heartbeatAt);
          if (Number.isFinite(t)) heartbeat = t;
        }
      } catch {
        /* 解析失败按 createdAt 兜底 */
      }
      if (Date.now() - heartbeat < GEN_JOB_STALE_MS) {
        return fail("该课程正在生成中，请稍后查看进度", 409);
      }
      // stale：视为遗留僵尸 job，继续走下方 claim 复位 + initGenJob 重置流程
    }

    // 释放遗留 claim：上一轮若在 claim 后、写库前被硬杀（如 serverless 超时），
    // 空节会卡在 genClaimedAt 非空且 blocksJson=null，generateLessonCore 的原子 claim 将永远抢不到。
    // 此处（已确认无 running job）把本课所有空节的 claim 复位，保证续造能重新认领。
    await prisma.lesson.updateMany({
      where: { courseId: course.id, blocksJson: null },
      data: { genClaimedAt: null },
    });

    // 复位为 generating，重置/复用进度 job（total 以现有 lesson 数为准）
    const total = await prisma.lesson.count({ where: { courseId: course.id } });
    await prisma.course.update({ where: { id: course.id }, data: { genStatus: "generating" } });
    await initGenJob(course.id, user.id, total, {});

    // 已完成的节数写回 done（continue，不从 0 重算），交给后台推进剩余空节
    const courseId = course.id;
    after(async () => {
      await runCourseGenBackground(courseId, user.id);
    });

    return ok({ resumed: true, remaining, genStatus: "generating" });
  });
}
