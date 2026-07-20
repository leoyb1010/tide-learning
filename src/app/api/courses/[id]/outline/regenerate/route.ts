import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { assertCanSpend, creditingOnUsage } from "@/lib/credits";
import { assertUserRateLimit } from "@/lib/rate-limit";
import { chatJson } from "@/lib/llm";
import { courseOutlinePrompt } from "@/lib/ai/prompts";
import { readBlueprint, blueprintOutlineFragment, lessonCountForLength } from "@/lib/ai/blueprint";
import { acquireInflight, releaseInflight } from "@/lib/ai/inflight";

export const dynamic = "force-dynamic";

interface OutlineItem {
  title: string;
  objective: string;
}
interface OutlineResult {
  title: string;
  subtitle: string;
  intro: string;
  outline: OutlineItem[];
}

/**
 * POST /api/courses/:id/outline/regenerate —— L2 可控造课：重新生成大纲（有偿，重跑大纲 LLM）。
 *
 * 语义：对 outline_draft 的课，用原始需求（存于 course_outline job.inputJson）重跑一次大纲 LLM，
 * 整体替换现有空节（此态下所有节 blocksJson=null，属全量替换）。genStatus 仍留 outline_draft，等确认。
 * 计费：与首次造课大纲完全一致——前置 assertCanSpend + 按真实 token creditingOnUsage(generate_course)。
 * 防刷：复用与首次造课相同的 acquireInflight('course_gen') + 每天 5 门限流，堵重复重生成的重复扣费。
 * 越权铁律：assertSameOrigin + requireUser + authorUserId + genStatus==='outline_draft'。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const { id } = await params;
    const user = await requireUser();

    assertUserRateLimit(user.id, "ai_gen_course", 5, 86_400_000);
    const snapshot = await resolveEntitlement(user.id);
    if (!snapshot.canUseLLM) throw new AppError("AI 功能需订阅后使用", 402);

    if (!acquireInflight("course_gen", user.id)) {
      return fail("已有生成任务进行中，请稍后再试", 409);
    }
    try {
      const course = await prisma.course.findUnique({
        where: { id },
        select: { id: true, authorUserId: true, genStatus: true, category: true, template: true, modelUsed: true, blueprintJson: true },
      });
      if (!course) return fail("课程不存在", 404);
      if (course.authorUserId !== user.id) throw new AppError("无权操作该课程", 403);
      if (course.genStatus !== "outline_draft") {
        return fail("仅未开始生成的大纲草稿可重新生成", 409);
      }

      await assertCanSpend(user.id, "generate_course", course.modelUsed ?? undefined);

      // 原始需求：优先取本课 course_outline job 落库的 prompt；缺失则回退课程标题（历史/异常兜底）。
      const outlineJob = await prisma.generationJob.findFirst({
        where: { userId: user.id, type: "course_outline", resultRef: course.id },
        orderBy: { createdAt: "desc" },
        select: { inputJson: true },
      });
      let basePrompt = "";
      try {
        const parsed = JSON.parse(outlineJob?.inputJson || "{}") as { prompt?: string };
        if (typeof parsed.prompt === "string") basePrompt = parsed.prompt.trim();
      } catch {
        /* 脏 inputJson → 回退 */
      }
      if (!basePrompt) {
        const c = await prisma.course.findUnique({ where: { id: course.id }, select: { title: true } });
        basePrompt = (c?.title || "").trim();
      }
      if (!basePrompt) return fail("缺少原始需求，无法重新生成大纲", 400);

      const category = course.category || "ai_skill";
      const blueprint = readBlueprint(course.blueprintJson);
      const { system, user: userMsg } = courseOutlinePrompt({ prompt: basePrompt, category, template: course.template ?? undefined });
      const result = await chatJson<OutlineResult>({
        system,
        user: userMsg + blueprintOutlineFragment(blueprint),
        temperature: 0.5,
        maxTokens: 6000,
        model: course.modelUsed ?? undefined,
        retries: 0,
        onUsage: creditingOnUsage(user.id, "generate_course"),
      });

      const rawOutline = Array.isArray(result?.outline) ? result.outline : [];
      const outline = rawOutline
        .filter((o) => o && typeof o.title === "string" && o.title.trim())
        .map((o) => ({
          title: o.title.trim().slice(0, 120),
          objective: (typeof o.objective === "string" ? o.objective : "").trim().slice(0, 300),
        }))
        .slice(0, lessonCountForLength(blueprint?.length));
      if (outline.length === 0) throw new AppError("大纲生成失败，请调整需求后重试", 502);

      // 全量替换：删掉现有空节（outline_draft 态全部 blocksJson=null），按新大纲重建。
      await prisma.$transaction(async (tx) => {
        await tx.lesson.deleteMany({ where: { courseId: course.id } });
        for (let i = 0; i < outline.length; i++) {
          await tx.lesson.create({
            data: {
              courseId: course.id,
              title: outline[i].title,
              summary: outline[i].objective || null,
              sortOrder: i,
              contentType: "ai_block",
              blocksJson: null,
              isFree: i === 0,
              status: "published",
            },
          });
        }
        // 大纲标题/副标题/简介也随之刷新（若模型给了）。
        const meta: { title?: string; subtitle?: string | null; description?: string | null } = {};
        if (typeof result?.title === "string" && result.title.trim()) meta.title = result.title.trim().slice(0, 120);
        if (typeof result?.subtitle === "string") meta.subtitle = result.subtitle.trim().slice(0, 200) || null;
        if (typeof result?.intro === "string") meta.description = result.intro.trim().slice(0, 2000) || null;
        if (Object.keys(meta).length) await tx.course.update({ where: { id: course.id }, data: meta });
      });

      const saved = await prisma.lesson.findMany({
        where: { courseId: course.id },
        orderBy: { sortOrder: "asc" },
        select: { id: true, title: true, summary: true },
      });
      return ok({ regenerated: true, lessons: saved });
    } finally {
      releaseInflight("course_gen", user.id);
    }
  });
}
