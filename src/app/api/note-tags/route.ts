import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, getCurrentUser } from "@/lib/session";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// 允许的标签配色（对应 Badge tone）
const TAG_COLORS = ["accent", "success", "warning", "error", "muted"] as const;

// GET /api/note-tags — 列出本人标签（含各标签笔记数，供筛选器展示）
export async function GET() {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return ok({ tags: [] });
    const tags = await prisma.noteTag.findMany({
      where: { userId: user.id },
      include: { _count: { select: { notes: true } } },
      orderBy: { createdAt: "asc" },
    });
    return ok({
      tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color, count: t._count.notes })),
    });
  });
}

// POST /api/note-tags — 创建标签（同名 upsert，避免重复）
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    assertRateLimit(req, "note_tag_create", 30, 60_000);

    const body = (await req.json()) as { name?: string; color?: string };
    const name = body.name?.trim();
    if (!name) return fail("标签名不能为空");
    if (name.length > 20) return fail("标签名过长");
    const color = (TAG_COLORS as readonly string[]).includes(body.color ?? "") ? body.color! : "accent";

    // 依赖 @@unique([userId, name]) 做幂等 upsert
    const tag = await prisma.noteTag.upsert({
      where: { userId_name: { userId: user.id, name } },
      create: { userId: user.id, name, color },
      update: { color },
    });
    return ok(tag);
  });
}
