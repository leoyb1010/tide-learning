import { redirect } from "next/navigation";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { resolveEntitlement } from "@/lib/entitlement";
import { deriveLevel } from "@/lib/level";
import { ProfileForm } from "@/components/profile/ProfileForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "个人资料" };

const NICKNAME_COOLDOWN_DAYS = 30;

/** 证件编号：与 /me 学生证一致（YD·{入学年}·{userId 派生 4 位}）。 */
function studentNo(id: string, year: number): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) >>> 0;
  return `YD·${year}·${String(h % 10000).padStart(4, "0")}`;
}

/** 服务端预渲染个人主页二维码 SVG（只依赖稳定 userId，交给 client 预览静态展示）。 */
async function makeQr(userId: string): Promise<string> {
  try {
    let origin = process.env.NEXT_PUBLIC_APP_URL ?? "";
    if (!origin) {
      const h = await headers();
      const host = h.get("host");
      const proto = h.get("x-forwarded-proto") ?? "https";
      origin = host ? `${proto}://${host}` : "";
    }
    const url = origin ? `${origin}/u/${userId}` : `/u/${userId}`;
    return await QRCode.toString(url, {
      type: "svg",
      margin: 0,
      color: { dark: "#1a1d24", light: "#00000000" },
    });
  } catch {
    return "";
  }
}

/** showProfile JSON → 三开关布尔（脏数据/缺省一律回退为展示）。 */
function parseShowProfile(raw: string | null | undefined): {
  stats: boolean;
  badges: boolean;
  posts: boolean;
} {
  let obj: Record<string, unknown> = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") obj = parsed as Record<string, unknown>;
    } catch {
      obj = {};
    }
  }
  return {
    stats: obj.stats !== false,
    badges: obj.badges !== false,
    posts: obj.posts !== false,
  };
}

/**
 * 个人资料设置页（v3.0 设置精品化）。
 * 服务端加载 User + UserProfile + 权益/等级/连续天数，算好学生证静态展示数据与二维码，
 * 交给 ProfileForm（client）承接编辑 + 实时预览 + 分享 + 保存。
 */
export default async function ProfileSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/me/settings/profile");

  const [profile, progressAgg, streak, snapshot, qrSvg] = await Promise.all([
    prisma.userProfile.findUnique({ where: { userId: user.id } }),
    prisma.learningProgress.aggregate({ where: { userId: user.id }, _sum: { progressSec: true } }),
    prisma.streak.findUnique({ where: { userId: user.id }, select: { currentStreak: true } }),
    resolveEntitlement(user.id),
    makeQr(user.id),
  ]);

  const totalSeconds = progressAgg._sum.progressSec ?? 0;
  const level = deriveLevel(totalSeconds);
  const hoursLabel =
    level.hours >= 1000 ? level.hours.toLocaleString("en-US", { maximumFractionDigits: 0 }) : `${level.hours}`;

  const j = user.createdAt;
  const joinedLabel = `${j.getFullYear()}.${String(j.getMonth() + 1).padStart(2, "0")}`;
  const validLabel = snapshot.isSubscriber
    ? snapshot.validUntil
      ? `VALID ${snapshot.validUntil.slice(0, 7).replace("-", ".")}`
      : "VALID FOREVER"
    : "免费学员";

  // 改名冷却：nicknameChangedAt + 30 天 > now → 剩余天数，否则 null（可改）。
  let nicknameCooldownDays: number | null = null;
  if (profile?.nicknameChangedAt) {
    const nextAllowed = profile.nicknameChangedAt.getTime() + NICKNAME_COOLDOWN_DAYS * 864e5;
    if (Date.now() < nextAllowed) {
      nicknameCooldownDays = Math.ceil((nextAllowed - Date.now()) / 864e5);
    }
  }

  const show = parseShowProfile(profile?.showProfile);

  return (
    <div className="stagger">
      <ProfileForm
        userId={user.id}
        nicknameCooldownDays={nicknameCooldownDays}
        initial={{
          nickname: user.nickname,
          avatarUrl: user.avatarUrl,
          motto: profile?.motto ?? null,
          bio: profile?.bio ?? null,
          birthYear: profile?.birthYear ?? null,
          ageBand: profile?.ageBand ?? null,
          learningGoal: profile?.learningGoal ?? null,
          showStats: show.stats,
          showBadges: show.badges,
          showPosts: show.posts,
        }}
        card={{
          studentNo: studentNo(user.id, j.getFullYear()),
          joinedLabel,
          validLabel,
          levelLabel: `Lv.${level.level} ${level.title}`,
          hoursLabel,
          streak: streak?.currentStreak ?? 0,
          isSubscriber: snapshot.isSubscriber,
          qrSvg,
        }}
      />
    </div>
  );
}
