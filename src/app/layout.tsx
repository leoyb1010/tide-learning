import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Noto_Sans_SC, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { ModeProvider } from "@/components/ModeProvider";
import { ToastProvider } from "@/components/Toast";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { getCurrentUser } from "@/lib/session";

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const navUser = user ? { nickname: user.nickname, role: user.role } : null;
  return (
    <html lang="zh-CN" className={`${jakarta.variable} ${notoSC.variable} ${plexMono.variable}`}>
      <body>
        <ModeProvider>
          <ToastProvider>
            {/* STUDIO 外壳：左侧 Sidebar(桌面固定236px / 移动底部Tab) + 主内容列(顶栏+内容) */}
            <div className="flex min-h-screen bg-[var(--bg)] text-[var(--ink)]">
              <Sidebar user={navUser} />
              <div className="flex min-w-0 flex-1 flex-col">
                <Topbar user={navUser} />
                <main className="mx-auto w-full max-w-[1160px] flex-1 px-5 pb-28 pt-6 sm:px-8 md:pb-10">
                  {children}
                </main>
              </div>
            </div>
          </ToastProvider>
        </ModeProvider>
      </body>
    </html>
  );
}
