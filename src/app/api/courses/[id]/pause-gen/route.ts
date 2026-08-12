import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { pauseGenJob } from "@/lib/course-gen";

export const dynamic = "force-dynamic";

/**
 * POST /api/courses/:id/pause-gen —— L3 可控造课：暂停正在进行的逐节生成。
 *
 * 语义：只把 genStatus 从 generating 置为 paused，作为协作式停止信号。
 * 不抢先终结活 course_gen lease：正在跑的 LLM 阶段/课节保持心跳、安全落库，
 * owner 到下一边界才自行把 job 收敛为 paused。因此在 owner 退出前立即 resume 会正常 409。
 * 已完成的节保留、积分已按实扣计；未生成节不扣——「早停即天然止损」。续造走 resume-gen（其 allowlist 含 paused）。
 *
 * 越权铁律：assertSameOrigin + requireUser + authorUserId===user.id。仅 generating 态可暂停。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const { id } = await params;
    const user = await requireUser();

    const course = await prisma.course.findUnique({
      where: { id },
      select: { id: true, authorUserId: true, genStatus: true },
    });
    if (!course) return fail("课程不存在", 404);
    if (course.authorUserId !== user.id) throw new AppError("无权操作该课程", 403);

    // 仅正在生成中的课可暂停；已就绪/失败/暂停/大纲草稿态无意义。
    if (course.genStatus !== "generating") {
      return fail("该课程当前不在生成中，无法暂停", 409);
    }

    // 仅在当前活 lease 的 fence 下写入协作信号，lease 仍由 owner 持有。
    if (!await pauseGenJob(course.id)) return fail("生成任务已停止或所有权已变更", 409);

    const remaining = await prisma.lesson.count({ where: { courseId: course.id, blocksJson: null } });
    return ok({ paused: true, remaining, genStatus: "paused" });
  });
}
