import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { deriveLevel } from "@/lib/level";
import { ok, fail, handle } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * 学号：由 userId 派生的稳定 5 位 base32 短码（展示用，非安全标识）。
 * 与 src/app/u/[id]/page.tsx 的 shortStudentId 保持一致，供 iOS 主页头部对齐。
 */
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

/** showProfile JSON → stats 开关（脏数据/缺省一律回退为展示，与 /u/[id] 页解析一致）。 */
function parseShowStats(raw: string | null | undefined): boolean {
  if (!raw) return true;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return (parsed as Record<string, unknown>).stats !== false;
    }
  } catch {
    /* 脏数据回退为展示 */
  }
  return true;
}

/**
 * GET /api/u/:id —— 公开主页身份摘要（对齐 iOS PublicProfile DTO）。
 *
 * 公开可访问：getCurrentUser 可空（游客可读）；仅回传公开身份字段，
 * 绝不回传 email / phone / 私密设置（notificationPreferences 等）。
 * 已注销用户（deletedAt 非空）返回 404。
 *
 * 隐私：尊重目标用户的 showProfile.stats 开关——非本人查看且已关闭 stats 时，
 * 不回传 level / postsCount / coursesCount（与网页 /u/[id] 的 show.stats||isOwner 一致）；
 * 本人查看始终可见全部统计。身份字段（昵称/头像/简介/学号/加入时间）恒公开。
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const viewer = await getCurrentUser();

    // 越权铁律：按 path 参数 id 精确定位；deletedAt 非空视为不存在（404）。
    const target = await prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        nickname: true,
        avatarUrl: true,
        createdAt: true,
        profile: { select: { bio: true, showProfile: true } },
      },
    });
    if (!target) return fail("用户不存在", 404);

    const isOwner = viewer?.id === target.id;
    const showStats = parseShowStats(target.profile?.showProfile);
    const statsVisible = showStats || isOwner;

    // 公开身份字段（恒公开）
    const bio = target.profile?.bio?.trim() || null;
    const studentNo = shortStudentId(target.id);
    const joinedAt = target.createdAt.toISOString(); // ISO8601，对齐 iOS Date 解码

    // 统计字段（仅在 stats 可见时计算并回传）：
    //   postsCount   —— approved 帖子数（公开口径，与 /u/[id] 一致）
    //   coursesCount —— 有学习进度的去重课程数
    //   level        —— 由累计学习秒数派生的 "Lv.N 称号"
    let postsCount: number | undefined;
    let coursesCount: number | undefined;
    let level: string | undefined;
    if (statsVisible) {
      const [postCount, courseGroups, progressAgg] = await Promise.all([
        prisma.post.count({ where: { userId: target.id, status: "approved" } }),
        prisma.learningProgress.groupBy({ by: ["courseId"], where: { userId: target.id } }),
        prisma.learningProgress.aggregate({ where: { userId: target.id }, _sum: { progressSec: true } }),
      ]);
      const lv = deriveLevel(progressAgg._sum.progressSec ?? 0);
      postsCount = postCount;
      coursesCount = courseGroups.length;
      level = `Lv.${lv.level} ${lv.title}`;
    }

    // 仅公开字段进入信封；email/phone/私密设置一律不出现。
    return ok({
      id: target.id,
      nickname: target.nickname,
      avatarUrl: target.avatarUrl ?? undefined,
      studentNo,
      bio: bio ?? undefined,
      level,
      joinedAt,
      postsCount,
      coursesCount,
    });
  });
}
