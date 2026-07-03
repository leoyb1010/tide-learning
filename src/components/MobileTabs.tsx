"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, Compass, Sparkle, NotePencil, User } from "@phosphor-icons/react/dist/ssr";

/**
 * 移动端底部 5 Tab（<md）—— 造课居中凸起。v2.3 从 Sidebar 抽出为独立组件，
 * 配合 TopNav 顶部导航壳（桌面顶栏 / 移动顶栏+底Tab）。
 */
function buildTabs(loggedIn: boolean) {
  return [
    loggedIn
      ? { href: "/desk", label: "书桌", Icon: House, raised: false }
      : { href: "/", label: "首页", Icon: House, raised: false },
    { href: "/courses", label: "课程", Icon: Compass, raised: false },
    { href: "/create", label: "造课", Icon: Sparkle, raised: true },
    { href: "/notes", label: "笔记", Icon: NotePencil, raised: false },
    { href: "/me", label: "我的", Icon: User, raised: false },
  ];
}

export function MobileTabs({ loggedIn }: { loggedIn: boolean }) {
  const pathname = usePathname();
  const tabs = buildTabs(loggedIn);
  const isActive = (href: string) => {
    if (href === "/" || href === "/desk") return pathname === href;
    if (href === "/me") return pathname === "/me";
    return pathname.startsWith(href);
  };

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-[var(--border)] bg-[var(--surface)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
      {tabs.map((t) => {
        const active = isActive(t.href);
        if (t.raised) {
          return (
            <Link key={t.href} href={t.href} className="flex flex-col items-center gap-1 py-2.5 text-[0.68rem] text-[var(--ink4)]">
              <span className="studio-press -mt-6 grid h-[46px] w-[46px] place-items-center rounded-full bg-[var(--red)] text-white shadow-[0_6px_16px_-4px_rgba(252,1,26,0.5)]">
                <t.Icon size={22} weight="fill" />
              </span>
              <span className={active ? "text-[var(--red)]" : ""}>{t.label}</span>
            </Link>
          );
        }
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`flex flex-col items-center gap-1 py-2.5 text-[0.68rem] transition-colors ${active ? "text-[var(--red)]" : "text-[var(--ink4)]"}`}
          >
            <t.Icon size={21} weight={active ? "fill" : "regular"} />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
