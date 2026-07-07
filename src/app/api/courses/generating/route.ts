import { prisma } from "@/lib/db";
import { ok, handle } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { getGenJob, finalizeGenJob } from "@/lib/course-gen";

export const dynamic = "force-dynamic";

/** 与 gen-progress 对齐：超过 15 分钟无心跳的 running job 不再展示为生产中。 */
const GEN_JOB_STALE_MS = 15 * 60_000;

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
      const job = await getGenJob(c.id);
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
        if (Date.now() - heartbeat > GEN_JOB_STALE_MS) {
          await prisma.course.update({ where: { id: c.id }, data: { genStatus: "failed" } });
          await finalizeGenJob(c.id, "failed");
          continue;
        }
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
