import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ModeProvider } from "@/components/ModeProvider";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: {
    default: "潮汐学习 · 全龄订阅制学习平台",
    template: "%s · 潮汐学习",
  },
  description:
    "按月订阅，解锁持续更新的体系化课程：AI 实用技能、雅思备考、生活实用课。用需求投票决定下一批课程，学习与笔记一体。",
  keywords: ["订阅学习", "AI技能", "雅思", "在线课程", "持续更新", "学习笔记"],
  openGraph: { title: "潮汐学习", description: "持续更新的订阅制学习流", type: "website" },
};

export const viewport: Viewport = {
  themeColor: "#1f7a70",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const navUser = user ? { nickname: user.nickname, role: user.role } : null;
  return (
    <html lang="zh-CN">
      <body>
        <ModeProvider>
          <Nav user={navUser} />
          <main className="mx-auto min-h-[70vh] w-full max-w-6xl px-4 pb-24 pt-6 sm:px-6 md:pb-6">{children}</main>
          <Footer />
        </ModeProvider>
      </body>
    </html>
  );
}
