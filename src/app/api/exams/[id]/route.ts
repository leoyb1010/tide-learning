import { prisma } from "@/lib/db";
import { ok, fail, handle } from "@/lib/api";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/exams/:id —— 取试卷用于答题。
 *
 * 安全：**不下发正确答案 / 解析 / 溯源**（answer/explanation/sourceRef 只在交卷判卷后由 submit 返回），
 * 避免客户端在答题前偷看正解。只回题干、题型与选项。
 * 越权铁律：where userId 强制本人试卷；命中 0 视为不存在。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;

    const exam = await prisma.exam.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        title: true,
        difficulty: true,
        status: true,
        questions: {
          orderBy: { sortOrder: "asc" },
          select: { id: true, type: true, stem: true, optionsJson: true, sortOrder: true },
        },
      },
    });
    if (!exam) return fail("试卷不存在", 404);

    const questions = exam.questions.map((q) => {
      let options: string[] | null = null;
      if (q.optionsJson) {
        try {
          const parsed = JSON.parse(q.optionsJson);
          if (Array.isArray(parsed)) options = parsed.filter((o) => typeof o === "string");
        } catch {
          options = null;
        }
      }
      return { id: q.id, type: q.type, stem: q.stem, options };
    });

    return ok({ examId: exam.id, title: exam.title, difficulty: exam.difficulty, questions });
  });
}
