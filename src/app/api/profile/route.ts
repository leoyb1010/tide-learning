import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { ok, fail, handle, assertSameOrigin } from "@/lib/api";
import { assertRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/profile —— 个人资料更新（v3.0 设置精品化）。
 *
 * requireUser + 同源校验 + 限流；只更新「自己」的 User / UserProfile。
 * 字段长度校验、昵称 30 天冷却（nicknameChangedAt）、展示开关 JSON 白名单归一化。
 * 越权铁律：一切写入锁定 where userId=当前用户，前端传入的 id 不参与定位。
 */

// ── 字段约束 ────────────────────────────────────────────────
const NICKNAME_MIN = 2;
const NICKNAME_MAX = 16;
const MOTTO_MAX = 40; // 学生证卡脚格言，两行内
const BIO_MAX = 200; // 学习心得，个人主页展示
const NICKNAME_COOLDOWN_DAYS = 30;

// 预设头像白名单（public/avatars/*）；空串表示清空为默认字母头像。
const PRESET_AVATARS = new Set([
  "/avatars/avatar-1.png",
  "/avatars/avatar-2.png",
  "/avatars/avatar-3.png",
]);

// 出生年段 / 学习目标：与 schema 注释一致的枚举白名单。
const AGE_BANDS = new Set(["18-24", "22-40", "35-45", "45-65"]);
const LEARNING_GOALS = new Set(["skill", "exam", "interest", "career", "language"]);

/** showProfile 三开关键名（其余键一律丢弃，避免脏 JSON 膨胀）。 */
const SHOW_KEYS = ["stats", "badges", "posts"] as const;
type ShowKey = (typeof SHOW_KEYS)[number];

interface PatchBody {
  nickname?: unknown;
  avatarUrl?: unknown;
  motto?: unknown;
  bio?: unknown;
  birthYear?: unknown;
  ageBand?: unknown;
  learningGoal?: unknown;
  showProfile?: unknown;
}

/** 把任意入参归一化为 {stats,badges,posts} 布尔三元组。 */
function normalizeShowProfile(raw: unknown): Record<ShowKey, boolean> | null {
  if (raw === undefined) return null;
  let obj: Record<string, unknown> = {};
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      obj = {};
    }
  } else if (raw && typeof raw === "object") {
    obj = raw as Record<string, unknown>;
  }
  return {
    stats: obj.stats !== false, // 缺省展示
    badges: obj.badges !== false,
    posts: obj.posts !== false,
  };
}

