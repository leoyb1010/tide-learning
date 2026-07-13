import { prisma } from "./db";

/**
 * 埋点 SDK 包装层 — 计划书 v0.3 §10。
 * 服务端落库；客户端通过 POST /api/analytics 上报。
 */
export const CORE_EVENTS = [
  "homepage_view",
  "hero_cta_click",
  "course_card_click",
  "lesson_trial_start",
  "paywall_view",
  "checkout_start",
  "subscription_success",
  "lesson_continue_after_pay",
  "lesson_progress",
  "lesson_complete",
  "note_create",
  "note_anchor_click",
  "demand_submit",
  "demand_vote",
  "demand_status_view",
  "demand_comment_add",
  "demand_follow",
  "trial_booking",
  "subscription_cancel_start",
  "subscription_cancel_confirm",
  "subscription_change",
  "signup_start",
  "signup_success",
  "login_start",
  "login_success",
  "logout",
  // D4：补全的交互 / 捕捉 / 增长事件
  "note_capture",
  "note_clip",
  "note_delete",
  "note_search",
  "note_export",
  "note_share",
  "live_class_book",
  "paywall_dismiss",
  "lesson_speed_change",
  "focus_mode_toggle",
  "theme_toggle",
] as const;

export type CoreEvent = (typeof CORE_EVENTS)[number];

export async function track(params: {
  eventName: string;
  userId?: string | null;
  anonymousId?: string | null;
  properties?: Record<string, unknown>;
  platform?: string;
}) {
  try {
    await prisma.analyticsEvent.create({
      data: {
        eventName: params.eventName,
        userId: params.userId ?? null,
        anonymousId: params.anonymousId ?? null,
        propertiesJson: JSON.stringify(params.properties ?? {}),
        platform: params.platform ?? "web",
      },
    });
  } catch {
    // 埋点失败不得影响主流程
  }
}
