import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { CATEGORY_LABELS, relativeTime } from "@/lib/queries";
import { ok, fail, handle } from "@/lib/api";

// GET /api/demands/:id — 需求详情（§6.6：标题、描述、票数、状态、状态日志、官方反馈、相似需求、对应课程）
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    await getCurrentUser();
    const demand = await prisma.demand.findUnique({
      where: { id },
      include: {
        votes: true,
        statusLogs: { orderBy: { createdAt: "asc" } },
        user: { select: { nickname: true } },
      },
    });
    if (!demand) return fail("需求不存在", 404);

    const totalVotes = demand.votes.reduce((s, v) => s + v.voteCount, 0);
    const similar = await prisma.demand.findMany({
      where: { id: { not: id }, category: demand.category, status: { not: "rejected" } },
      take: 3,
      select: { id: true, title: true, status: true },
    });
    const launchedCourse = demand.launchedCourseId
      ? await prisma.course.findUnique({ where: { id: demand.launchedCourseId }, select: { id: true, slug: true, title: true } })
      : null;

    return ok({
      demand: {
        ...demand,
        categoryLabel: CATEGORY_LABELS[demand.category] ?? demand.category,
        totalVotes,
      },
      statusLogs: demand.statusLogs.map((l) => ({ ...l, relativeTime: relativeTime(l.createdAt) })),
      similar,
      launchedCourse,
    });
  });
}
