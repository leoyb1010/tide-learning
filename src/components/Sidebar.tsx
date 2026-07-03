"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  House, GraduationCap, Monitor, NotePencil, PaperPlaneTilt, Medal, Crown,
  Compass, User, Flame, Sparkle, Cards,
} from "@phosphor-icons/react/dist/ssr";
import { YoudaoLogo } from "./YoudaoLogo";
import { CommandK } from "./CommandK";

// 后台角色白名单（与 admin/layout.tsx 对齐）
const ADMIN_ROLES = ["admin", "content_manager", "demand_moderator", "support", "finance", "reviewer"];

/** 侧边导航分组（STUDIO：学习 / 社区 / 我的） */
const GROUPS: { label: string; en: string; items: { href: string; label: string; Icon: typeof House; badge?: boolean }[] }[] = [
  {
    label: "学习", en: "LEARN",
    items: [
      { href: "/", label: "首页", Icon: House },
      { href: "/courses", label: "课程库", Icon: GraduationCap },
      { href: "/create", label: "AI 造课", Icon: Sparkle },
      { href: "/me/courses", label: "我的课", Icon: Cards },
      { href: "/notes", label: "笔记馆", Icon: NotePencil },
    ],
  },
  {
    label: "社区", en: "COMMUNITY",
    items: [
      { href: "/demands", label: "共创广场", Icon: PaperPlaneTilt },
      { href: "/me", label: "成长激励", Icon: Medal },
      { href: "/pricing", label: "订阅方案", Icon: Crown },
    ],
  },
];

// 移动端底部 5 Tab —— 造课居中凸起（核心卖点）
const MOBILE_TABS = [
  { href: "/", label: "首页", Icon: House, IconFill: House, raised: false },
  { href: "/courses", label: "课程", Icon: Compass, IconFill: Compass, raised: false },
  { href: "/create", label: "造课", Icon: Sparkle, IconFill: Sparkle, raised: true },
  { href: "/notes", label: "笔记", Icon: NotePencil, IconFill: NotePencil, raised: false },
  { href: "/me", label: "我的", Icon: User, IconFill: User, raised: false },
];

