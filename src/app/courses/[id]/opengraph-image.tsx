import { ImageResponse } from "next/og";
import { prisma } from "@/lib/db";
import { CATEGORY_LABELS } from "@/lib/queries";
import { loadCjkSubset } from "@/lib/og-fonts";

/**
 * 课程动态社交预览图（Next.js 约定文件）。
 * 微信 / X / Telegram 粘贴课程链接即出卡。此文件由 Next 自动注入到
 * courses/[id] 的 metadata.openGraph.images 与 twitter.images，无需在 page 里手配。
 *
 * satori 限制（ImageResponse 内部）：
 *  - 布局只能 flex，不能 grid；
 *  - 颜色只能具体色值，不能用 CSS 变量（本文件里全部写死 hex）；
 *  - 中文需显式提供 CJK 字体，否则渲染成 tofu 方块——这里按卡面实际字符
 *    向 Google Fonts 取 Noto Sans SC 子集（仅所需字形，~10KB），可靠且轻量。
 *
 * STUDIO 设计语言：冷灰蓝中性基座 + 有道红 #fc011a 克制点睛(~7%) + mono 数字 +
 * 潮汐水纹意象；品牌感对齐 Linear 的产品分享卡。
 */

export const runtime = "nodejs"; // 需要查 Prisma
export const alt = "有道自习室 STUDIO · 课程预览";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// 冷灰蓝基座与墨色（写死 hex，satori 不认 CSS 变量）
const BASE_TOP = "#0e1116";
const BASE_BOT = "#232935";
const INK = "#edeff3"; // 主墨字
const INK_2 = "#8790a0"; // 次要
const RED = "#fc011a"; // 有道红，唯一强调，克制点睛
const OK = "#37c491";

// 赛道渐变映射（与 src/lib/tracks.ts trackGradientVar / globals.css --track-* 对齐，取具体 hex）
const TRACK_GRAD: Record<string, [string, string]> = {
  ai_skill: ["#5b3fd6", "#7b5cf0"], // AI 技能 紫
  english_oral: ["#1f7a5a", "#2ba578"], // 英语 绿
  english_foundation: ["#1f7a5a", "#2ba578"],
  silver_english: ["#c4632a", "#e0843c"], // 银发 暖橙
  life: ["#2a6ab0", "#3b8dd6"], // 生活 蓝
};
const TRACK_DEFAULT: [string, string] = ["#4a5262", "#2d3440"]; // 兜底 冷灰

function trackGrad(category: string): [string, string] {
  return TRACK_GRAD[category] ?? TRACK_DEFAULT;
}

/** 大数字紧凑格式（中国大陆口径「万」，与 page.tsx compactCount 一致）：12400 → 1.2万。 */
function compactCount(n: number): string {
  if (n < 10000) return String(n);
  const w = n / 10000;
  return `${w >= 10 ? Math.round(w) : w.toFixed(1)}万`;
}

/**
 * 取 Noto Sans SC 字形子集（按卡面实际文本），satori 渲染中文所需。
 * Google CSS2 的 text= 只返回用到的字形，体积极小；失败则返回 null，
 * satori 用内置拉丁字体兜底渲染数字/英文（中文会缺，但不至于整图报错）。
 */

