import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { track } from "@/lib/analytics";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";

export const dynamic = "force-dynamic";

// 正文长度上限（与 POST /api/notes 同口径）：防异常长 payload 撑爆库 / 后续 AI 整理拼接
const NOTE_CONTENT_MAX = 100_000;

// GET /api/notes/:id — 停订后仍可查看自己的笔记（§6.5 验收）
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const note = await prisma.note.findFirst({
      where: { id, userId: user.id, deletedAt: null },
      include: { tags: { include: { tag: { select: { id: true, name: true, color: true } } } } },
    });
    if (!note) return fail("笔记不存在", 404);
    return ok({ ...note, tags: note.tags.map((t) => t.tag) });
  });
}

/**
 * PATCH /api/notes/:id — 更新（自动保存 / 收藏 / 改标题 / 时间戳 / 加去标签）
 * 支持字段：contentMd、title、starred、timestampSec、addTagId、removeTagId。
 * 仅本人可改，越权当作 404（不泄露资源存在性）。
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const { id } = await params;
    // 空/畸形 body 折叠为 {}，走下方必填校验返回 fail，而非抛 SyntaxError 触发 500
    const body = (await req.json().catch(() => ({}))) as {
      title?: string | null;
      contentMd?: string;
      starred?: boolean;
      timestampSec?: number | null;
      addTagId?: string;
      removeTagId?: string;
    };

    // 运行时类型收窄：脏输入返回 400 而非透传 Prisma 触发 500
    if (body.starred !== undefined && typeof body.starred !== "boolean") {
      return fail("收藏状态非法", 400);
    }
    if (
      body.timestampSec !== undefined &&
      body.timestampSec !== null &&
      !Number.isInteger(body.timestampSec)
    ) {
      return fail("时间戳非法", 400);
    }
    if (typeof body.contentMd === "string" && body.contentMd.length > NOTE_CONTENT_MAX) {
      return fail(`笔记内容过长，请精简到 ${NOTE_CONTENT_MAX} 字以内`, 400);
    }

    const note = await prisma.note.findFirst({ where: { id, userId: user.id, deletedAt: null } });
    if (!note) return fail("笔记不存在", 404);

    // 标签挂载/卸载（标签必须属于本人）
    if (body.addTagId) {
      const tag = await prisma.noteTag.findFirst({ where: { id: body.addTagId, userId: user.id } });
      if (!tag) return fail("标签不存在", 404);
      await prisma.noteTagOnNote.upsert({
        where: { noteId_tagId: { noteId: id, tagId: body.addTagId } },
        create: { noteId: id, tagId: body.addTagId },
        update: {},
      });
    }
    if (body.removeTagId) {
      await prisma.noteTagOnNote.deleteMany({ where: { noteId: id, tagId: body.removeTagId } });
    }

    // 仅当传入对应字段时才更新，避免误清空
    const updated = await prisma.note.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title?.trim() || null } : {}),
        ...(body.contentMd !== undefined ? { contentMd: body.contentMd } : {}),
        ...(body.starred !== undefined ? { starred: body.starred } : {}),
        ...(body.timestampSec !== undefined ? { timestampSec: body.timestampSec } : {}),
      },
      include: { tags: { include: { tag: { select: { id: true, name: true, color: true } } } } },
    });

    return ok({ ...updated, tags: updated.tags.map((t) => t.tag) });
  });
}

// DELETE /api/notes/:id — 软删除（仅本人，越权 404）
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const { id } = await params;
    const note = await prisma.note.findFirst({ where: { id, userId: user.id, deletedAt: null } });
    if (!note) return fail("笔记不存在", 404);
    await prisma.note.update({ where: { id }, data: { deletedAt: new Date() } });
    await track({ eventName: "note_delete", userId: user.id, properties: { note_id: id, kind: note.kind } });
    return ok({ deleted: true });
  });
}
