import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Noto_Sans_SC, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { ModeProvider } from "@/components/ModeProvider";
import { ToastProvider } from "@/components/Toast";
import { TopNav } from "@/components/TopNav";
import { MobileTabs } from "@/components/MobileTabs";
import { ViewTransitions } from "@/components/ViewTransitions";
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
    "有道自习室 STUDIO，订阅制学习平台：口语实战、AI 技能、银发英语、生活实用。视频与笔记在同一张桌面，边看边记，随手截帧成卡。",
  keywords: ["有道自习室", "STUDIO", "订阅学习", "口语", "AI技能", "银发英语", "在线课程", "持续更新"],
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "有道自习室 · STUDIO",
    description: "视频与笔记在同一张桌面，边看边记，随手截帧成卡。持续更新的订阅制学习流。",
    type: "website",
    siteName: "有道自习室",
    locale: "zh_CN",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "有道自习室 STUDIO" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "有道自习室 · STUDIO",
    description: "视频与笔记在同一张桌面，边看边记。",
    images: ["/og-image.png"],
  },
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
    // v3.0：续学胶囊展开的最近学习课程（最多 5 门）。
    recentCourses: { courseSlug: string; courseTitle: string; lessonId: string; coursePct: number }[];
  } | null = null;
  if (user) {
    const [snapshot, recentProgress] = await Promise.all([
      resolveEntitlement(user.id),
      // 最近学习进度（带课程/章节）。取前 40 条足以覆盖续学胶囊所需的最近 5 门去重课程；
      // 首条即续学胶囊主入口，其余据此派生「最近 5 门课」下拉。越权铁律：where userId。
      prisma.learningProgress.findMany({
        where: { userId: user.id },
        orderBy: { lastPlayedAt: "desc" },
        take: 40,
        select: {
          lessonId: true,
          progressSec: true,
          courseId: true,
          course: { select: { slug: true, title: true } },
          lesson: { select: { id: true, title: true, durationSec: true } },
        },
      }),
    ]);
    const lastProgress = recentProgress[0] ?? null;
    // v2.3：订阅用户月度积分惰性赠送（本月未发则发，事务内防并发）。不阻塞渲染。
    const monthKey = shanghaiDayKey().slice(0, 7); // "2026-07"
    await ensureMonthlyGrant(user.id, monthKey, snapshot.isSubscriber, snapshot.monthlyGrant).catch(() => {});
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

    // v3.0：续学胶囊「最近 5 门课」——按最近学习倒序去重课程，取每门最近在学的章节。
    const seenCourse = new Set<string>();
    const recentTop: { courseSlug: string; courseTitle: string; lessonId: string; courseId: string }[] = [];
    for (const r of recentProgress) {
      if (!r.course || !r.lesson || seenCourse.has(r.courseId)) continue;
      seenCourse.add(r.courseId);
      recentTop.push({ courseSlug: r.course.slug, courseTitle: r.course.title, lessonId: r.lesson.id, courseId: r.courseId });
      if (recentTop.length >= 5) break;
    }
    // 各课总进度：完成章节数 / 课程总章节数（两次聚合查询，仅限这 5 门课）。
    const recentCourseIds = recentTop.map((c) => c.courseId);
    const [doneAgg, lessonCountAgg] = recentCourseIds.length
      ? await Promise.all([
          prisma.learningProgress.groupBy({
            by: ["courseId"],
            where: { userId: user.id, courseId: { in: recentCourseIds }, completedAt: { not: null } },
            _count: { _all: true },
          }),
          prisma.lesson.groupBy({
            by: ["courseId"],
            where: { courseId: { in: recentCourseIds } },
            _count: { _all: true },
          }),
        ])
      : [[], []];
    const doneMap = new Map(doneAgg.map((d) => [d.courseId, d._count._all]));
    const totalMap = new Map(lessonCountAgg.map((l) => [l.courseId, l._count._all]));
    const recentCourses = recentTop.map((c) => {
      const total = totalMap.get(c.courseId) ?? 0;
      const done = doneMap.get(c.courseId) ?? 0;
      return {
        courseSlug: c.courseSlug,
        courseTitle: c.courseTitle,
        lessonId: c.lessonId,
        coursePct: total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0,
      };
    });

    navUser = {
      nickname: user.nickname,
      role: user.role,
      studentId: shortStudentId(user.id),
      credits,
      resumeInfo,
      recentCourses,
    };
  }
  return (
    // suppressHydrationWarning：下方 anti-FOUC 脚本会在 React 水合前往 <html> 写
    // data-mode/data-theme/--font-scale（读 localStorage 的用户偏好），服务端渲染的
    // <html> 无这些属性，React 19 会报 attribute mismatch。这是主题脚本的预期差异，
    // 只压 <html> 自身的属性对比（不影响子树校验）。
    <html lang="zh-CN" className={`${jakarta.variable} ${notoSC.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <head>
        {/*
          Anti-FOUC：paint 前从 localStorage 同步主题/字号/亮暗到 <html> dataset，
          与 ModeProvider 的 effect（挂载后）逻辑逐条对齐，避免已存 dark/deep/elder
          的用户先闪浅色标准态再切。只改 documentElement 的 dataset/style，不触碰 React
          树，因此不引入 hydration mismatch。localStorage 不可用（隐私模式/SSR 早期）时
          静默兜底到默认态。key 名与 ModeProvider 一致：
          tide_mode / tide_font_scale / tide_theme / studio_color_scheme。
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var e=document.documentElement;var g=function(k){try{return localStorage.getItem(k)}catch(_){return null}};var m=g("tide_mode")||"standard";e.dataset.mode=m;var s=parseFloat(g("tide_font_scale"));if(!s||isNaN(s))s=1;e.style.setProperty("--font-scale",String(s));var t=g("tide_theme")||"light";var c=g("studio_color_scheme")||"system";if(t==="deep"){e.dataset.theme="deep"}else if(c==="system"){delete e.dataset.theme}else{e.dataset.theme=c}}catch(_){}})();`,
          }}
        />
      </head>
      <body>
        <ModeProvider>
          <ToastProvider>
            {/* v3.0 页面转场：软导航 View Transitions 驱动（无 UI，渐进增强） */}
            <ViewTransitions />
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
