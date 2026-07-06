import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { grantCredits } from "@/lib/credits";
import { ok, fail, handle, assertSameOrigin, AppError } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// 返利额度（分享奖励，双方各得）。
// 不能 export：Next.js 15 App Router route 模块只允许 export HTTP handler 与固定 config，
// 非法 export 会导致 next build 失败（Type error: not a valid Route export field）。
const REFERRAL_REWARD = 50;
// 单个邀请人可获返利的邀请上限（防刷：注册小号无限刷返利）。
const MAX_REFERRALS_PER_INVITER = 50;

/**
 * POST /api/referral/bind — 新用户登录后绑定邀请码并双向返利（流3-U4b）。
 * body: { code }。当前登录用户即被邀请人（invitee）。
 *
 * 防刷矩阵：
 *  - inviteeId @unique：一个新用户一生只能被返利一次（重复 bind 被唯一约束拒）。
 *  - 不能绑定自己的码（inviterId !== invitee）。
 *  - 单邀请人返利次数上限 MAX_REFERRALS_PER_INVITER。
 * 记录与积分在同一事务内：Referral 行（唯一占位）→ 标记 rewardedAt。积分发放走 grantCredits
 * （自身事务）放在成功建行之后，保证「有记录才发币」；invitee 侧唯一约束确保不会重复发。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const invitee = await requireUser();
    assertRateLimit(req, "referral-bind", 10, 60_000);

    const { code } = (await req.json()) as { code?: string };
    const clean = (code ?? "").trim().toUpperCase();
    if (!clean) return fail("请填写邀请码");

    const invite = await prisma.inviteCode.findUnique({ where: { code: clean } });
    if (!invite) return fail("邀请码无效");
    if (invite.inviterId === invitee.id) return fail("不能绑定自己的邀请码");

    // 已被返利过（无论此前绑的哪个码）→ 直接拒，一个新用户只返利一次
    const already = await prisma.referral.findUnique({ where: { inviteeId: invitee.id } });
    if (already) return fail("你已绑定过邀请码");

    // 事务内建 Referral（inviteeId 唯一占位，rewardedAt 先留空）；上限校验也在事务内，防并发绕过。
    // rewardedAt 延后到两笔 grantCredits 都成功后再打——中途崩溃时状态如实反映「已绑定未发币」，
    // 不再出现「已标记已返利但未发币」的假账。
    const referral = await prisma.$transaction(async (tx) => {
      const count = await tx.referral.count({ where: { inviterId: invite.inviterId } });
      if (count >= MAX_REFERRALS_PER_INVITER) throw new AppError("该邀请码返利名额已满");
      try {
        return await tx.referral.create({
          data: {
            inviteCodeId: invite.id,
            inviterId: invite.inviterId,
            inviteeId: invitee.id,
          },
        });
      } catch {
        // inviteeId 唯一冲突（并发重复 bind）→ 已被别的请求占位，本次不发币
        throw new AppError("你已绑定过邀请码");
      }
    });

    // 记录已建立（inviteeId 唯一 → 不会重复到这里）→ 双方各发返利积分。
    // grantCredits 自带事务与流水；refId 关联 referral，便于对账。
    // 全部成功后才打 rewardedAt；失败仅记日志（rewardedAt 保持 null，如实反映未发币，可事后补发）。
    try {
      await grantCredits(invite.inviterId, REFERRAL_REWARD, "share_reward", {
        refId: referral.id,
        reason: "邀请好友注册",
      });
      await grantCredits(invitee.id, REFERRAL_REWARD, "share_reward", {
        refId: referral.id,
        reason: "受邀注册奖励",
      });
      await prisma.referral.update({ where: { id: referral.id }, data: { rewardedAt: new Date() } });
    } catch (e) {
      console.error("[referral] 返利发放失败（referral 已建立，rewardedAt 为 null 待补发）:", referral.id, e);
    }

    return ok({ bound: true, reward: REFERRAL_REWARD });
  });
}
