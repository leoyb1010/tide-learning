import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { createCourseContentBrief, serializeCourseContentBrief, withConfirmedCourseOutline } from "@/lib/ai/content-brief";
import { sourcePolicyForFinalCourseOutline } from "@/lib/ai/source-policy";
import { resolveCourseSourceTruth } from "@/lib/ai/course-source-truth";

export const dynamic = "force-dynamic";

interface IncomingLesson {
  /** 已有节的 id（省略=新增节）。 */
  id?: string;
  title: string;
  summary?: string | null;
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
        summary: typeof l.summary === "string" ? (l.summary.trim().slice(0, 300) || null) : l.summary === null ? null : undefined,
      }));
    if (lessons.length === 0) return fail("大纲至少保留 1 节");
    if (lessons.length > 100) return fail("大纲最多 100 节");

    const course = await prisma.course.findUnique({
      where: { id },
      select: {
        id: true, title: true, category: true, authorUserId: true, status: true, genStatus: true, origin: true,
        presentationRevision: true,
        blueprintJson: true, contentBriefJson: true,
        lessons: { select: { id: true, title: true, summary: true } },
      },
    });
    if (!course) return fail("课程不存在", 404);
    if (course.authorUserId !== user.id) throw new AppError("无权操作该课程", 403);
    if (course.status === "archived") return fail("已归档课程不能编辑大纲", 409);
    if (course.genStatus !== "outline_draft") {
      return fail("仅未开始生成的大纲草稿可编辑", 409);
    }

    // IDOR 防护：回传中带 id 的节必须属于本课现有节。
    const existingIds = new Set(course.lessons.map((l) => l.id));
    const incomingIds = lessons.flatMap((lesson) => lesson.id ? [lesson.id] : []);
    if (new Set(incomingIds).size !== incomingIds.length) return fail("大纲含重复章节", 400);
    for (const l of lessons) {
      if (l.id && !existingIds.has(l.id)) return fail("大纲含非本课程的章节", 400);
    }

    // 来源硬门：用「这次 PATCH 真正会落库的最终文本」重算，不信任旧课名或请求体临时声称的来源。
    // 已有课节省略 summary 表示保留旧值，所以先按 PATCH 语义合并，避免用省略字段绕过高风险关键词。
    const sourceTruth = await resolveCourseSourceTruth(course);
    if (sourceTruth.requiresActualSource && !sourceTruth.hasActualSource) {
      return fail("导入课程的原始资料已丢失或未解析完成，无法继续编辑大纲", 422);
    }
    const currentBrief = sourceTruth.contentBrief
      ?? createCourseContentBrief({ request: course.title, requestProvenance: "course_title" });
    const existingLessons = new Map(course.lessons.map((lesson) => [lesson.id, lesson]));
    const finalCourseTitle = typeof body?.title === "string" && body.title.trim()
      ? body.title.trim().slice(0, 120)
      : course.title;
    const finalLessons = lessons.map((lesson) => ({
      title: lesson.title,
      summary: lesson.summary === undefined && lesson.id
        ? existingLessons.get(lesson.id)?.summary ?? null
        : lesson.summary ?? null,
    }));
    // 只把用户本次真正改动的字段当作可信日期证据。整份检查点 payload 会回显
    // 模型初始大纲，若盲目信任整包文本，模型自己写的“截至某日”会被洗成用户证据。
    const trustedPatchText = [
      typeof body?.title === "string" && finalCourseTitle !== course.title ? finalCourseTitle : "",
      ...lessons.flatMap((lesson) => {
        const prior = lesson.id ? existingLessons.get(lesson.id) : null;
        const changedTitle = !prior || lesson.title !== prior.title;
        const nextSummary = lesson.summary === undefined ? prior?.summary ?? null : lesson.summary ?? null;
        const changedSummary = !prior || (lesson.summary !== undefined && nextSummary !== prior.summary);
        return [changedTitle ? lesson.title : "", changedSummary ? nextSummary ?? "" : ""];
      }),
    ].filter(Boolean).join("\n");
    const sourceGate = sourcePolicyForFinalCourseOutline({
      courseTitle: finalCourseTitle,
      originalRequest: currentBrief.request,
      lessons: finalLessons,
      category: course.category,
      sourceAvailable: sourceTruth.hasActualSource,
      persistedSourceAsOf: sourceTruth.trustedSourceAsOf,
      trustedDateText: trustedPatchText,
      actualSourceText: sourceTruth.actualSourceText,
    });
    if (sourceGate.missingSource) {
      return fail(`${sourceGate.reason ?? "该主题需要外部真值"}，请先提供可核查的一手或官方参考资料`, 422);
    }
    if (sourceGate.missingAsOfDate) {
      return fail("该主题包含最新/当前信息，请在课程标题、原始需求或课节中写明截至日期（例如：截至 2026-08-12）", 422);
    }

    const keepIds = new Set(lessons.filter((l) => l.id).map((l) => l.id as string));

    await prisma.$transaction(async (tx) => {
      // 先以课程快照做第一个写 CAS。SQLite 中它同时取得写序：
      // confirm / outline-regenerate 若已取得租约，下方活任务门回滚；若它们稍后启动，
      // 必须看到新 revision，无法用旧大纲覆盖。草稿编辑不应把 genStatus 改成 failed。
      const claimed = await tx.course.updateMany({
        where: {
          id: course.id,
          authorUserId: user.id,
          status: { not: "archived" },
          genStatus: "outline_draft",
          presentationRevision: course.presentationRevision,
        },
        data: {
          presentationRevision: { increment: 1 },
          generationQualityJson: null,
          ...(typeof body?.title === "string" && body.title.trim()
            ? { title: body.title.trim().slice(0, 120) }
            : {}),
          ...(typeof body?.subtitle === "string"
            ? { subtitle: body.subtitle.trim().slice(0, 200) || null }
            : {}),
          ...(typeof body?.description === "string"
            ? { description: body.description.trim().slice(0, 2000) || null }
            : {}),
        },
      });
      if (claimed.count !== 1) throw new AppError("课程大纲状态已变更，请刷新后重试", 409);
      const activeGeneration = await tx.generationJob.count({
        where: {
          resultRef: course.id,
          type: { in: ["course_gen", "outline_regen"] },
          status: "running",
          // 只有未过期的持久租约才是 owner。历史 NULL lease 会由迁移/worker
          // 收敛为 failed，不能永久封死大纲；租约协议本身也把 NULL 视为可接管。
          leaseUntil: { gt: new Date() },
        },
      });
      if (activeGeneration > 0) throw new AppError("课程生成任务正在运行，请稍后再编辑", 409);

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
            data: { title: l.title, ...(l.summary !== undefined ? { summary: l.summary } : {}), sortOrder: i, isFree: i === 0 },
          });
        } else {
          await tx.lesson.create({
            data: {
              courseId: course.id,
              title: l.title,
              summary: l.summary ?? null,
              sortOrder: i,
              contentType: "ai_block",
              blocksJson: null,
              isFree: i === 0,
              status: "published",
            },
          });
        }
      }
      const confirmedLessons = await tx.lesson.findMany({
        where: { courseId: course.id }, orderBy: { sortOrder: "asc" }, select: { title: true, summary: true },
      });
      const stored = await tx.course.updateMany({
        where: {
          id: course.id,
          status: { not: "archived" },
          genStatus: "outline_draft",
          presentationRevision: course.presentationRevision + 1,
        },
        data: {
          contentBriefJson: serializeCourseContentBrief(withConfirmedCourseOutline({
            ...currentBrief,
            ...(sourceGate.effectiveAsOfDate ? { sourceAsOf: sourceGate.effectiveAsOfDate } : {}),
          }, confirmedLessons)),
        },
      });
      if (stored.count !== 1) throw new AppError("课程大纲状态已变更，请刷新后重试", 409);
    });

    const saved = await prisma.lesson.findMany({
      where: { courseId: course.id },
      orderBy: { sortOrder: "asc" },
      select: { id: true, title: true, summary: true },
    });
    return ok({ lessons: saved });
  });
}
