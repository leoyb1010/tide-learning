import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, verifyPassword, destroySession } from "@/lib/session";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { unlink } from "node:fs/promises";
import { attachmentDiskPath } from "@/lib/private-upload";

export const dynamic = "force-dynamic";

/**
 * POST /api/account/delete — 注销账号（App Store 5.1.1(v) 要求可在 App 内删号）。
 * 入参：密码账号 { password, confirmation }；第三方账号 { confirmation }。
 * 校验：同源(CSRF) + 登录态 + 限流 + 明确确认；密码账号还须当前密码正确。
 * 处理：立即删除学习、社交、设备、AI 对话与附件数据；埋点和线索解除身份关联；
 * 订单、订阅、优惠核销与积分流水因退款、对账和反欺诈需要保留，但账号主体会被不可逆匿名化并吊销权益。
 * 第三方账号没有本地密码，以当前已认证会话 + 同源保护 + 显式确认完成自助注销。
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    assertRateLimit(req, `account-delete:${user.id}`, 5, 60_000);

    const body = (await req.json().catch(() => null)) as { password?: string; confirmation?: string } | null;
    const password = (body?.password ?? "").trim();
    if (body?.confirmation !== "DELETE_ACCOUNT") return fail("请输入“注销账号”以确认");

    if (user.authProvider === "password" && user.passwordHash) {
      if (!password) return fail("请输入密码以确认注销");
      if (!verifyPassword(password, user.passwordHash)) return fail("密码不正确");
    }

    const attachments = await prisma.noteAttachment.findMany({
      where: { note: { userId: user.id } },
      select: { path: true },
    });

    // 越权铁律：每张表都以当前 user.id 收敛；财务记录只保留到匿名账户壳。
    await prisma.$transaction(async (tx) => {
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.passwordReset.deleteMany({ where: { userId: user.id } });
      await tx.device.deleteMany({ where: { userId: user.id } });
      await tx.notification.deleteMany({ where: { userId: user.id } });

      await tx.note.deleteMany({ where: { userId: user.id } });
      await tx.noteTag.deleteMany({ where: { userId: user.id } });
      await tx.learningProgress.deleteMany({ where: { userId: user.id } });
      await tx.courseReview.deleteMany({ where: { userId: user.id } });
      await tx.coursePurchase.deleteMany({ where: { userId: user.id } });
      await tx.reviewCard.deleteMany({ where: { userId: user.id } });
      await tx.notebook.deleteMany({ where: { userId: user.id } });
      await tx.examMistake.deleteMany({ where: { userId: user.id } });
      await tx.examAttempt.deleteMany({ where: { userId: user.id } });
      await tx.exam.deleteMany({ where: { userId: user.id } });
      await tx.focusSession.deleteMany({ where: { userId: user.id } });
      await tx.streakDay.deleteMany({ where: { userId: user.id } });
      await tx.streak.deleteMany({ where: { userId: user.id } });
      await tx.userAchievement.deleteMany({ where: { userId: user.id } });

      await tx.chatThread.deleteMany({ where: { userId: user.id } });
      await tx.importedSource.deleteMany({ where: { userId: user.id } });
      await tx.generationJob.deleteMany({ where: { userId: user.id } });
      await tx.llmUsage.deleteMany({ where: { userId: user.id } });

      await tx.postComment.deleteMany({ where: { userId: user.id } });
      await tx.postLike.deleteMany({ where: { userId: user.id } });
      await tx.post.deleteMany({ where: { userId: user.id } });
      await tx.comment.deleteMany({ where: { userId: user.id } });
      await tx.demandVote.deleteMany({ where: { userId: user.id } });
      await tx.demandFollow.deleteMany({ where: { userId: user.id } });
      await tx.demand.deleteMany({ where: { userId: user.id } });
      await tx.courseAccessRequest.deleteMany({ where: { OR: [{ requesterId: user.id }, { ownerId: user.id }] } });
      await tx.referral.deleteMany({ where: { OR: [{ inviterId: user.id }, { inviteeId: user.id }] } });
      await tx.inviteCode.deleteMany({ where: { inviterId: user.id } });
      await tx.course.deleteMany({ where: { authorUserId: user.id } });

      await tx.analyticsEvent.updateMany({ where: { userId: user.id }, data: { userId: null, anonymousId: null } });
      await tx.lead.updateMany({ where: { userId: user.id }, data: { userId: null, name: null, phone: null, followUpNote: null } });
      await tx.redemptionCode.updateMany({ where: { createdById: user.id }, data: { createdById: null } });

      const now = new Date();
      await tx.subscription.updateMany({
        where: { userId: user.id, status: { notIn: ["refunded", "revoked", "expired"] } },
        data: { status: "revoked", cancelAtPeriodEnd: true, currentPeriodEnd: now },
      });
      await tx.entitlement.updateMany({ where: { userId: user.id }, data: { status: "revoked", validUntil: now } });
      await tx.creditAccount.updateMany({
        where: { userId: user.id },
        data: { balance: 0, monthlyGrantKey: null },
      });
      await tx.userProfile.deleteMany({ where: { userId: user.id } });

      await tx.user.update({
        where: { id: user.id },
        data: {
          email: null,
          phone: null,
          username: null,
          nickname: "已注销用户",
          avatarUrl: null,
          passwordHash: null,
          authProvider: "deleted",
          deletedAt: now,
        },
      });
    });

    await Promise.all(attachments.map(({ path }) => {
      const diskPath = attachmentDiskPath(path);
      return diskPath ? unlink(diskPath).catch(() => {}) : Promise.resolve();
    }));

    // 清理当前浏览器的 cookie 会话（Bearer 端无 cookie，无副作用）
    await destroySession();

    await audit({ action: "account.erased", targetType: "pseudonymous_user", targetId: user.id, detail: "self-service deletion completed" });

    return ok({ deleted: true, personalDataErased: true, financialRecordsAnonymized: true });
  });
}
