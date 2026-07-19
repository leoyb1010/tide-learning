import { ImageResponse } from "next/og";
import { prisma } from "@/lib/db";
import { loadCjkSubset } from "@/lib/og-fonts";

/**
 * 个人主页动态社交预览图（蓝图 D3 / 审查 P1-1）。
 * 学生证/周报/streak 分享卡的二维码指向 /u/{id}——此前扫码落地页只有全站兜底 OG。
 * 只渲染公开信息（昵称/入学年份/发帖数），不渲染任何私有学习数据。
 */

export const runtime = "nodejs";
export const alt = "潮汐学习 · 个人主页";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BASE_TOP = "#0e1116";
const BASE_BOT = "#232935";
const INK = "#edeff3";
const INK_2 = "#8790a0";
const RED = "#fc011a";


export default async function UserOgImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const target = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: {
      nickname: true,
      createdAt: true,
      profile: { select: { showProfile: true } },
      _count: { select: { posts: { where: { status: "approved" } } } },
    },
  });

  const nickname = target?.nickname ?? "潮汐学员";
  const joinYear = target ? target.createdAt.getFullYear() : null;
  // 审计修复：主页的「学习数据」受 showProfile.stats 开关控,OG 此前无视开关恒显发帖数——
  // 与页面同口径(缺省/脏数据回退为展示,对齐 /u/[id]/page.tsx parseShowProfile)。
  let showStats = true;
  try {
    const parsed = JSON.parse(target?.profile?.showProfile || "{}") as { stats?: unknown };
    showStats = parsed.stats !== false;
  } catch {
    showStats = true;
  }
  const posts = showStats ? (target?._count.posts ?? 0) : null;
  const initial = nickname.trim().charAt(0) || "潮";

  const fontText = `${nickname}潮汐学习个人主页年入学发帖篇一起自学分享课程0123456789 · `;
  const font = await loadCjkSubset(fontText, 700);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          backgroundImage: `linear-gradient(160deg, ${BASE_TOP}, ${BASE_BOT})`,
          color: INK,
          fontFamily: "Noto Sans SC",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", width: 14, height: 34, backgroundColor: RED, borderRadius: 4 }} />
          <div style={{ display: "flex", fontSize: 26, color: INK_2, letterSpacing: 4 }}>潮汐学习 · 个人主页</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
          {/* 首字头像盘（不取外链头像，satori 稳定 + 隐私稳妥） */}
          <div
            style={{
              display: "flex",
              width: 168,
              height: 168,
              borderRadius: 999,
              alignItems: "center",
              justifyContent: "center",
              fontSize: 84,
              fontWeight: 700,
              color: INK,
              backgroundImage: "linear-gradient(135deg, #3a4252, #262d3a)",
              border: "3px solid #3a4252",
            }}
          >
            {initial}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", fontSize: 68, fontWeight: 700 }}>{nickname}</div>
            <div style={{ display: "flex", fontSize: 28, color: INK_2, gap: 24 }}>
              {joinYear ? <span>{joinYear} 年入学</span> : null}
              {posts !== null ? <span>发帖 {posts} 篇</span> : null}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 26, color: INK_2 }}>一起自学 · 分享 · 造课</div>
          <svg width="360" height="72" viewBox="0 0 360 72">
            <path
              d="M0 48 Q 30 20 60 44 T 120 40 T 180 48 T 240 36 T 300 46 T 360 40"
              stroke={RED}
              strokeWidth="4"
              fill="none"
              opacity="0.85"
            />
            <path
              d="M0 60 Q 30 40 60 58 T 120 54 T 180 62 T 240 52 T 300 60 T 360 56"
              stroke="#4a5262"
              strokeWidth="3"
              fill="none"
              opacity="0.7"
            />
          </svg>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: font ? [{ name: "Noto Sans SC", data: font, weight: 700 as const, style: "normal" as const }] : undefined,
    },
  );
}
