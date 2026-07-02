"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, BookOpen, Sparkle, NotePencil, User, GearSix, MagnifyingGlass, Waves } from "@phosphor-icons/react/dist/ssr";
import { YoudaoLogo } from "./YoudaoLogo";
import { CommandK } from "./CommandK";
import { useMode } from "./ModeProvider";
import { track } from "@/lib/analytics-client";

const TABS = [
  { href: "/", label: "发现", Icon: Compass },
  { href: "/courses", label: "学习", Icon: BookOpen },
  { href: "/demands", label: "共创", Icon: Sparkle },
  { href: "/notes", label: "笔记", Icon: NotePencil },
  { href: "/me", label: "我的", Icon: User },
];

export function Nav({ user }: { user: { nickname: string; role: string } | null }) {
  const pathname = usePathname();
  const { theme, toggleTheme } = useMode();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  // 触发 ⌘K：合成一个键盘事件，复用 CommandK 的全局监听
  const openCommandK = () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
  };

  const onToggleTheme = () => {
    toggleTheme();
    track("theme_toggle", { to: theme === "deep" ? "light" : "deep", source: "nav" });
  };

  return (
    <>
      {/* ⌘K 命令面板（全局挂载，键盘唤起） */}
      <CommandK />

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
            {/* ⌘K 触发入口（桌面） */}
            <button
              onClick={openCommandK}
              className="hidden items-center gap-2 rounded-lg border border-ink-100 px-2.5 py-1.5 text-sm text-ink-400 transition-colors hover:border-accent-200 hover:text-ink-700 md:flex"
              aria-label="打开命令面板"
            >
              <MagnifyingGlass size={15} />
              <span className="text-xs">搜索</span>
              <kbd className="num rounded bg-ink-100 px-1.5 py-0.5 text-[0.62rem] text-ink-400">⌘K</kbd>
            </button>

            {/* 深海模式切换入口 */}
            <button
              onClick={onToggleTheme}
              className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                theme === "deep" ? "bg-accent-50 text-accent-700" : "text-ink-400 hover:text-ink-700"
              }`}
              aria-label={theme === "deep" ? "切换到浅色模式" : "切换到深海模式"}
              aria-pressed={theme === "deep"}
            >
              <Waves size={18} weight={theme === "deep" ? "fill" : "regular"} />
            </button>

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

      {/* 底部 Tab（移动端）— 图标 fill/regular 切换带 scale+opacity 过渡（A3-4） */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-ink-100 bg-paper-raised/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        {TABS.map((t) => {
          const active = isActive(t.href);
          return (
            <Link key={t.href} href={t.href} className={`flex flex-col items-center gap-1 py-2.5 text-[0.68rem] transition-colors ${active ? "text-accent-700" : "text-ink-400"}`}>
              {/* 双层图标叠放：激活态 fill 淡入放大，非激活态 regular 淡出，过渡自然 */}
              <span className="relative grid h-[21px] w-[21px] place-items-center">
                <t.Icon
                  size={21}
                  weight="regular"
                  className={`absolute transition-all duration-[var(--dur-fast)] [transition-timing-function:var(--ease-tide)] motion-reduce:transition-none ${active ? "scale-90 opacity-0" : "scale-100 opacity-100"}`}
                />
                <t.Icon
                  size={21}
                  weight="fill"
                  className={`absolute transition-all duration-[var(--dur-fast)] [transition-timing-function:var(--ease-tide)] motion-reduce:transition-none ${active ? "scale-100 opacity-100" : "scale-75 opacity-0"}`}
                />
              </span>
              {t.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
