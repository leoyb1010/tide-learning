"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, BookOpen, Sparkle, NotePencil, User, GearSix } from "@phosphor-icons/react/dist/ssr";
import { YoudaoLogo } from "./YoudaoLogo";

const TABS = [
  { href: "/", label: "发现", Icon: Compass },
  { href: "/courses", label: "学习", Icon: BookOpen },
  { href: "/demands", label: "共创", Icon: Sparkle },
  { href: "/notes", label: "笔记", Icon: NotePencil },
  { href: "/me", label: "我的", Icon: User },
];

export function Nav({ user }: { user: { nickname: string; role: string } | null }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <>
      {/* 顶部导航 */}
      <header className="sticky top-0 z-40 border-b border-ink-100/80 bg-paper/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-5 sm:px-8">
          <Link href="/" className="group flex items-center gap-2.5">
            <YoudaoLogo variant="red" height={19} priority className="transition-opacity duration-200 group-hover:opacity-80" />
            <span className="h-4 w-px bg-ink-200" />
            <span className="text-[1.02rem] font-semibold tracking-tight text-ink-950">潮汐学习</span>
          </Link>

          <nav className="hidden items-center gap-0.5 md:flex">
            {TABS.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className={`relative rounded-lg px-3.5 py-2 text-sm font-medium transition-colors duration-200 ${
                  isActive(t.href) ? "text-accent-700" : "text-ink-500 hover:text-ink-950"
                }`}
              >
                {t.label}
                {isActive(t.href) && <span className="absolute inset-x-3 -bottom-[1px] h-[2px] rounded-full bg-accent-600" />}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-1.5">
            {user?.role && user.role !== "user" && (
              <Link href="/admin" className="hidden items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-ink-500 transition-colors hover:text-ink-950 sm:flex">
                <GearSix size={16} /> 后台
              </Link>
            )}
            {user ? (
              <Link href="/me" className="flex items-center gap-2 rounded-full bg-accent-50 py-1.5 pl-1.5 pr-3.5 text-sm font-medium text-accent-700 transition-colors hover:bg-accent-100">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-600 text-[0.7rem] text-white">{user.nickname.slice(0, 1)}</span>
                <span className="hidden sm:inline">{user.nickname}</span>
              </Link>
            ) : (
              <>
                <Link href="/login" className="rounded-lg px-3 py-2 text-sm text-ink-500 transition-colors hover:text-ink-950">登录</Link>
                <Link href="/pricing" className="rounded-xl bg-accent-600 px-4 py-2 text-sm font-medium text-white transition-all duration-200 [transition-timing-function:var(--ease-out-expo)] hover:bg-accent-700 active:scale-[0.97]">订阅</Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* 底部 Tab（移动端）— 图标 + 呼吸激活态 */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-ink-100 bg-paper-raised/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        {TABS.map((t) => {
          const active = isActive(t.href);
          return (
            <Link key={t.href} href={t.href} className={`flex flex-col items-center gap-1 py-2.5 text-[0.68rem] transition-colors ${active ? "text-accent-700" : "text-ink-400"}`}>
              <t.Icon size={21} weight={active ? "fill" : "regular"} />
              {t.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