export default async function CourseOgImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const course = await prisma.course.findFirst({
    where: { OR: [{ id }, { slug: id }] },
    select: {
      title: true,
      subtitle: true,
      description: true,
      category: true,
      learnersCount: true,
    },
  });

  // 课程不存在时给一张品牌兜底卡，避免爬虫拿到空图
  const title = course?.title ?? "有道自习室";
  const subtitle = course?.subtitle ?? course?.description ?? "订阅制学习平台，持续更新";
  const category = course?.category ?? "";
  const categoryLabel = CATEGORY_LABELS[category] ?? "有道自习室";
  const learners = course?.learnersCount ?? 0;
  const [g0, g1] = trackGrad(category);

  // 标题过长时收敛，避免撑破卡面（OG 卡以可读为先）
  const displayTitle = title.length > 34 ? `${title.slice(0, 33)}…` : title;
  const displaySub = subtitle.length > 52 ? `${subtitle.slice(0, 51)}…` : subtitle;
  const learnersText = compactCount(learners);

  // 收集卡面全部中文/字符，向 Google 取最小字形子集
  const glyphText =
    displayTitle +
    displaySub +
    categoryLabel +
    "有道自习室STUDIO人在学持续更新中综合评分潮汐学习订阅制平台0123456789.k·";
  const [fontBold, fontBlack] = await Promise.all([
    loadCjkSubset(glyphText, 700),
    loadCjkSubset(displayTitle + "STUDIO潮汐", 900),
  ]);

  const fonts = [
    ...(fontBold ? [{ name: "NotoSC", data: fontBold, weight: 700 as const, style: "normal" as const }] : []),
    ...(fontBlack ? [{ name: "NotoSCBlack", data: fontBlack, weight: 900 as const, style: "normal" as const }] : []),
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          fontFamily: "NotoSC, sans-serif",
          // 冷灰蓝中性基座（对角渐变，避免死黑平面）
          backgroundColor: BASE_TOP,
          backgroundImage: `linear-gradient(135deg, ${BASE_TOP} 0%, ${BASE_BOT} 100%)`,
        }}
      >
        {/* 顶部内高光：让基座有材质，不是纯平面 */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "360px",
            display: "flex",
            backgroundImage:
              "radial-gradient(120% 100% at 20% 0%, rgba(255,255,255,0.10), rgba(255,255,255,0) 60%)",
          }}
        />

        {/* 左侧赛道渐变竖条：把课程赛道个性带进冷基座（红之外的唯一大面积色相） */}
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: "12px",
            display: "flex",
            backgroundImage: `linear-gradient(180deg, ${g0}, ${g1})`,
          }}
        />

        {/* 潮汐水纹意象：底部两道波形，赛道色 + 极低透明，克制不喧宾 */}
        <svg
          width="1200"
          height="260"
          viewBox="0 0 1200 260"
          style={{ position: "absolute", left: 0, bottom: 0, display: "flex" }}
        >
          <path
            d="M0 150 C 200 100, 360 200, 600 150 S 1000 100, 1200 160 L 1200 260 L 0 260 Z"
            fill={g0}
            fillOpacity="0.16"
          />
          <path
            d="M0 200 C 240 160, 420 250, 640 200 S 1020 160, 1200 210 L 1200 260 L 0 260 Z"
            fill={g1}
            fillOpacity="0.12"
          />
        </svg>

        {/* ===== 顶栏：品牌角标（左） ===== */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "56px 64px 0 76px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            {/* 红点睛：品牌方块 */}
            <div
              style={{
                width: "40px",
                height: "40px",
                display: "flex",
                borderRadius: "11px",
                backgroundColor: RED,
                boxShadow: "0 6px 22px -6px rgba(252,1,26,0.55)",
              }}
            />
            <div style={{ display: "flex", flexDirection: "column", marginLeft: "16px" }}>
              <span style={{ display: "flex", fontSize: "22px", fontWeight: 700, color: INK, letterSpacing: "0.5px" }}>
                有道自习室
              </span>
              <span
                style={{
                  display: "flex",
                  fontSize: "13px",
                  fontWeight: 700,
                  color: INK_2,
                  letterSpacing: "4px",
                  marginTop: "2px",
                }}
              >
                STUDIO
              </span>
            </div>
          </div>

          {/* 赛道标签 pill */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              height: "40px",
              padding: "0 20px",
              borderRadius: "999px",
              backgroundColor: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            <div
              style={{
                width: "9px",
                height: "9px",
                display: "flex",
                borderRadius: "999px",
                backgroundImage: `linear-gradient(135deg, ${g0}, ${g1})`,
                marginRight: "10px",
              }}
            />
            <span style={{ display: "flex", fontSize: "16px", fontWeight: 700, color: INK }}>{categoryLabel}</span>
          </div>
        </div>

        {/* ===== 主体：课名大字 + 副标题 ===== */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: "center",
            padding: "0 76px",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: displayTitle.length > 18 ? "66px" : "80px",
              fontWeight: 900,
              fontFamily: "NotoSCBlack, NotoSC, sans-serif",
              lineHeight: 1.16,
              color: INK,
              letterSpacing: "-0.5px",
              maxWidth: "1000px",
            }}
          >
            {displayTitle}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: "28px",
              fontWeight: 700,
              color: INK_2,
              lineHeight: 1.5,
              marginTop: "24px",
              maxWidth: "940px",
            }}
          >
            {displaySub}
          </div>
        </div>

        {/* ===== 底栏：N 人在学（mono 数字）+ 持续更新点 ===== */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 76px 56px",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <span
              style={{
                display: "flex",
                fontSize: "44px",
                fontWeight: 900,
                fontFamily: "monospace",
                color: INK,
                letterSpacing: "-1px",
              }}
            >
              {learnersText}
            </span>
            <span style={{ display: "flex", fontSize: "24px", fontWeight: 700, color: INK_2, marginLeft: "12px" }}>
              人在学
            </span>
          </div>

          {/* 持续更新点睛：成功绿呼吸点（静态）+ 说明 */}
          <div style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                width: "10px",
                height: "10px",
                display: "flex",
                borderRadius: "999px",
                backgroundColor: OK,
                marginRight: "12px",
                boxShadow: `0 0 0 4px rgba(55,196,145,0.18)`,
              }}
            />
            <span style={{ display: "flex", fontSize: "20px", fontWeight: 700, color: INK_2 }}>持续更新中</span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts,
    },
  );
}
