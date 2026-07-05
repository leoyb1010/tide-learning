import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { ok, handle } from "@/lib/api";

export const dynamic = "force-dynamic";

// 分页默认与上限（cursor 分页，避免全量返回拖垮错题本）。
const PAGE_DEFAULT = 30;
const PAGE_MAX = 50;

/**
 * GET /api/me/mistakes —— 错题本（流3-U3 复习闭环）。
 *
 * 列出「当前用户」判卷判错的题（每次 submit 落库的 ExamMistake 快照），
 * 按 createdAt 倒序 + id 倒序稳定排序，附来源题干/正解/我的答案/溯源。
 * 支持 ?courseId=<id> 过滤某课；?cursor=<mistakeId>&limit=<n>（默认 30，上限 50）分页。
 * 返回 { mistakes, groups, nextCursor, total }：
 *   - mistakes：当前页扁平列表（每项含课程标题，便于直接展示）。
 *   - groups：当前页按课程归组（错题本课程视图直接消费；无课归属的进「独立」组外，仅在扁平列表）。
 *   - total：满足过滤条件的错题总数（供「共 N 题」显示）。
 *
 * 越权铁律：where 恒带 userId，只读本人错题；courseId 过滤在 userId 之内，无法看到他人数据。
 * 无需 LLM 权益（纯读本人数据）。
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();

    const sp = req.nextUrl.searchParams;
    const courseId = sp.get("courseId")?.trim() || null;
    const cursor = sp.get("cursor")?.trim() || null;

    // limit：非法/缺省回落默认值，钳制到上限，防止客户端拉全量。
    const limitRaw = Number.parseInt(sp.get("limit") ?? "", 10);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, PAGE_MAX) : PAGE_DEFAULT;

    // 越权铁律：userId 恒在 where 首位；courseId 过滤只在本人错题内生效。
    const where: Prisma.ExamMistakeWhereInput = {
      userId: user.id,
      ...(courseId ? { courseId } : {}),
    };

    // total 与分页查询并发。
    const [total, rows] = await Promise.all([
      prisma.examMistake.count({ where }),
      prisma.examMistake.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: limit + 1, // 多取 1 条判断是否有下一页
        select: {
          id: true,
          examId: true,
          attemptId: true,
          questionId: true,
          stem: true,
          correctAnswer: true,
          userAnswer: true,
          sourceRef: true,
          courseId: true,
          createdAt: true,
        },
      }),
    ]);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    // 下一页游标 = 当前页最后一行 id。下一页查询用 cursor+skip:1，会排除游标自身，
    // 故必须取「当前页末行」而非多取的那条（取多取行会导致它被 skip 掉、边界行丢失）。
    const nextCursor = hasMore ? pageRows[pageRows.length - 1].id : null;

    // 补课程标题（用于错题来源展示）：只查涉及到的课程，避免 N+1。
    const courseIds = Array.from(
      new Set(pageRows.map((m) => m.courseId).filter((x): x is string => Boolean(x))),
    );
    const courses = courseIds.length
      ? await prisma.course.findMany({
          where: { id: { in: courseIds } },
          select: { id: true, title: true, slug: true },
        })
      : [];
    const courseOf = new Map(courses.map((c) => [c.id, c]));

    const mistakes = pageRows.map((m) => ({
      id: m.id,
      examId: m.examId,
      attemptId: m.attemptId,
      questionId: m.questionId,
      stem: m.stem,
      correctAnswer: m.correctAnswer,
      userAnswer: m.userAnswer,
      sourceRef: m.sourceRef,
      courseId: m.courseId,
      courseTitle: m.courseId ? courseOf.get(m.courseId)?.title ?? null : null,
      createdAt: m.createdAt,
    }));

    // 按课程归组（错题本课程视图消费）。无课归属的错题不进课程组，仅在扁平 mistakes 出现。
    const groupMap = new Map<
      string,
      { courseId: string; course: { title: string; slug: string }; items: typeof mistakes }
    >();
    for (const m of mistakes) {
      if (!m.courseId) continue;
      const c = courseOf.get(m.courseId);
      if (!c) continue;
      const g =
        groupMap.get(m.courseId) ?? {
          courseId: m.courseId,
          course: { title: c.title, slug: c.slug },
          items: [] as typeof mistakes,
        };
      g.items.push(m);
      groupMap.set(m.courseId, g);
    }

    return ok({
      mistakes,
      groups: Array.from(groupMap.values()),
      nextCursor,
      total,
    });
  });
}