export async function PATCH(req: NextRequest) {
  return handle(async () => {
    assertSameOrigin(req); // A2：写操作 CSRF 防护
    const user = await requireUser();
    assertRateLimit(req, "profile_update", 20, 60_000);

    const body = (await req.json().catch(() => ({}))) as PatchBody;

    // 组装两张表的增量（只带入合法字段），并记录昵称是否变更以判定冷却。
    const userData: { nickname?: string; avatarUrl?: string | null } = {};
    const profileData: {
      motto?: string | null;
      bio?: string | null;
      birthYear?: number | null;
      ageBand?: string | null;
      learningGoal?: string | null;
      showProfile?: string;
      nicknameChangedAt?: Date;
    } = {};

    // ── 昵称（含 30 天冷却）─────────────────────────────
    if (body.nickname !== undefined) {
      if (typeof body.nickname !== "string") return fail("昵称格式不正确");
      const nickname = body.nickname.trim();
      if (nickname.length < NICKNAME_MIN) return fail(`昵称至少 ${NICKNAME_MIN} 个字`);
      if (nickname.length > NICKNAME_MAX) return fail(`昵称最多 ${NICKNAME_MAX} 个字`);

      // 仅当真的改动才校验冷却（保持原昵称重复提交不触发冷却）。
      if (nickname !== user.nickname) {
        const existing = await prisma.userProfile.findUnique({
          where: { userId: user.id },
          select: { nicknameChangedAt: true },
        });
        const last = existing?.nicknameChangedAt;
        if (last) {
          const nextAllowed = last.getTime() + NICKNAME_COOLDOWN_DAYS * 864e5;
          if (Date.now() < nextAllowed) {
            const daysLeft = Math.ceil((nextAllowed - Date.now()) / 864e5);
            return fail(`改名冷却中，还需 ${daysLeft} 天`, 429);
          }
        }
        userData.nickname = nickname;
        profileData.nicknameChangedAt = new Date();
      }
    }

    // ── 头像（预设白名单 / 清空）─────────────────────────
    if (body.avatarUrl !== undefined) {
      if (body.avatarUrl === null || body.avatarUrl === "") {
        userData.avatarUrl = null;
      } else if (typeof body.avatarUrl === "string" && PRESET_AVATARS.has(body.avatarUrl)) {
        userData.avatarUrl = body.avatarUrl;
      } else if (typeof body.avatarUrl === "string" && body.avatarUrl === user.avatarUrl) {
        // 保留现有自定义头像（如已有上传地址），原值回传不报错。
        userData.avatarUrl = body.avatarUrl;
      } else {
        return fail("请选择内置头像");
      }
    }

    // ── 座右铭 motto（学生证联动）───────────────────────
    if (body.motto !== undefined) {
      if (body.motto === null || body.motto === "") {
        profileData.motto = null;
      } else if (typeof body.motto === "string") {
        const motto = body.motto.trim();
        if (motto.length > MOTTO_MAX) return fail(`座右铭最多 ${MOTTO_MAX} 个字`);
        profileData.motto = motto || null;
      } else {
        return fail("座右铭格式不正确");
      }
    }

    // ── 学习心得 bio（个人主页展示）─────────────────────
    if (body.bio !== undefined) {
      if (body.bio === null || body.bio === "") {
        profileData.bio = null;
      } else if (typeof body.bio === "string") {
        const bio = body.bio.trim();
        if (bio.length > BIO_MAX) return fail(`学习心得最多 ${BIO_MAX} 个字`);
        profileData.bio = bio || null;
      } else {
        return fail("学习心得格式不正确");
      }
    }

    // ── 出生年段 birthYear（合理年份区间）───────────────
    if (body.birthYear !== undefined) {
      if (body.birthYear === null || body.birthYear === "") {
        profileData.birthYear = null;
      } else {
        const y = Number(body.birthYear);
        const nowYear = new Date().getFullYear();
        if (!Number.isInteger(y) || y < 1920 || y > nowYear) return fail("出生年份不合理");
        profileData.birthYear = y;
      }
    }

    // ── 年龄段 ageBand（枚举白名单）─────────────────────
    if (body.ageBand !== undefined) {
      if (body.ageBand === null || body.ageBand === "") {
        profileData.ageBand = null;
      } else if (typeof body.ageBand === "string" && AGE_BANDS.has(body.ageBand)) {
        profileData.ageBand = body.ageBand;
      } else {
        return fail("年龄段取值不合法");
      }
    }

    // ── 学习目标 learningGoal（枚举白名单）──────────────
    if (body.learningGoal !== undefined) {
      if (body.learningGoal === null || body.learningGoal === "") {
        profileData.learningGoal = null;
      } else if (typeof body.learningGoal === "string" && LEARNING_GOALS.has(body.learningGoal)) {
        profileData.learningGoal = body.learningGoal;
      } else {
        return fail("学习目标取值不合法");
      }
    }

    // ── 展示开关 showProfile ───────────────────────────
    const show = normalizeShowProfile(body.showProfile);
    if (show) profileData.showProfile = JSON.stringify(show);

    if (Object.keys(userData).length === 0 && Object.keys(profileData).length === 0) {
      return fail("没有可更新的字段");
    }

    // 事务：User + UserProfile 一起写；profile 不存在则 upsert 创建。
    await prisma.$transaction(async (tx) => {
      if (Object.keys(userData).length > 0) {
        await tx.user.update({ where: { id: user.id }, data: userData });
      }
      if (Object.keys(profileData).length > 0) {
        await tx.userProfile.upsert({
          where: { userId: user.id },
          create: { userId: user.id, ...profileData },
          update: profileData,
        });
      }
    });

    // 回传最新证件联动字段，供前端即时对齐（昵称/头像/格言）。
    return ok({
      nickname: userData.nickname ?? user.nickname,
      avatarUrl: userData.avatarUrl !== undefined ? userData.avatarUrl : user.avatarUrl,
      motto: profileData.motto,
      nicknameChanged: Boolean(userData.nickname),
    });
  });
}
