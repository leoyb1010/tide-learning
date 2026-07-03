import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { deriveLevel } from "@/lib/level";
import { ProfilePostList } from "@/components/ProfilePostList";
import type { PostView } from "@/components/PostCard";

export const dynamic = "force-dynamic";

/** 学号：userId 派生一个稳定的 5 位 base32 短码（展示用，非安全标识；与 Sidebar 学生证一致）。 */
function shortStudentId(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 33 + userId.charCodeAt(i)) >>> 0;
  const base32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // 去掉易混 I/L/O/U
  let code = "";
  for (let i = 0; i < 5; i++) {
    code = base32[h % 32] + code;
    h = Math.floor(h / 32);
  }
  return `STU-${code}`;
}

/** JSON 字符串字段安全解析为 string[]（脏数据回落空数组）。 */
function readJsonStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const target = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: { nickname: true },
  });
  return { title: target ? `${target.nickname} 的主页` : "个人主页" };
}

/**
 * /u/[id] —— 个人主页（server）。
 * 身份摘要（头像 + 昵称 + 学号 + 等级 + 发帖数）+ 该用户的 approved 帖子流。
 * 只读页：游客可看；帖子流的互动由 PostCard(client) 承接（未登录/未订阅会给引导）。
 */
export default async function UserProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const viewer = await getCurrentUser();

  const target = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      nickname: true,
      avatarUrl: true,
      createdAt: true,
    },
  });
  if (!target) notFound();

  // 并行：发帖数（approved）+ 累计学习时长（算等级）+ 该用户 approved 帖子（含 viewer 点赞、原帖摘要）
  const [postCount, progressAgg, posts, viewerSnapshot] = await Promise.all([
    prisma.post.count({ where: { userId: target.id, status: "approved" } }),
    prisma.learningProgress.aggregate({ where: { userId: target.id }, _sum: { progressSec: true } }),
    prisma.post.findMany({
      where: { userId: target.id, status: "approved" },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        user: { select: { id: true, nickname: true, avatarUrl: true } },
        // 越权铁律：仅取当前查看者的点赞用于 likedByMe
        likes: viewer ? { where: { userId: viewer.id }, select: { id: true } } : false,
        repostOf: {
          select: {
            id: true,
            content: true,
            images: true,
            topicTags: true,
            status: true,
            user: { select: { id: true, nickname: true, avatarUrl: true } },
          },
        },
      },
    }),
    viewer ? resolveEntitlement(viewer.id) : Promise.resolve(null),
  ]);

  const level = deriveLevel(progressAgg._sum.progressSec ?? 0);
  const studentNo = shortStudentId(target.id);
  const joined = `${target.createdAt.getFullYear()}.${String(target.createdAt.getMonth() + 1).padStart(2, "0")}`;
  const initial = target.nickname?.slice(0, 1) || "学";
  const canInteract = Boolean(viewerSnapshot?.canUseLLM || viewerSnapshot?.isSubscriber);

  const views: PostView[] = posts.map((p) => {
    const origin = p.repostOf;
    const repostOf: PostView["repostOf"] = origin
      ? {
          id: origin.id,
          content: origin.status === "approved" ? origin.content : "原帖已删除",
          images: origin.status === "approved" ? readJsonStringArray(origin.images) : [],
          topicTags: origin.status === "approved" ? readJsonStringArray(origin.topicTags) : [],
          author: { id: origin.user.id, nickname: origin.user.nickname, avatarUrl: origin.user.avatarUrl },
          status: origin.status === "approved" ? "approved" : "deleted",
        }
      : null;
    return {
      id: p.id,
      type: p.type,
      content: p.content,
      images: readJsonStringArray(p.images),
      topicTags: readJsonStringArray(p.topicTags),
      likeCount: p.likeCount,
      commentCount: p.commentCount,
      repostCount: p.repostCount,
      createdAt: p.createdAt.toISOString(),
      author: { id: p.user.id, nickname: p.user.nickname, avatarUrl: p.user.avatarUrl },
      likedByMe: Boolean((p as { likes?: unknown[] }).likes?.length),
      repostOfId: p.repostOfId,
      repostOf,
    };
  });

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-6">
      {/* 身份摘要卡 */}
      <section className="studio-rise relative overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--card)]">
        <div className="flex items-center gap-4">
          {/* 头像 */}
          {target.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={target.avatarUrl} alt="" className="h-16 w-16 shrink-0 rounded-full object-cover" />
          ) : (
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-[var(--surface-inset)] text-[26px] font-bold text-[var(--ink2)]">
              {initial}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[22px] font-bold leading-tight text-[var(--ink)]">{target.nickname}</h1>
              {/* 红色身份点 —— 页面唯一的红 */}
              <span className="h-2 w-2 shrink-0 rounded-[2px] bg-[var(--red)]" aria-hidden />
            </div>
            <p className="mono mt-1 text-[11px] tracking-[0.1em] text-[var(--ink4)]">
              {studentNo} · JOINED {joined}
            </p>
          </div>
        </div>

        {/* 三个数字：等级 / 发帖数 / 学习时长 */}
        <div className="mt-6 grid grid-cols-3 gap-3">
          <Stat value={`Lv.${level.level}`} label={level.title} />
          <Stat value={`${postCount}`} label="发帖" />
          <Stat value={`${level.hours >= 1 ? Math.round(level.hours) : level.hours}`} unit="h" label="累计学习" />
        </div>
      </section>

      {/* 帖子流 */}
      <section className="flex flex-col gap-4">
        <h2 className="text-[16px] font-bold text-[var(--ink)]">TA 的动态</h2>
        <ProfilePostList posts={views} isLoggedIn={Boolean(viewer)} canInteract={canInteract} />
      </section>
    </div>
  );
}

/** 摘要数字块（mono 数字，STUDIO 风格）。 */
function Stat({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface-inset)] px-4 py-3">
      <p className="font-[var(--font-jakarta)] text-[24px] font-extrabold leading-none text-[var(--ink)]">
        {value}
        {unit && <span className="ml-0.5 text-[13px] font-semibold text-[var(--ink3)]">{unit}</span>}
      </p>
      <p className="mono mt-1.5 truncate text-[10px] uppercase tracking-[0.12em] text-[var(--ink4)]">{label}</p>
    </div>
  );
}
