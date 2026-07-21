/** 用户本人可创作和管理的课程来源。手工建课不计入 AI 造课额度。 */
export const USER_AUTHORED_ORIGINS = ["ai_generated", "user_imported", "user_created"] as const;

export type UserAuthoredOrigin = (typeof USER_AUTHORED_ORIGINS)[number];

export function isUserAuthoredOrigin(origin: string): origin is UserAuthoredOrigin {
  return (USER_AUTHORED_ORIGINS as readonly string[]).includes(origin);
}

export function authoredOriginLabel(origin: string): string {
  if (origin === "ai_generated") return "AI 生成";
  if (origin === "user_imported") return "我的导入";
  if (origin === "user_created") return "手工创建";
  return "我的课程";
}
