import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Noto_Sans_SC, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { ModeProvider } from "@/components/ModeProvider";
import { ToastProvider } from "@/components/Toast";
import { TopNav } from "@/components/TopNav";
import { MobileTabs } from "@/components/MobileTabs";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { prisma } from "@/lib/db";
import { getBalance, ensureMonthlyGrant } from "@/lib/credits";
import { shanghaiDayKey } from "@/lib/week";

// STUDIO 字体系统：Plus Jakarta（UI/数字）+ Noto Sans SC（中文）+ IBM Plex Mono（数据）
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-jakarta", display: "swap" });
const notoSC = Noto_Sans_SC({ subsets: ["latin"], weight: ["400", "500", "700", "900"], variable: "--font-noto-sc", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: {
    default: "有道自习室 · STUDIO",
    template: "%s · 有道自习室",
  },
  description:
    "有道自习室 STUDIO — 订阅制学习平台：口语实战、AI 技能、银发英语、生活实用。视频与笔记在同一张桌面，边看边记，随手截帧成卡。",
  keywords: ["有道自习室", "STUDIO", "订阅学习", "口语", "AI技能", "银发英语", "在线课程", "持续更新"],
  openGraph: {
    title: "有道自习室 · STUDIO",
    description: "视频与笔记在同一张桌面——边看边记，随手截帧成卡。持续更新的订阅制学习流。",
    type: "website",
    siteName: "有道自习室",
    locale: "zh_CN",
  },
  twitter: { card: "summary_large_image", title: "有道自习室 · STUDIO", description: "视频与笔记在同一张桌面，边看边记。" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e7eaf0" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1116" },
  ],
  width: "device-width",
  initialScale: 1,
};

/** 学号：userId 派生一个稳定的 5 位 base32 短码，如 STU-8F3K2（展示用，非安全标识）。 */
function shortStudentId(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 33 + userId.charCodeAt(i)) >>> 0;
  const base32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // 去掉易混 I/L/O/U
  let code = "";
  for (let i = 0; i < 5; i++) {
    code = base32[h % 32] + code;
    h = Math.floor(h / 32);
  }
  return `STU-${code}`;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  // TopNav 顶栏所需的用户数据（学号/积分/续学）。entitlement 被 React cache 去重，不会重复查库。
  let navUser: {
    nickname: string;
    role: string;
    studentId: string; // 学号（userId 短哈希）
    credits: number; // v2.3 积分余额
    // v2.3 §5 全局续学：最近在学的一节，供 TopNav 续学胶囊直达。无进度则为 null。
    resumeInfo: { courseSlug: string; courseTitle: string; lessonId: string; lessonTitle: string; pct: number } | null;
  } | null = null;
  if (user) {
    const [snapshot, lastProgress] = await Promise.all([
      resolveEntitlement(user.id),
      // 最近一次播放的进度，带课程/章节；React cache 去重，无额外成本
      prisma.learningProgress.findFirst({
        where: { userId: user.id },
        orderBy: { lastPlayedAt: "desc" },
        select: {
          lessonId: true,
          progressSec: true,
          course: { select: { slug: true, title: true } },
          lesson: { select: { id: true, title: true, durationSec: true } },
        },
      }),
    ]);
    // v2.3：订阅用户月度积分惰性赠送（本月未发则发，事务内防并发）。不阻塞渲染。
    const monthKey = shanghaiDayKey().slice(0, 7); // "2026-07"
    await ensureMonthlyGrant(user.id, monthKey, snapshot.isSubscriber).catch(() => {});
    const credits = await getBalance(user.id);
    // 进度% = progressSec / durationSec，钳到 0~100；时长缺失时按 0 处理
    const resumeInfo =
      lastProgress && lastProgress.course && lastProgress.lesson
        ? {
            courseSlug: lastProgress.course.slug,
            courseTitle: lastProgress.course.title,
            lessonId: lastProgress.lesson.id,
            lessonTitle: lastProgress.lesson.title,
            pct:
              lastProgress.lesson.durationSec > 0
                ? Math.min(100, Math.max(0, Math.round((lastProgress.progressSec / lastProgress.lesson.durationSec) * 100)))
                : 0,
          }
        : null;
    navUser = {
      nickname: user.nickname,
      role: user.role,
      studentId: shortStudentId(user.id),
      credits,
      resumeInfo,
    };
  }
  return (
    <html lang="zh-CN" className={`${jakarta.variable} ${notoSC.variable} ${plexMono.variable}`}>
      <body>
        <ModeProvider>
          <ToastProvider>
            {/* STUDIO v2.3 外壳：现代顶部导航 + 全宽内容 + 移动底部 Tab */}
            <div className="flex min-h-screen flex-col bg-[var(--bg)] text-[var(--ink)]">
              <TopNav user={navUser} />
              <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 pb-28 pt-7 sm:px-6 md:pb-12">
                {children}
              </main>
              <MobileTabs loggedIn={Boolean(navUser)} />
            </div>
          </ToastProvider>
        </ModeProvider>
      </body>
    </html>
  );
}
