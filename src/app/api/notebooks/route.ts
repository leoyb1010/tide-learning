import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, getCurrentUser } from "@/lib/session";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";

export const dynamic = "force-dynamic";

const TITLE_MAX = 40;

/**
 * GET /api/notebooks — 列出当前用户的笔记本
 * 越权铁律：where userId 强制隔离；每个笔记本带 notes 计数(_count)，按 updatedAt desc。
 * 游客：返回空列表（与 /api/notes 一致，不抛 401，便于前端统一渲染登录态）。
 */
export async function GET() {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return ok({ notebooks: [] });

    const rows = await prisma.notebook.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        title: true,
        description: true,
        icon: true,
        updatedAt: true,
        _count: { select: { notes: { where: { deletedAt: null } } } },
      },
      orderBy: { updatedAt: "desc" },
    });

    const notebooks = rows.map((n) => ({
      id: n.id,
      title: n.title,
      description: n.description,
      icon: n.icon,
      noteCount: n._count.notes,
      updatedAt: n.updatedAt,
    }));

    return ok({ notebooks });
  });
}

/**
 * POST /api/notebooks — 新建笔记本
 * 入参：{ title, description?, icon? }；title 必填、trim 后 ≤40 字。
 * 越权铁律：userId 强制取自会话，绝不信任客户端传入的所有者。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();

    const body = (await req.json().catch(() => ({}))) as {
      title?: string;
      description?: string;
      icon?: string;
    };

    const title = body.title?.trim();
    if (!title) return fail("笔记本标题不能为空");
    if (title.length > TITLE_MAX) return fail(`标题最多 ${TITLE_MAX} 个字`);

    const description = body.description?.trim() || null;
    const icon = body.icon?.trim() || null;

    const notebook = await prisma.notebook.create({
      data: { userId: user.id, title, description, icon },
      select: { id: true, title: true, description: true, icon: true, updatedAt: true },
    });

    return ok(notebook);
  });
}
