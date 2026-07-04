import { prisma } from "@/lib/db";
import { ok, handle } from "@/lib/api";
import { requireUser } from "@/lib/session";

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

    const courses = rows.map((c) => ({
      id: c.id,
      slug: c.slug,
      title: c.title,
      isImport: c.origin === "user_imported",
      total: c.lessons.length,
      done: c.lessons.filter((l) => l.blocksJson != null).length,
      firstLessonId: c.lessons[0]?.id ?? null,
    }));

    return ok({ courses });
  });
}
