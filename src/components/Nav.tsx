"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "发现", icon: "◈" },
  { href: "/courses", label: "学习", icon: "▤" },
  { href: "/demands", label: "共创", icon: "✦" },
  { href: "/notes", label: "笔记", icon: "✎" },
  { href: "/me", label: "我的", icon: "☺" },
];

export function Nav({ user }: { user: { nickname: string; role: string } | null }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <>
      {/* 顶部导航（桌面） */}
      <header className="sticky top-0 z-40 border-b border-ink-100 bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-xl">🌊</span>
            <span className="text-lg font-semibold tracking-tight text-ink-950">潮汐学习</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {TABS.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive(t.href) ? "text-tide-700" : "text-ink-500 hover:text-ink-950"
                }`}
              >
                {t.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {user?.role && user.role !== "user" && (
              <Link href="/admin" className="hidden rounded-lg px-3 py-2 text-sm text-ink-500 hover:text-ink-950 sm:block">
                后台
              </Link>
            )}
            {user ? (
              <Link href="/me" className="rounded-lg bg-tide-50 px-3 py-2 text-sm font-medium text-tide-700">
                {user.nickname}
              </Link>
            ) : (
              <>
                <Link href="/login" className="rounded-lg px-3 py-2 text-sm text-ink-500 hover:text-ink-950">
                  登录
                </Link>
                <Link href="/pricing" className="rounded-xl bg-tide-600 px-4 py-2 text-sm font-medium text-white hover:bg-tide-700">
                  订阅
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* 底部 Tab（移动端） */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 grid grid-cols-5 border-t border-ink-100 bg-paper-raised/95 backdrop-blur-md md:hidden">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={`flex flex-col items-center gap-0.5 py-2 text-xs ${
              isActive(t.href) ? "text-tide-700" : "text-ink-400"
            }`}
          >
            <span className="text-base">{t.icon}</span>
            {t.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
