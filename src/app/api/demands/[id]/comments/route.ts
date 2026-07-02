import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser, hasPermission } from "@/lib/session";
import { track } from "@/lib/analytics";
import { renderMarkdown } from "@/lib/markdown";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// 极简敏感词过滤（占位：真实场景应接入词库/风控服务）。命中即拒绝发布。
const BLOCKLIST = ["政治敏感", "赌博", "色情", "毒品", "诈骗"];
function hitSensitive(text: string): boolean {
  return BLOCKLIST.some((w) => text.includes(w));
}

// 单条评论的公开视图（含作者与楼中楼回复）。
export interface CommentView {
  id: string;
  contentMd: string;
  contentHtml: string;
  isOfficial: boolean;
  createdAt: string;
  author: { id: string; nickname: string; avatarUrl: string | null };
  replies: CommentView[];
}

type CommentWithAuthor = Prisma.CommentGetPayload<{
  include: { user: { select: { id: true; nickname: true; avatarUrl: true } } };
}>;

function toView(c: CommentWithAuthor, replies: CommentView[]): CommentView {
  // 软删占位：保留楼层结构，但正文脱敏。
  const deleted = c.deletedAt != null;
  const src = deleted ? "_该评论已删除_" : c.contentMd;
  return {
    id: c.id,
    contentMd: deleted ? "" : c.contentMd,
    contentHtml: renderMarkdown(src),
    isOfficial: c.isOfficial,
    createdAt: c.createdAt.toISOString(),
    author: deleted
      ? { id: "", nickname: "已删除", avatarUrl: null }
      : c.user,
    replies,
  };
}

// GET /api/demands/:id/comments — 楼层 + 楼中楼（官方置顶在前）
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const all = await prisma.comment.findMany({
      where: { demandId: id },
      include: { user: { select: { id: true, nickname: true, avatarUrl: true } } },
      orderBy: { createdAt: "asc" },
    });

    // 按 parentId 归拢楼中楼。
    const childrenOf = new Map<string, CommentWithAuthor[]>();
    const roots: CommentWithAuthor[] = [];
    for (const c of all) {
      if (c.parentId) {
        const arr = childrenOf.get(c.parentId) ?? [];
        arr.push(c);
        childrenOf.set(c.parentId, arr);
      } else {
        roots.push(c);
      }
    }
    // 若父楼已被硬删则跳过其孤儿（正常有级联删除，这里做兜底）。
    const buildReplies = (parentId: string): CommentView[] =>
      (childrenOf.get(parentId) ?? []).map((r) => toView(r, buildReplies(r.id)));

    // 官方置顶：isOfficial 的根楼排在最前，其余按时间。
    const rootViews = roots
      .map((r) => toView(r, buildReplies(r.id)))
      .sort((a, b) => {
        if (a.isOfficial !== b.isOfficial) return a.isOfficial ? -1 : 1;
        return a.createdAt.localeCompare(b.createdAt);
      });

    return ok({ comments: rootViews, total: all.filter((c) => c.deletedAt == null).length });
  });
}

// POST /api/demands/:id/comments — 发评论（登录用户；版主发帖自动置顶）
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    // 高频写入限流：每用户 5 条 / 30 秒。
    assertRateLimit(req, `demand-comment:${user.id}`, 5, 30_000);

    const { id } = await params;
    const body = ((await req.json().catch(() => ({}))) as {
      content?: string;
      parentId?: string;
    }) ?? {};
    const content = (body.content ?? "").trim();
    if (!content) return fail("评论内容不能为空");
    if (content.length > 2000) return fail("评论过长（≤2000 字）");
    if (hitSensitive(content)) return fail("内容含敏感词，请修改后再发");

    const demand = await prisma.demand.findUnique({ where: { id }, select: { id: true } });
    if (!demand) return fail("需求不存在", 404);

    // 楼中楼：校验父楼属于同一需求且未删。
    if (body.parentId) {
      const parent = await prisma.comment.findUnique({
        where: { id: body.parentId },
        select: { demandId: true, deletedAt: true },
      });
      if (!parent || parent.demandId !== id || parent.deletedAt) {
        return fail("回复的楼层不存在", 404);
      }
    }

    // 版主发帖标记为官方并置顶。
    const isOfficial = hasPermission(user.role, "demand:moderate");

    const created = await prisma.comment.create({
      data: {
        demandId: id,
        userId: user.id,
        parentId: body.parentId ?? null,
        contentMd: content,
        isOfficial,
      },
      include: { user: { select: { id: true, nickname: true, avatarUrl: true } } },
    });

    await track({
      eventName: "demand_comment_add",
      userId: user.id,
      properties: { demand_id: id, is_reply: !!body.parentId, is_official: isOfficial },
    });

    return ok({ comment: toView(created, []) });
  });
}
