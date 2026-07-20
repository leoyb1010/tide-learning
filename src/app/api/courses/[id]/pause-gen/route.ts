import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { finalizeGenJob } from "@/lib/course-gen";

export const dynamic = "force-dynamic";

/**
 * POST /api/courses/:id/pause-gen —— L3 可控造课：暂停正在进行的逐节生成。
 *
 * 语义：把 genStatus 从 generating 置为 paused，并把 course_gen job 从 running 摘到 paused 终态
 * （关键——否则 15 分钟僵尸对账 isGenJobStale 只扫 running，会把暂停课误判为 failed）。
 * 后台流水 runCourseGenBackground 每节前重读 genStatus，命中 paused 即停止扇出（当前在跑的节先自然跑完）。
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

    // 置 paused（后台循环据此停扇出）+ 立即把 job 摘到 paused 终态（robust against 已被杀死的后台进程）。
    await prisma.course.update({ where: { id: course.id }, data: { genStatus: "paused" } });
    await finalizeGenJob(course.id, "paused");

    const remaining = await prisma.lesson.count({ where: { courseId: course.id, blocksJson: null } });
    return ok({ paused: true, remaining, genStatus: "paused" });
  });
}
