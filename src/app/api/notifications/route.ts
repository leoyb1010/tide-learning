import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, handle, assertSameOrigin } from "@/lib/api";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** 通知公开视图（列表用）。 */
interface NotifView {
  id: string;
  type: string;
  title: string;
  body: string | null;
  refType: string | null;
  refId: string | null;
  read: boolean;
  createdAt: string;
}

/**
 * GET /api/notifications — 当前用户的通知列表。
 * 越权铁律：where userId 过滤，仅取自己的通知；最近 30 条按 createdAt desc。
 * 附带未读数（unread），供铃铛角标与「全部已读」判断。
 */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();

    const [rows, unread] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);

    const items: NotifView[] = rows.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      refType: n.refType,
      refId: n.refId,
      read: n.readAt !== null,
      createdAt: n.createdAt.toISOString(),
    }));

    return ok({ items, unread });
  });
}

/**
 * PATCH /api/notifications — 标记已读。
 * 入参：{ id } 单条 或 { all: true } 全部。
 * 越权铁律：updateMany 始终带 where userId，只可改自己的通知；已读的不重复写。
 * A2：写操作做同源校验。
 */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();

    const body = (await req.json().catch(() => null)) as {
      id?: string;
      all?: boolean;
    } | null;

    const now = new Date();

    if (body?.all) {
      const res = await prisma.notification.updateMany({
        where: { userId: user.id, readAt: null },
        data: { readAt: now },
      });
      return ok({ updated: res.count });
    }

    if (body?.id) {
      // 带 userId 作为越权防护：他人通知的 id 命中 0 行，天然无副作用。
      const res = await prisma.notification.updateMany({
        where: { id: body.id, userId: user.id, readAt: null },
        data: { readAt: now },
      });
      return ok({ updated: res.count });
    }

    return ok({ updated: 0 });
  });
}
