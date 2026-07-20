"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  House, GraduationCap, Sparkle, NotePencil, CardsThree,
  MagnifyingGlass, Moon, Sun, Monitor, Play, List, X,
  Storefront, PaperPlaneTilt, Medal, Crown, Gear, SignOut, SquaresFour, Coins,
  ClockCounterClockwise, CaretRight, CaretDown,
} from "@phosphor-icons/react/dist/ssr";
import { useMode } from "./ModeProvider";
import { NotifBell } from "./NotifBell";
import { CommandK } from "./CommandK";
import { YoudaoLogo } from "./YoudaoLogo";
import { GenNavIndicator } from "./GenNavIndicator";
import { track } from "@/lib/analytics-client";
import { trapFocus } from "./focus-trap";
import type { NavUser } from "./nav-types";
import { useToast } from "./Toast";

const ADMIN_ROLES = ["admin", "content_manager", "demand_moderator", "support", "finance", "reviewer"];

// 顶栏会员胶囊：由订阅状态派生「短标签 + 语气」。tooltip 用完整 statusLabel（可能是整句）。
const SUB_PILL: Record<string, { short: string; tone: "member" | "warn" | "free" }> = {
  active: { short: "会员", tone: "member" },
  trial: { short: "试用", tone: "member" },
  canceled_but_active: { short: "会员", tone: "member" },
  grace_period: { short: "续费中", tone: "warn" },
  billing_retry: { short: "待续费", tone: "warn" },
  free: { short: "开通会员", tone: "free" },
  expired: { short: "已到期", tone: "free" },
  refunded: { short: "开通会员", tone: "free" },
  revoked: { short: "开通会员", tone: "free" },
};

function subPillView(user: NavUser): { short: string; tooltip: string; cls: string; fill: boolean } {
  const status = user.subscriptionStatus ?? (user.isSubscriber ? "active" : "free");
  const meta = SUB_PILL[status] ?? { short: user.isSubscriber ? "会员" : "开通会员", tone: user.isSubscriber ? "member" : "free" as const };
  const validTxt =
    user.isSubscriber && user.validUntil ? ` · 到期 ${user.validUntil.slice(0, 10)}` : "";
  const tooltip = (user.statusLabel ?? meta.short) + validTxt;
  const cls =
    meta.tone === "member"
      ? "border-[var(--red-soft-border)] bg-[var(--red-soft)] text-[var(--red)]"
      : meta.tone === "warn"
        ? "border-[var(--warn)] bg-[var(--warn-soft)] text-[var(--warn)]"
        : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink3)] hover:text-[var(--ink)]";
  return { short: meta.short, tooltip, cls, fill: meta.tone !== "free" };
}

/**
 * TopNav —— v2.3 §C7 现代顶部导航壳（替代传统左侧栏）。
 * 单一顶栏：logo + 主导航横排 + 右侧工具（续学/搜索/铃铛/主题/积分/头像下拉）。
 * 全宽内容区（内容自身居中）。移动端：logo + 汉堡抽屉 + 保留底部 Tab（由 MobileTabs 提供）。
 */

// 主导航（横排一线）：书桌/首页 + 核心学习入口 + 社区 / 集市（⑫ 拆平级，与其余主项同级）。
interface NavLink { href: string; label: string; Icon: typeof House }

function primaryLinks(loggedIn: boolean): NavLink[] {
  return [
    loggedIn ? { href: "/desk", label: "书桌", Icon: House } : { href: "/", label: "首页", Icon: House },
    { href: "/courses", label: "课程库", Icon: GraduationCap },
    { href: "/create", label: "AI 造课", Icon: Sparkle },
    { href: "/notes", label: "笔记馆", Icon: NotePencil },
    { href: "/review", label: "复习室", Icon: CardsThree },
    // ⑫：社区广场 / 课程集市从「社区下拉」拆出，升为平级主导航项（重要程度对齐其余主项）。
    { href: "/demands", label: "社区广场", Icon: PaperPlaneTilt },
    { href: "/market", label: "课程集市", Icon: Storefront },
  ];
}

