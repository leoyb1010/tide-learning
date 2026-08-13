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
        // 性能(2026-07-21 实测修复):此前 select blocksJson 只为在 JS 里数「非空条数」,
        // 单次响应实测 202.5KB;而本路由被前端 8 秒轮询、且恰在造课期间(blocksJson 最满时)持续触发,
        // 一门 15 节课 10 分钟 ≈ 75 次 × 200KB ≈ 15MB 无谓传输。
        // 现在:done 用带 where 的关系计数(不搬运正文),total/firstLessonId 用只含 id 的轻量数组。
        _count: { select: { lessons: { where: { blocksJson: { not: null } } } } },
        lessons: { orderBy: { sortOrder: "asc" }, select: { id: true } },
      },
    });

    const courses = [];
    for (const c of rows) {
      const total = c.lessons.length;
      const done = c._count.lessons; // 带 where 的关系计数(blocksJson 非空),不搬运正文

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
