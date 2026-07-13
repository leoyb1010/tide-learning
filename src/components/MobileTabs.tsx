"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  House, Sparkle, PaperPlaneTilt, Storefront,
  DotsThreeOutline, NotePencil, CardsThree, User, GraduationCap, X,
} from "@phosphor-icons/react/dist/ssr";

/**
 * 移动端底部 Tab（<md）—— ⑫ 拆平级后重排：社区 / 集市 都一级可达，造课居中凸起。
 *
 * 布局（5 槽）：书桌 · 社区 · 造课(raised) · 集市 · 更多。
 * 社区广场（/demands）与课程集市（/market）从旧「社区」合并里拆出，各占一个一级槽——
 * 移动端两者重要程度对齐，皆一次点击可达（满足 ⑫ 移动端要求）。
 * 造课保留居中凸起（产品心跳级创造入口）。次要目的地（课程库/笔记馆/复习室/我的）
 * 收进「更多」底部抽屉（bottom sheet）：一次点击即拉起，网格罗列，仍是浅层可达。
 *
 * 无障碍：更多抽屉 = role=dialog + aria-modal，Esc/点外部/选项关闭，body 锁滚，
 * 焦点移入并在关闭时还给触发按钮。触达 ≥44px（含 44px 命中兜底）。零 em-dash。
 * 动效走 studio 规格，reduce-motion 由 .studio-slide / scrim 类统一降级。
 */

interface Tab { href: string; label: string; Icon: typeof House; raised?: boolean }
// 「更多」抽屉里的次级目的地。
interface MoreLink { href: string; label: string; Icon: typeof House; desc: string }

function buildTabs(loggedIn: boolean): Tab[] {
  return [
    loggedIn
      ? { href: "/desk", label: "书桌", Icon: House }
      : { href: "/", label: "首页", Icon: House },
    { href: "/demands", label: "社区", Icon: PaperPlaneTilt },
    { href: "/create", label: "造课", Icon: Sparkle, raised: true },
    { href: "/market", label: "集市", Icon: Storefront },
    // 第 5 槽由「更多」按钮占据（非 Link），单独渲染。
  ];
}

function buildMoreLinks(loggedIn: boolean): MoreLink[] {
  return [
    { href: "/courses", label: "课程库", Icon: GraduationCap, desc: "官方精品课，成体系学" },
    { href: "/notes", label: "笔记馆", Icon: NotePencil, desc: "边看边记，随手成卡" },
    { href: "/review", label: "复习室", Icon: CardsThree, desc: "到点复习，记得更牢" },
    { href: loggedIn ? "/me" : "/login", label: loggedIn ? "我的" : "登录", Icon: User, desc: loggedIn ? "成长档案与设置" : "登录同步你的学习" },
  ];
}

