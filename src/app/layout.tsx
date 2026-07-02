import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { ModeProvider } from "@/components/ModeProvider";
import { ToastProvider } from "@/components/Toast";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: {
    default: "潮汐学习 · 订阅制学习平台",
    template: "%s · 潮汐学习",
  },
  description:
    "按月订阅，解锁持续更新的体系化课程：口语实战、AI 技能、银发英语、生活实用。全站畅学或单赛道自由组合，学习与笔记一体。",
  keywords: ["订阅学习", "口语", "AI技能", "银发英语", "在线课程", "持续更新"],
  openGraph: { title: "潮汐学习", description: "持续更新的订阅制学习流", type: "website" },
};

export const viewport: Viewport = {
  themeColor: "#fc011a",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const navUser = user ? { nickname: user.nickname, role: user.role } : null;
  return (
    <html lang="zh-CN" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <ModeProvider>
          <ToastProvider>
            <Nav user={navUser} />
            <main className="mx-auto min-h-[70vh] w-full max-w-[1280px] px-5 pb-28 pt-4 sm:px-8 md:pb-10">
              {children}
            </main>
            <Footer />
          </ToastProvider>
        </ModeProvider>
      </body>
    </html>
  );
}
