"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MagnifyingGlass, Moon, Sun } from "@phosphor-icons/react/dist/ssr";
import { useMode } from "./ModeProvider";
import { track } from "@/lib/analytics-client";

/** 路由 → 页面标题映射（STUDIO 顶栏左侧标题） */
function pageTitle(pathname: string): string {
  if (pathname === "/") return "首页";
  if (pathname.startsWith("/courses") && pathname.includes("/learn/")) return "学习工作台";
  if (pathname.startsWith("/courses/")) return "课程详情";
  if (pathname.startsWith("/courses")) return "课程库";
  if (pathname.startsWith("/notes")) return "笔记馆";
  if (pathname.startsWith("/demands")) return "共创广场";
  if (pathname.startsWith("/pricing")) return "订阅方案";
  if (pathname.startsWith("/me/subscription")) return "订阅管理";
  if (pathname.startsWith("/me/settings")) return "设置";
  if (pathname.startsWith("/me")) return "成长激励";
  if (pathname.startsWith("/admin")) return "运营后台";
  if (pathname.startsWith("/updates")) return "本周上新";
  if (pathname.startsWith("/login")) return "登录";
  return "有道自习室";
}

export function Topbar({ user }: { user: { nickname: string; role: string } | null }) {
  const pathname = usePathname();
  const { resolvedDark, toggleColorScheme } = useMode();

  const openCommandK = () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
  };
  const onToggleTheme = () => {
    toggleColorScheme();
    track("theme_toggle", { to: resolvedDark ? "light" : "dark", source: "topbar" });
  };

  return (
    <header
      className="sticky top-0 z-20 flex items-center gap-4 border-b border-[var(--border)] px-5 py-3.5 backdrop-blur-md sm:px-8"
      style={{ background: "color-mix(in srgb, var(--bg) 82%, transparent)" }}
    >
      <h1 className="text-[18px] font-bold text-[var(--ink)]">{pageTitle(pathname)}</h1>

      <div className="ml-auto flex items-center gap-2.5">
        {/* 搜索（唤起 ⌘K） */}
        <button
          onClick={openCommandK}
          className="hidden items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-2 text-[13px] text-[var(--ink3)] transition-colors hover:border-[var(--ink4)] hover:text-[var(--ink2)] sm:flex"
          aria-label="搜索"
        >
          <MagnifyingGlass size={15} />
          <span>搜课程、笔记、共创…</span>
          <kbd className="mono rounded bg-[var(--surface-inset)] px-1.5 py-0.5 text-[10px] text-[var(--ink4)]">⌘K</kbd>
        </button>

        {/* 亮暗切换 */}
        <button
          onClick={onToggleTheme}
          className="grid h-[38px] w-[38px] place-items-center rounded-[11px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink2)] transition-colors hover:text-[var(--ink)]"
          aria-label={resolvedDark ? "切换到浅色" : "切换到暗色"}
          aria-pressed={resolvedDark}
        >
          {resolvedDark ? <Sun size={18} weight="fill" /> : <Moon size={18} />}
        </button>

        {/* 头像 / 登录 */}
        {user ? (
          <Link
            href="/me"
            className="grid h-[38px] w-[38px] place-items-center rounded-full text-[13px] font-semibold text-white"
            style={{ background: "linear-gradient(135deg, var(--red), #ff5462)" }}
            aria-label={user.nickname}
          >
            {user.nickname.slice(0, 1)}
          </Link>
        ) : (
          <Link
            href="/login"
            className="rounded-[11px] bg-[var(--ink)] px-4 py-2 text-[13px] font-semibold text-[var(--surface)] transition-opacity hover:opacity-90"
          >
            登录
          </Link>
        )}
      </div>
    </header>
  );
}
