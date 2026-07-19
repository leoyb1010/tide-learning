import { ImageResponse } from "next/og";
import { prisma } from "@/lib/db";
import { trackLabel } from "@/lib/tracks";
import { loadCjkSubset } from "@/lib/og-fonts";

/**
 * 集市商品页动态社交预览图（蓝图 D3 / 审查 P1-1）。
 * 完课分享卡的二维码恰好指向 /market/{slug}——此前该页只有全站兜底 OG，扫码/粘贴链接落到「白板」。
 * 工艺与 courses/[id]/opengraph-image.tsx 对齐：satori 只吃 flex + 写死 hex + CJK 按需取字形子集。
 */

export const runtime = "nodejs";
export const alt = "潮汐学习 · 集市课程";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BASE_TOP = "#0e1116";
const BASE_BOT = "#232935";
const INK = "#edeff3";
const INK_2 = "#8790a0";
const RED = "#fc011a";

const TRACK_GRAD: Record<string, [string, string]> = {
  ai_skill: ["#5b3fd6", "#7b5cf0"],
  english_oral: ["#1f7a5a", "#2ba578"],
  english_foundation: ["#1f7a5a", "#2ba578"],
  silver_english: ["#c4632a", "#e0843c"],
  life: ["#2a6ab0", "#3b8dd6"],
};
const TRACK_DEFAULT: [string, string] = ["#4a5262", "#2d3440"];


export default async function MarketOgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // 只暴露在架商品（sharedStatus=shared），与商品页可见性口径一致；未在架 → 品牌兜底卡。
  const course = await prisma.course.findFirst({
    where: { OR: [{ slug }, { id: slug }], sharedStatus: "shared" },
    select: {
      title: true,
      subtitle: true,
      category: true,
      priceCredits: true,
      learnersCount: true,
      authorUserId: true, // 软 FK 无 relation，作者昵称下方单查
    },
  });
  const authorUser = course?.authorUserId
    ? await prisma.user.findFirst({ where: { id: course.authorUserId, deletedAt: null }, select: { nickname: true } })
    : null;

  const title = course?.title ?? "潮汐学习 · 课程集市";
  const sub = course?.subtitle ?? "学员创作的精品课，逛一逛";
  const author = authorUser?.nickname ?? null;
  const price = course ? (course.priceCredits && course.priceCredits > 0 ? `${course.priceCredits} 积分` : "免费拿走") : null;
  const label = course ? trackLabel(course.category) : "集市";
  const grad = (course && TRACK_GRAD[course.category]) ?? TRACK_DEFAULT;

  const fontText = `${title}${sub}${label}${author ?? ""}${price ?? ""}潮汐学习集市商品 · 作者0123456789`;
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
        {/* 顶部：品牌 + 赛道 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ display: "flex", width: 14, height: 34, backgroundColor: RED, borderRadius: 4 }} />
            <div style={{ display: "flex", fontSize: 26, color: INK_2, letterSpacing: 4 }}>潮汐学习 · 集市</div>
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 24,
              color: INK,
              padding: "8px 22px",
              borderRadius: 999,
              backgroundImage: `linear-gradient(135deg, ${grad[0]}, ${grad[1]})`,
            }}
          >
            {label}
          </div>
        </div>

        {/* 主体：标题 + 副题 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 700, lineHeight: 1.2, maxWidth: 1000 }}>{title}</div>
          <div style={{ display: "flex", fontSize: 30, color: INK_2, maxWidth: 960 }}>{sub}</div>
        </div>

        {/* 底部：作者 + 价格 + 波形意象 */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 28, alignItems: "center" }}>
            {author ? <div style={{ display: "flex", fontSize: 26, color: INK_2 }}>作者 · {author}</div> : null}
            {price ? (
              <div
                style={{
                  display: "flex",
                  fontSize: 28,
                  color: price === "免费拿走" ? INK : RED,
                  border: `2px solid ${price === "免费拿走" ? "#3a4252" : RED}`,
                  padding: "6px 20px",
                  borderRadius: 12,
                }}
              >
                {price}
              </div>
            ) : null}
          </div>
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