export function TopNav({ user }: { user: NavUser | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const { colorScheme, cycleColorScheme } = useMode();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false); // 头像下拉
  const [resumeOpen, setResumeOpen] = useState(false); // v3.0 续学胶囊下拉
  const [logoutPending, setLogoutPending] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const resumeRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null); // 移动抽屉面板：focus trap 边界
  const hamburgerRef = useRef<HTMLButtonElement>(null); // 汉堡按钮：抽屉关闭后还焦锚点
  // 下拉开合的 ref 镜像：供「挂载一次」的事件委托在回调内即时读取，
  // 避免把 menuOpen 塞进 effect 依赖导致每次开合都重绑监听器。
  const menuOpenRef = useRef(false);
  const resumeOpenRef = useRef(false);
  menuOpenRef.current = menuOpen;
  resumeOpenRef.current = resumeOpen;

  const loggedIn = Boolean(user);
  const links = primaryLinks(loggedIn);
  const resume = user?.resumeInfo ?? null;
  const recentCourses = user?.recentCourses ?? [];

  const isActive = (href: string) => {
    if (href === "/" || href === "/desk") return pathname === href;
    return pathname.startsWith(href);
  };

  async function logout() {
    if (logoutPending) return;
    setLogoutPending(true);
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) {
        toast("退出失败，请稍后重试", { tone: "warn" });
        setLogoutPending(false);
        return;
      }
      setMenuOpen(false);
      setDrawerOpen(false);
      router.push("/");
      router.refresh();
    } catch {
      toast("网络异常，退出失败，请重试", { tone: "warn" });
      setLogoutPending(false);
    }
  }

  // 点击外部关闭下拉：挂载一次的事件委托（空依赖只绑一次），
  // 回调内经 ref 判断当前开合，仅在确有下拉打开且点到外部时才 setState。
  useEffect(() => {
    function onClick(e: MouseEvent) {
      // 两个下拉都关着：什么都不做，避免每次点击的无谓状态更新。
      if (!menuOpenRef.current && !resumeOpenRef.current) return;
      const target = e.target as Node;
      if (menuOpenRef.current && menuRef.current && !menuRef.current.contains(target)) setMenuOpen(false);
      if (resumeOpenRef.current && resumeRef.current && !resumeRef.current.contains(target)) setResumeOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // 路由变化关闭所有浮层
  useEffect(() => {
    setDrawerOpen(false);
    setMenuOpen(false);
    setResumeOpen(false);
  }, [pathname]);

  // 移动抽屉 = 无障碍模态：Esc 关闭 + Tab focus trap + body 锁滚 + 焦点移入/还原。
  // 与 Dialog / SharePanel 同一范式（trapFocus 复用共享模块）。仅在打开时挂监听。
  useEffect(() => {
    if (!drawerOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setDrawerOpen(false);
      } else if (e.key === "Tab") {
        trapFocus(e, drawerRef.current);
      }
    };
    document.addEventListener("keydown", onKey);
    const returnFocus = hamburgerRef.current;
    // 焦点移入抽屉（关闭按钮为首个可聚焦项）。
    const raf = requestAnimationFrame(() =>
      drawerRef.current?.querySelector<HTMLElement>("button,a[href]")?.focus(),
    );
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
      // 关闭后把焦点还给汉堡按钮（焦点不丢，WCAG 2.4.3）。
      returnFocus?.focus?.();
    };
  }, [drawerOpen]);

  const openCommandK = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
  // 三态循环：跟随系统 → 浅 → 深 → 跟随系统。埋点记录切换目标。
  const nextScheme = colorScheme === "system" ? "light" : colorScheme === "light" ? "dark" : "system";
  const onToggleTheme = () => {
    cycleColorScheme();
    track("theme_toggle", { to: nextScheme, source: "topnav" });
  };
  const schemeLabel =
    colorScheme === "system" ? "主题：跟随系统（点击切浅色）"
    : colorScheme === "light" ? "主题：浅色（点击切深色）"
    : "主题：深色（点击切跟随系统）";

  return (
    <>
      <CommandK />
      <header
        className="sticky top-0 border-b border-[var(--border)] backdrop-blur-md"
        style={{ zIndex: "var(--z-sticky)", background: "color-mix(in srgb, var(--bg) 88%, transparent)" }}
      >
        <div className="mx-auto max-w-[1320px] px-4 sm:px-6">
          <div className="flex h-[60px] items-center gap-3">
          {/* Logo */}
          <Link href={loggedIn ? "/desk" : "/"} className="group flex shrink-0 items-center gap-2 pr-1">
            <YoudaoLogo variant="red" height={14} priority className="transition-opacity group-hover:opacity-80" />
            <span className="hidden leading-none sm:inline">
              <span className="block text-[13px] font-bold tracking-tight text-[var(--ink)]">自习室</span>
            </span>
          </Link>

          {/* 主导航（桌面横排）：全部主项平级一线，社区广场 / 课程集市已与其余项同级（⑫）。
              lg 以下窄桌面把靠后的项（社区/集市）收进汉堡抽屉，避免横排挤压；lg 起全展开。 */}
          <nav className="hidden items-center gap-0.5 md:flex">
            {links.map((l, i) => {
              const active = isActive(l.href);
              // 前 5 项（书桌/课程库/AI造课/笔记馆/复习室）始终显示；社区/集市在 md–lg 收起、lg 起显示。
              const lateItem = i >= 5;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`shrink-0 whitespace-nowrap rounded-[10px] px-3 py-2 text-[14px] font-semibold transition-colors ${lateItem ? "hidden lg:block" : ""} ${
                    active ? "bg-[var(--surface)] text-[var(--ink)] shadow-[var(--card)]" : "text-[var(--ink3)] hover:bg-[var(--surface2)] hover:text-[var(--ink)]"
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>

          {/* 右侧工具区 */}
          <div className="ml-auto flex items-center gap-2">
            {/* 续学胶囊（v3.0：点击展开最近 5 门课 + 全部学习记录入口） */}
            {resume && (
              <div ref={resumeRef} className="relative hidden lg:block">
                <button
                  type="button"
                  onClick={() => setResumeOpen((o) => !o)}
                  aria-expanded={resumeOpen}
                  aria-haspopup="menu"
                  className="studio-lift flex max-w-[220px] items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] py-1.5 pl-2.5 pr-2.5 text-[13px] shadow-[var(--card)] transition-colors hover:border-[var(--ink4)]"
                  title={`继续学习：${resume.courseTitle} · ${resume.lessonTitle}`}
                >
                  <Play size={12} weight="fill" className="shrink-0 text-[var(--red)]" />
                  <span className="truncate font-medium text-[var(--ink)]">{resume.courseTitle}</span>
                  <span className="mono shrink-0 text-[var(--ink3)]">{resume.pct}%</span>
                  <CaretDown size={11} weight="bold" className={`shrink-0 text-[var(--ink4)] transition-transform ${resumeOpen ? "rotate-180" : ""}`} />
                </button>
                {resumeOpen && (
                  <div
                    role="menu"
                    className="studio-rise absolute right-0 top-[calc(100%+8px)] w-[280px] overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--lift)]"
                  >
                    <div className="border-b border-[var(--border)] px-3.5 py-2.5">
                      <span className="mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink4)]">继续学习</span>
                    </div>
                    <div className="p-1.5">
                      {recentCourses.map((c) => (
                        <Link
                          key={c.courseSlug}
                          href={`/courses/${c.courseSlug}/learn/${c.lessonId}`}
                          onClick={() => track("resume_capsule_click", { course_slug: c.courseSlug })}
                          className="group flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 transition-colors hover:bg-[var(--surface2)]"
                        >
                          {/* 迷你环形进度：以百分比染红弧，中心显示% */}
                          <span
                            className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full"
                            style={{ background: `conic-gradient(var(--red) ${c.coursePct * 3.6}deg, var(--surface-inset) 0deg)` }}
                            aria-hidden
                          >
                            <span className="mono grid h-7 w-7 place-items-center rounded-full bg-[var(--surface)] text-[9px] font-bold text-[var(--ink2)]">
                              {c.coursePct}
                            </span>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold text-[var(--ink)] group-hover:text-[var(--red)]">
                              {c.courseTitle}
                            </span>
                            <span className="mono text-[11px] text-[var(--ink4)]">进度 {c.coursePct}%</span>
                          </span>
                          <Play size={12} weight="fill" className="shrink-0 text-[var(--ink4)] group-hover:text-[var(--red)]" />
                        </Link>
                      ))}
                    </div>
                    <Link
                      href="/me/history"
                      className="flex items-center justify-between border-t border-[var(--border)] px-3.5 py-2.5 text-[13px] font-semibold text-[var(--ink2)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--ink)]"
                    >
                      <span className="flex items-center gap-2">
                        <ClockCounterClockwise size={15} weight="fill" className="text-[var(--ink3)]" />
                        全部学习记录
                      </span>
                      <CaretRight size={12} weight="bold" className="text-[var(--ink4)]" />
                    </Link>
                  </div>
                )}
              </div>
            )}

            {/* 会员状态 + 积分胶囊（md 起显示；移动端收进头像下拉头部） */}
            {user && (() => {
              const pill = subPillView(user);
              return (
                <div className="hidden items-center gap-1.5 md:flex">
                  <Link
                    href="/pricing"
                    title={pill.tooltip}
                    aria-label={`会员状态：${pill.tooltip}`}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${pill.cls}`}
                  >
                    <Crown size={13} weight={pill.fill ? "fill" : "regular"} />
                    <span className="hidden lg:inline">{pill.short}</span>
                  </Link>
                  <Link
                    href="/me"
                    title={`积分余额 ${(user.credits ?? 0).toLocaleString()}`}
                    aria-label={`积分余额 ${user.credits ?? 0}`}
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[12px] font-semibold text-[var(--ink2)] transition-colors hover:text-[var(--ink)]"
                  >
                    <Coins size={13} weight="fill" className="text-[var(--red)]" />
                    <span className="mono">{(user.credits ?? 0).toLocaleString()}</span>
                  </Link>
                </div>
              );
            })()}

            {/* 搜索 */}
            <button
              onClick={openCommandK}
              className="hidden items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface2)] px-3 py-2 text-[13px] text-[var(--ink3)] transition-colors hover:border-[var(--ink4)] hover:text-[var(--ink2)] lg:flex"
              aria-label="搜索"
            >
              <MagnifyingGlass size={15} />
              <span>搜索</span>
              <kbd className="mono rounded bg-[var(--surface-inset)] px-1.5 py-0.5 text-[10px] text-[var(--ink4)]">⌘K</kbd>
            </button>
            <button onClick={openCommandK} className="grid h-[36px] w-[36px] place-items-center rounded-[10px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink2)] transition-colors hover:text-[var(--ink)] lg:hidden" title="搜索" aria-label="搜索">
              <MagnifyingGlass size={17} />
            </button>

            {user && <NotifBell />}

            {/* 主题：三态循环（跟随系统 / 浅 / 深），图标随当前态 */}
            <button
              onClick={onToggleTheme}
              className="grid h-[36px] w-[36px] place-items-center rounded-[10px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink2)] transition-colors hover:text-[var(--ink)]"
              aria-label={schemeLabel}
              title={schemeLabel}
            >
              {colorScheme === "system" ? (
                <Monitor size={17} />
              ) : colorScheme === "light" ? (
                <Sun size={17} weight="fill" />
              ) : (
                <Moon size={17} />
              )}
            </button>

            {/* 头像下拉 / 登录 */}
            {user ? (
              <div ref={menuRef} className="relative">
                <button
                  onClick={() => setMenuOpen((o) => !o)}
                  className="grid h-[36px] w-[36px] place-items-center rounded-full text-[13px] font-semibold text-white"
                  style={{ background: "linear-gradient(135deg, var(--red), #ff5462)" }}
                  title={`账户菜单（${user.nickname}）`} aria-label={`账户菜单（${user.nickname}）`}
                >
                  {user.nickname.slice(0, 1)}
                </button>
                {menuOpen && (
                  <div className="studio-rise absolute right-0 top-[calc(100%+8px)] w-[232px] overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--lift)]">
                    {/* 头部：昵称 + 会员状态 + 积分 */}
                    <div className="border-b border-[var(--border)] p-3.5">
                      <p className="text-[14px] font-bold text-[var(--ink)]">{user.nickname}</p>
                      <p className="mono mt-0.5 text-[11px] text-[var(--ink4)]">{user.studentId}</p>
                      {(() => {
                        const pill = subPillView(user);
                        return (
                          <Link
                            href="/pricing"
                            className={`mt-2.5 flex items-center justify-between rounded-[10px] border px-3 py-2 transition-colors ${pill.cls}`}
                          >
                            <span className="flex items-center gap-1.5 text-[12px] font-medium">
                              <Crown size={14} weight={pill.fill ? "fill" : "regular"} /> {pill.short}
                            </span>
                            <span className="text-[11px] opacity-80">
                              {user.isSubscriber && user.validUntil ? `到期 ${user.validUntil.slice(0, 10)}` : "查看方案"}
                            </span>
                          </Link>
                        );
                      })()}
                      <Link href="/me" className="mt-2 flex items-center justify-between rounded-[10px] bg-[var(--surface2)] px-3 py-2 transition-colors hover:bg-[var(--surface-inset)]">
                        <span className="flex items-center gap-1.5 text-[12px] text-[var(--ink2)]"><Coins size={14} weight="fill" className="text-[var(--red)]" /> 积分</span>
                        <span className="mono text-[13px] font-bold text-[var(--ink)]">{(user.credits ?? 0).toLocaleString()}</span>
                      </Link>
                    </div>
                    <div className="p-1.5">
                      <MenuItem href="/me" Icon={Medal} label="成长档案" />
                      <MenuItem href="/me/history" Icon={ClockCounterClockwise} label="学习记录" />
                      <MenuItem href="/me/courses" Icon={CardsThree} label="我的课" />
                      <MenuItem href="/pricing" Icon={Crown} label="订阅方案" />
                      <MenuItem href="/me/settings" Icon={Gear} label="设置" />
                      {ADMIN_ROLES.includes(user.role) && <MenuItem href="/admin" Icon={SquaresFour} label="管理后台" />}
                    </div>
                    <div className="border-t border-[var(--border)] p-1.5">
                      <button
                        type="button"
                        onClick={logout}
                        disabled={logoutPending}
                        className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-[13px] font-medium text-[var(--ink3)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--red)] disabled:cursor-wait disabled:opacity-60"
                      >
                        <SignOut size={16} /> {logoutPending ? "退出中..." : "退出登录"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <Link href="/login" className="rounded-[10px] bg-[var(--ink)] px-4 py-2 text-[13px] font-semibold text-[var(--surface)] transition-opacity hover:opacity-90">
                登录
              </Link>
            )}

            {/* 移动端汉堡 */}
            <button
              ref={hamburgerRef}
              onClick={() => setDrawerOpen(true)}
              title="菜单" aria-label="菜单"
              aria-haspopup="dialog"
              aria-expanded={drawerOpen}
              className="relative grid h-[36px] w-[36px] place-items-center rounded-[10px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink2)] after:absolute after:left-1/2 after:top-1/2 after:h-[44px] after:w-[44px] after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] md:hidden"
            >
              <List size={18} />
            </button>
          </div>
          </div>

          {/* 生产中指示：单独放到第二行（头像下方右对齐），避免挤占顶栏一行导致导航文字堆叠换行。
              无生成中课时 GenNavIndicator 返回 null，此容器为空、不占高度。 */}
          {loggedIn && (
            <div className="flex justify-end">
              <GenNavIndicator />
            </div>
          )}
        </div>
      </header>

      {/* 移动端抽屉（无障碍模态：role=dialog + aria-modal，Esc/trap/锁滚/还焦在上方 effect） */}
      {drawerOpen && (
        <div className="fixed inset-0 md:hidden" style={{ zIndex: "var(--z-drawer)" }}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="导航"
            className="studio-slide absolute right-0 top-0 h-full w-[260px] border-l border-[var(--border)] bg-[var(--bg2)] p-4"
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[14px] font-bold text-[var(--ink)]">导航</span>
              <button
                onClick={() => setDrawerOpen(false)}
                title="关闭" aria-label="关闭"
                className="relative grid h-8 w-8 place-items-center rounded-[10px] text-[var(--ink3)] after:absolute after:left-1/2 after:top-1/2 after:h-[44px] after:w-[44px] after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']"
              >
                <X size={18} />
              </button>
            </div>
            <nav className="flex flex-col gap-1">
              {links.map((l) => (
                <Link key={l.href} href={l.href} className={`flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-[14px] font-semibold ${isActive(l.href) ? "bg-[var(--surface)] text-[var(--ink)] shadow-[var(--card)]" : "text-[var(--ink3)] hover:bg-[var(--surface2)]"}`}>
                  <l.Icon size={18} weight={isActive(l.href) ? "fill" : "regular"} /> {l.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      )}
    </>
  );
}

function MenuItem({ href, Icon, label }: { href: string; Icon: typeof House; label: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-[13px] font-medium text-[var(--ink2)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--ink)]">
      <Icon size={16} weight="fill" className="text-[var(--ink3)]" /> {label}
    </Link>
  );
}