export function Sidebar({ user }: { user: { nickname: string; role: string } | null }) {
  const pathname = usePathname();
  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    // /me（成长激励）需精确匹配，否则 /me/courses、/me/settings 会连带点亮它
    if (href === "/me") return pathname === "/me";
    return pathname.startsWith(href);
  };

  return (
    <>
      <CommandK />

      {/* ============ 桌面侧边栏（≥md）============ */}
      <aside
        className="sticky top-0 hidden h-screen w-[236px] shrink-0 flex-col gap-1 border-r border-[var(--border)] bg-[var(--bg2)] px-4 py-5 md:flex"
      >
        {/* Logo 行：透明有道字标横排 + 分隔线 + 产品名（弃"方盒装 logo"，发挥透明 logo 品牌力） */}
        <Link href="/" className="group mb-3 flex items-center gap-2.5 px-2 pb-4 pt-1">
          <YoudaoLogo variant="red" height={15} priority className="transition-opacity duration-200 group-hover:opacity-80" />
          <span className="h-[15px] w-px bg-[var(--border2)]" />
          <span className="leading-[1.1]">
            <span className="block text-[14px] font-semibold tracking-tight text-[var(--ink)]">自习室</span>
            <span className="mono block text-[8px] font-bold tracking-[0.2em] text-[var(--ink4)]">STUDIO</span>
          </span>
        </Link>

        {/* 导航分组 */}
        {GROUPS.map((g) => (
          <nav key={g.en} className="flex flex-col gap-0.5">
            <div className="mono px-2.5 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink4)]">
              {g.label} {g.en}
            </div>
            {g.items.map((it) => {
              const active = isActive(it.href);
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  className={`flex items-center gap-[11px] rounded-[11px] px-3 py-[10px] text-[13.5px] font-semibold transition-all duration-150 ${
                    active
                      ? "bg-[var(--surface)] text-[var(--ink)] shadow-[var(--card)]"
                      : "text-[var(--ink3)] hover:bg-[var(--surface2)] hover:text-[var(--ink)]"
                  }`}
                >
                  <it.Icon size={18} weight={active ? "fill" : "regular"} />
                  <span className="flex-1">{it.label}</span>
                  {it.badge && <span className="h-1.5 w-1.5 rounded-full bg-[var(--red)]" />}
                </Link>
              );
            })}
          </nav>
        ))}

        {/* 后台入口（仅后台角色） */}
        {user?.role && ADMIN_ROLES.includes(user.role) && (
          <nav className="flex flex-col gap-0.5">
            <div className="mono px-2.5 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink4)]">运营 ADMIN</div>
            <Link
              href="/admin"
              className={`flex items-center gap-[11px] rounded-[11px] px-3 py-[10px] text-[13.5px] font-semibold transition-all duration-150 ${
                isActive("/admin") ? "bg-[var(--surface)] text-[var(--ink)] shadow-[var(--card)]" : "text-[var(--ink3)] hover:bg-[var(--surface2)] hover:text-[var(--ink)]"
              }`}
            >
              <Monitor size={18} weight={isActive("/admin") ? "fill" : "regular"} />
              <span className="flex-1">运营后台</span>
            </Link>
          </nav>
        )}

        {/* 底部：连续学习卡 */}
        <div className="mt-auto rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-[var(--card)]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-[var(--ink2)]">连续学习</span>
            <Flame size={13} weight="fill" className="text-[var(--red)]" />
          </div>
          <div className="mt-0.5 font-[var(--font-jakarta)] text-[26px] font-extrabold leading-none text-[var(--ink)]">
            28<span className="ml-1 text-[15px] font-normal text-[var(--ink3)]">天</span>
          </div>
          <div className="mt-2 flex gap-[3px]">
            {Array.from({ length: 14 }).map((_, i) => (
              <span key={i} className={`h-1.5 flex-1 rounded-[2px] ${i > 1 ? "bg-[var(--red)]" : "bg-[var(--border2)]"}`} />
            ))}
          </div>
        </div>
      </aside>

      {/* ============ 移动端底部 Tab（<md）============ */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-[var(--border)] bg-[var(--surface)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        {MOBILE_TABS.map((t) => {
          const active = isActive(t.href);
          // 造课居中凸起：红圆按钮上浮
          if (t.raised) {
            return (
              <Link key={t.href} href={t.href} className="flex flex-col items-center gap-1 py-2.5 text-[0.68rem] text-[var(--ink4)]">
                <span className="studio-press -mt-6 grid h-[46px] w-[46px] place-items-center rounded-full bg-[var(--red)] text-white shadow-[0_6px_16px_-4px_rgba(252,1,26,0.5)]">
                  <t.IconFill size={22} weight="fill" />
                </span>
                <span className={active ? "text-[var(--red)]" : ""}>{t.label}</span>
              </Link>
            );
          }
          return (
            <Link key={t.href} href={t.href} className={`flex flex-col items-center gap-1 py-2.5 text-[0.68rem] transition-colors ${active ? "text-[var(--red)]" : "text-[var(--ink4)]"}`}>
              <span className="relative grid h-[21px] w-[21px] place-items-center">
                <t.Icon size={21} weight="regular" className={`absolute transition-all duration-200 [transition-timing-function:var(--ease-out-expo)] motion-reduce:transition-none ${active ? "scale-90 opacity-0" : "scale-100 opacity-100"}`} />
                <t.IconFill size={21} weight="fill" className={`absolute transition-all duration-200 [transition-timing-function:var(--ease-out-expo)] motion-reduce:transition-none ${active ? "scale-100 opacity-100" : "scale-75 opacity-0"}`} />
              </span>
              {t.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
