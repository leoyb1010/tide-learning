import { prisma } from "@/lib/db";
import { ok, handle } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { getGenJobsFor, finalizeGenJob, isGenJobStale, reconcileStaleGenJobs } from "@/lib/course-gen";

export const dynamic = "force-dynamic";

/**
 * GET /api/courses/generating —— 我正在生成中的课（轻量列表，供全局生产中指示 / 横幅）。
 *
 * 越权铁律：requireUser + 只列自己 (authorUserId===user.id) 且 genStatus=generating 的造课/导入课。
 * 返回每门课 {id,slug,title,isImport,total,done,firstLessonId}，done 以 blocksJson 非空计。
 * 只读、不涉写、不扣费；按 createdAt desc，取最近若干门。
 */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();

    // P1-4：先兜底对账「本人」名下 status=running 但心跳过期的僵尸 job（不依赖 genStatus）。
    // 借前端 8s 轮询这条高频路径顺手驱动收尾，避免 job 与 course 状态分叉后永久卡 running。
    await reconcileStaleGenJobs(user.id);

    const rows = await prisma.course.findMany({
      where: {
        authorUserId: user.id,
        genStatus: "generating",
        origin: { in: ["ai_generated", "user_imported"] },
      },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        slug: true,
        title: true,
        origin: true,
        lessons: { orderBy: { sortOrder: "asc" }, select: { id: true, blocksJson: true } },
      },
    });

    // 一次批量取回这批课的最新 course_gen job（避免逐课 getGenJob 的 N+1；前端 8s 轮询会放大）。
    const jobMap = await getGenJobsFor(rows.map((c) => c.id));

    const courses = [];
    for (const c of rows) {
      const total = c.lessons.length;
      const done = c.lessons.filter((l) => l.blocksJson != null).length;

      // 列表自愈：全部 lesson 已就绪但 course.genStatus 没被后台收尾时，直接收敛 ready，
      // 避免“正在生成”横幅永久出现。
      if (total > 0 && done === total) {
        await prisma.course.update({ where: { id: c.id }, data: { genStatus: "ready" } });
        await finalizeGenJob(c.id, "done");
        continue;
      }

      // 僵尸 running job 不展示为“生产中”，同时置 failed，交由“继续生成”入口恢复。
      const job = jobMap.get(c.id);
      if (job?.status === "running" && isGenJobStale(job)) {
        await prisma.course.update({ where: { id: c.id }, data: { genStatus: "failed" } });
        await finalizeGenJob(c.id, "failed");
        continue;
      }

      courses.push({
        id: c.id,
        slug: c.slug,
        title: c.title,
        isImport: c.origin === "user_imported",
        total,
        done,
        firstLessonId: c.lessons[0]?.id ?? null,
      });
    }

    return ok({ courses });
  });
}
