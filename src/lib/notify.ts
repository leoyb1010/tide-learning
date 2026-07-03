import { prisma } from "./db";

/**
 * 站内通知（v2.3 §9 / G3）—— 创建通知的统一入口。
 * 各业务（申请学习/批准/评论/点赞/课程更新/积分赠送）调 notify() 落库；
 * Topbar 铃铛读未读数，通知列表页读列表。失败静默（通知不该阻断主流程）。
 */

export type NotifyType =
  | "access_request" // 有人申请学习你的课
  | "access_approved" // 你的申请被批准
  | "access_rejected"
  | "post_comment" // 你的帖子被评论
  | "post_like" // 你的帖子被赞
  | "course_update" // 你学的课更新了
  | "credit_grant" // 积分到账
  | "system";

export async function notify(params: {
  userId: string; // 接收者
  type: NotifyType;
  title: string;
  body?: string;
  refType?: string; // course / post / request / exam
  refId?: string;
}): Promise<void> {
  try {
    // 纵深防御：统一截断 title/body，即使调用方拼进了用户可控内容也不会失控。
    await prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title.slice(0, 60),
        body: params.body ? params.body.slice(0, 120) : null,
        refType: params.refType ?? null,
        refId: params.refId ?? null,
      },
    });
  } catch (e) {
    console.error("[notify] failed:", e);
  }
}

/** 未读数（Topbar 铃铛）。 */
export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}