export function MobileTabs({ loggedIn }: { loggedIn: boolean }) {
  const pathname = usePathname();
  const tabs = buildTabs(loggedIn);
  const moreLinks = buildMoreLinks(loggedIn);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);

  const isActive = (href: string) => {
    if (href === "/" || href === "/desk") return pathname === href;
    if (href === "/me") return pathname === "/me";
    return pathname.startsWith(href);
  };
  // 「更多」高亮：当前路由落在任一次级目的地时点亮更多入口。
  const moreActive = moreLinks.some((l) => isActive(l.href));

  useEffect(() => {
    setHost(document.body);
  }, []);

  // 路由变化关闭抽屉。
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  // 更多抽屉 = 无障碍模态：Esc 关闭 + Tab focus trap + body 锁滚 + 焦点移入/还原。
  useEffect(() => {
    if (!moreOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setMoreOpen(false);
      } else if (e.key === "Tab") {
        trapFocus(e, sheetRef.current);
      }
    };
    document.addEventListener("keydown", onKey);
    const returnFocus = moreBtnRef.current;
    const raf = requestAnimationFrame(() =>
      sheetRef.current?.querySelector<HTMLElement>("a[href],button")?.focus(),
    );
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
      returnFocus?.focus?.();
    };
  }, [moreOpen]);

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 grid grid-cols-5 border-t border-[var(--border)] bg-[var(--surface)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
        style={{ zIndex: "var(--z-sticky)" }}
      >
        {tabs.map((t) => {
          const active = isActive(t.href);
          if (t.raised) {
            return (
              <Link key={t.href} href={t.href} className="flex flex-col items-center gap-1 py-2.5 text-[0.68rem] text-[var(--ink4)]">
                <span className="studio-press -mt-6 grid h-[46px] w-[46px] place-items-center rounded-full bg-[var(--red)] text-white shadow-[0_6px_16px_-4px_rgba(252,1,26,0.5)]">
                  <t.Icon size={22} weight="fill" />
                </span>
                <span className={`whitespace-nowrap ${active ? "text-[var(--red)]" : ""}`}>{t.label}</span>
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
              <span className="whitespace-nowrap">{t.label}</span>
            </Link>
          );
        })}
        {/* 第 5 槽：更多（拉起次级目的地抽屉）。 */}
        <button
          ref={moreBtnRef}
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          aria-label="更多"
          className={`flex flex-col items-center gap-1 py-2.5 text-[0.68rem] transition-colors ${moreActive || moreOpen ? "text-[var(--red)]" : "text-[var(--ink4)]"}`}
        >
          <DotsThreeOutline size={21} weight={moreActive || moreOpen ? "fill" : "regular"} />
          <span className="whitespace-nowrap">更多</span>
        </button>
      </nav>

      {/* 更多底部抽屉：从底平滑推出，网格罗列次级目的地。Portal 逃逸到 body。 */}
      {host && moreOpen &&
        createPortal(
          <div className="fixed inset-0 md:hidden" style={{ zIndex: "var(--z-drawer)" }}>
            <div className="dialog-scrim-in absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setMoreOpen(false)} />
            <div
              ref={sheetRef}
              role="dialog"
              aria-modal="true"
              aria-label="更多"
              className="preview-sheet-in absolute inset-x-0 bottom-0 rounded-t-[20px] border-t border-[var(--border2)] bg-[var(--bg2)] px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-3 shadow-[var(--lift)]"
            >
              {/* 抓手 + 标题条 */}
              <div className="mb-1 flex flex-col items-center">
                <span className="mb-2.5 h-1 w-9 rounded-full bg-[var(--border2)]" aria-hidden />
              </div>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[14px] font-bold text-[var(--ink)]">更多</span>
                <button
                  type="button"
                  onClick={() => setMoreOpen(false)}
                  title="关闭" aria-label="关闭"
                  className="relative grid h-8 w-8 place-items-center rounded-[9px] text-[var(--ink3)] transition-colors hover:bg-[var(--surface2)] after:absolute after:left-1/2 after:top-1/2 after:h-[44px] after:w-[44px] after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']"
                >
                  <X size={17} weight="bold" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {moreLinks.map((l) => {
                  const active = isActive(l.href);
                  return (
                    <Link
                      key={l.href}
                      href={l.href}
                      onClick={() => setMoreOpen(false)}
                      className={`studio-press flex items-center gap-3 rounded-[14px] border p-3.5 transition-colors ${
                        active
                          ? "border-[var(--red-soft-border)] bg-[var(--red-soft)]"
                          : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border2)]"
                      }`}
                    >
                      <span
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] ${
                          active
                            ? "bg-[var(--red)] text-white"
                            : "border border-[var(--border)] bg-[var(--surface2)] text-[var(--ink2)]"
                        }`}
                      >
                        <l.Icon size={19} weight={active ? "fill" : "regular"} />
                      </span>
                      <span className="min-w-0">
                        <span className={`block text-[13.5px] font-semibold ${active ? "text-[var(--red)]" : "text-[var(--ink)]"}`}>{l.label}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-[var(--ink4)]">{l.desc}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>,
          host,
        )}
    </>
  );
}

/* focus trap（对齐 Dialog / DeskShelf.trapFocus）。 */
function trapFocus(e: KeyboardEvent, panel: HTMLElement | null) {
  if (!panel) return;
  const focusables = panel.querySelectorAll<HTMLElement>(
    'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
  );
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
