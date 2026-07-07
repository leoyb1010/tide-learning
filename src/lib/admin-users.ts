import { prisma } from "./db";

/**
 * 后台按 userId / email / nickname 定位唯一用户（未删）。
 * 供「发积分 / 赠会员」等管理口共用，统一「精确、唯一才命中」的定位语义：
 *   - userId / email 走 @unique 精确命中；
 *   - nickname 非唯一：命中多个时拒绝（要求改用邮箱/userId），避免误发到同名用户。
 * 返回 { id, nickname } 或 { error, status }（由调用方转 fail）。
 */
export async function resolveAdminTargetUser(
  q: { userId?: string; email?: string; nickname?: string },
): Promise<{ id: string; nickname: string } | { error: string; status: number }> {
  const userId = q.userId?.trim();
  const email = q.email?.trim();
  const nickname = q.nickname?.trim();

  if (userId) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, nickname: true, deletedAt: true } });
    if (!u || u.deletedAt) return { error: "目标用户不存在", status: 404 };
    return { id: u.id, nickname: u.nickname };
  }
  if (email) {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true, nickname: true, deletedAt: true } });
    if (!u || u.deletedAt) return { error: "目标用户不存在", status: 404 };
    return { id: u.id, nickname: u.nickname };
  }
  if (nickname) {
    const us = await prisma.user.findMany({ where: { nickname, deletedAt: null }, select: { id: true, nickname: true }, take: 2 });
    if (us.length === 0) return { error: "目标用户不存在", status: 404 };
    if (us.length > 1) return { error: "昵称匹配到多个用户，请用邮箱或 userId 精确定位", status: 400 };
    return { id: us[0].id, nickname: us[0].nickname };
  }
  return { error: "请提供 userId / email / nickname 之一", status: 400 };
}
