import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

interface IncomingLesson {
  /** 已有节的 id（省略=新增节）。 */
  id?: string;
  title: string;
  summary?: string;
}

/**
 * PATCH /api/courses/:id/outline —— L2 可控造课：大纲检查点编辑（免费，无 LLM）。
 *
 * 语义：整份大纲「全量对账」——前端把编辑后的完整节列表（含课程元信息）回传，服务端据此：
 *   已有 id → 更新 title/summary + sortOrder（按数组序）；无 id → 新建空节（blocksJson=null，等确认后扇出）；
 *   回传里缺失的已有节 → 删除。isFree 恒重置为「仅首节」。课程 title/subtitle/description 可一并改。
 * 仅 genStatus==='outline_draft'（尚未扇出）可编辑——已开始/完成生成的课不能从这里改结构。
 * 越权铁律：assertSameOrigin + requireUser + authorUserId===user.id + 每个 id 必属本课（防 IDOR）。
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const { id } = await params;
    const user = await requireUser();

    const body = (await req.json().catch(() => null)) as {
      lessons?: IncomingLesson[];
      title?: string;
      subtitle?: string;
      description?: string;
    } | null;

    const rawLessons = Array.isArray(body?.lessons) ? body!.lessons : null;
    if (!rawLessons) return fail("缺少大纲节列表");
    // 规范化 + 校验：标题必填，长度上限对齐首次造课；导入现成大纲可包含较多课节。
    const lessons = rawLessons
      .filter((l) => l && typeof l.title === "string" && l.title.trim())
      .map((l) => ({
        id: typeof l.id === "string" && l.id ? l.id : undefined,
        title: l.title.trim().slice(0, 120),
        summary: (typeof l.summary === "string" ? l.summary : "").trim().slice(0, 300) || null,
      }));
    if (lessons.length === 0) return fail("大纲至少保留 1 节");
    if (lessons.length > 100) return fail("大纲最多 100 节");

    const course = await prisma.course.findUnique({
      where: { id },
      select: { id: true, authorUserId: true, genStatus: true, lessons: { select: { id: true } } },
    });
    if (!course) return fail("课程不存在", 404);
    if (course.authorUserId !== user.id) throw new AppError("无权操作该课程", 403);
    if (course.genStatus !== "outline_draft") {
      return fail("仅未开始生成的大纲草稿可编辑", 409);
    }

    // IDOR 防护：回传中带 id 的节必须属于本课现有节。
    const existingIds = new Set(course.lessons.map((l) => l.id));
    for (const l of lessons) {
      if (l.id && !existingIds.has(l.id)) return fail("大纲含非本课程的章节", 400);
    }

    const keepIds = new Set(lessons.filter((l) => l.id).map((l) => l.id as string));

    await prisma.$transaction(async (tx) => {
      // 删除被移除的已有节。
      const toDelete = [...existingIds].filter((eid) => !keepIds.has(eid));
      if (toDelete.length) {
        await tx.lesson.deleteMany({ where: { id: { in: toDelete }, courseId: course.id } });
      }
      // 按数组序落 sortOrder；已有节更新，无 id 新建（blocksJson=null 以便确认后被扇出识别为空节）。
      for (let i = 0; i < lessons.length; i++) {
        const l = lessons[i];
        if (l.id) {
          await tx.lesson.update({
            where: { id: l.id },
            data: { title: l.title, summary: l.summary, sortOrder: i, isFree: i === 0 },
          });
        } else {
          await tx.lesson.create({
            data: {
              courseId: course.id,
              title: l.title,
              summary: l.summary,
              sortOrder: i,
              contentType: "ai_block",
              blocksJson: null,
              isFree: i === 0,
              status: "published",
            },
          });
        }
      }
      // 课程元信息（可选）。
      const meta: { title?: string; subtitle?: string | null; description?: string | null } = {};
      if (typeof body?.title === "string" && body.title.trim()) meta.title = body.title.trim().slice(0, 120);
      if (typeof body?.subtitle === "string") meta.subtitle = body.subtitle.trim().slice(0, 200) || null;
      if (typeof body?.description === "string") meta.description = body.description.trim().slice(0, 2000) || null;
      if (Object.keys(meta).length) {
        await tx.course.update({ where: { id: course.id }, data: meta });
      }
    });

    const saved = await prisma.lesson.findMany({
      where: { courseId: course.id },
      orderBy: { sortOrder: "asc" },
      select: { id: true, title: true, summary: true },
    });
    return ok({ lessons: saved });
  });
}
