"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  House, GraduationCap, Monitor, NotePencil, PaperPlaneTilt, Medal, Crown,
  Compass, User, Flame, Sparkle, Cards, CardsThree, IdentificationCard, SignIn,
} from "@phosphor-icons/react/dist/ssr";
import { YoudaoLogo } from "./YoudaoLogo";
import { CommandK } from "./CommandK";

// 后台角色白名单（与 admin/layout.tsx 对齐）
const ADMIN_ROLES = ["admin", "content_manager", "demand_moderator", "support", "finance", "reviewer"];

/** v2.2 学生证数据（layout 服务端组装）。 */
export interface NavUser {
  nickname: string;
  role: string;
  avatarUrl: string | null;
  studentId: string;
  joinedLabel: string;
  streak: number;
  isSubscriber: boolean;
}

interface NavItem { href: string; label: string; Icon: typeof House; badge?: boolean }
interface NavGroup { label: string; en: string; items: NavItem[] }

/** 侧边导航分组（STUDIO：学习 / 社区）。首页/书桌项按登录态动态生成，见 buildGroups。 */
function buildGroups(loggedIn: boolean): NavGroup[] {
  return [
    {
      label: "学习", en: "LEARN",
      items: [
        // 登录后「首页」= 书桌 /desk（登录用户的家）；未登录 = 营销首页 /
        loggedIn
          ? { href: "/desk", label: "书桌", Icon: House }
          : { href: "/", label: "首页", Icon: House },
        { href: "/courses", label: "课程库", Icon: GraduationCap },
        { href: "/create", label: "AI 造课", Icon: Sparkle },
        { href: "/me/courses", label: "我的课", Icon: Cards },
        { href: "/notes", label: "笔记馆", Icon: NotePencil },
        { href: "/review", label: "复习室", Icon: CardsThree },
      ],
    },
    {
      label: "社区", en: "COMMUNITY",
      items: [
        { href: "/demands", label: "共创广场", Icon: PaperPlaneTilt },
        { href: "/me", label: "成长档案", Icon: Medal },
        { href: "/pricing", label: "订阅方案", Icon: Crown },
      ],
    },
  ];
}

// 移动端底部 5 Tab —— 造课居中凸起（核心卖点）。首页 Tab 登录后指向书桌。
function buildMobileTabs(loggedIn: boolean) {
  return [
    loggedIn
      ? { href: "/desk", label: "书桌", Icon: House, IconFill: House, raised: false }
      : { href: "/", label: "首页", Icon: House, IconFill: House, raised: false },
    { href: "/courses", label: "课程", Icon: Compass, IconFill: Compass, raised: false },
    { href: "/create", label: "造课", Icon: Sparkle, IconFill: Sparkle, raised: true },
    { href: "/notes", label: "笔记", Icon: NotePencil, IconFill: NotePencil, raised: false },
    { href: "/me", label: "我的", Icon: User, IconFill: User, raised: false },
  ];
}

export function Sidebar({ user }: { user: NavUser | null }) {
  const pathname = usePathname();
  const GROUPS = buildGroups(Boolean(user));
  const MOBILE_TABS = buildMobileTabs(Boolean(user));
  const isActive = (href: string) => {
    if (href === "/" || href === "/desk") return pathname === href;
    // /me（成长档案）需精确匹配，否则 /me/courses、/me/settings 会连带点亮它
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

        {/* 底部：学生证（v2.2）—— 真实身份卡，点击进成长档案 */}
        <div className="mt-auto">
          {user ? (
            <Link
              href="/me"
              className="studio-lift group relative block overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-3.5 pl-4 shadow-[var(--card)]"
            >
              {/* 左缘红色校条 */}
              <span className="absolute inset-y-0 left-0 w-[3px] bg-[var(--red)]" aria-hidden />
              <div className="flex items-center gap-2.5">
                {/* 头像徽 */}
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--video-bg)] text-[13px] font-bold text-white">
                  {user.nickname.slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-semibold text-[var(--ink)]">{user.nickname}</span>
                    {user.isSubscriber && <Crown size={12} weight="fill" className="shrink-0 text-[var(--red)]" />}
                  </div>
                  <span className="mono block truncate text-[10px] text-[var(--ink4)]">{user.studentId}</span>
                </div>
              </div>
              {/* 底部信息行：入学时间 + 连续天数 */}
              <div className="mt-2.5 flex items-center justify-between border-t border-[var(--border)] pt-2">
                <span className="mono text-[10px] text-[var(--ink4)]">{user.joinedLabel}</span>
                <span className="flex items-center gap-1 text-[11px] font-semibold text-[var(--ink2)]">
                  <Flame size={11} weight="fill" className="text-[var(--red)]" />
                  <span className="mono">{user.streak}</span> 天
                </span>
              </div>
              <span className="mono mt-1.5 block text-[8px] font-bold uppercase tracking-[0.18em] text-[var(--ink4)]">
                YOUDAO STUDIO · STUDENT ID
              </span>
            </Link>
          ) : (
            <Link
              href="/login"
              className="studio-lift group flex items-center gap-2.5 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-[var(--card)]"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--surface-inset)] text-[var(--ink3)]">
                <IdentificationCard size={18} weight="fill" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold text-[var(--ink)]">领取你的学生证</p>
                <p className="text-[11px] text-[var(--ink3)]">登录后开始记录学习</p>
              </div>
              <SignIn size={15} weight="bold" className="shrink-0 text-[var(--ink4)] transition-transform group-hover:translate-x-0.5" />
            </Link>
          )}
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
