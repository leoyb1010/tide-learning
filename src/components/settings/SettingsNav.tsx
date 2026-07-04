"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Icon } from "@phosphor-icons/react";
import {
  IdentificationCard,
  ShieldCheck,
  CreditCard,
  SlidersHorizontal,
  Lock,
  Question,
} from "@phosphor-icons/react/dist/ssr";

/* ============================================================
 * 设置中心 · 真路由导航（客户端，usePathname 高亮）
 * 桌面：左窄栏纵向 nav（sticky）；移动：顶部横向 scroll tab。
 * 触达 ≥44px，active/hover 态精致，URL 可直达可回退。
 * ============================================================ */

const ITEMS: { href: string; label: string; icon: Icon }[] = [
  { href: "/me/settings/profile", label: "个人资料", icon: IdentificationCard },
  { href: "/me/settings/account", label: "账号安全", icon: ShieldCheck },
  { href: "/me/settings/subscription", label: "订阅与积分", icon: CreditCard },
  { href: "/me/settings/preferences", label: "偏好", icon: SlidersHorizontal },
  { href: "/me/settings/privacy", label: "隐私与数据", icon: Lock },
  { href: "/me/settings/help", label: "帮助", icon: Question },
];

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="设置导航"
      className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0"
    >
      {ITEMS.map((it) => {
        const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
        const Ico = it.icon;
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={`group flex min-h-[44px] shrink-0 items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px] font-medium transition-colors ${
              active
                ? "bg-[var(--surface-inset)] text-[var(--ink)]"
                : "text-[var(--ink3)] hover:bg-[var(--surface2)] hover:text-[var(--ink2)]"
            }`}
          >
            <Ico
              size={16}
              weight={active ? "fill" : "regular"}
              className={`shrink-0 transition-colors ${
                active ? "text-[var(--red)]" : "text-[var(--ink4)] group-hover:text-[var(--ink3)]"
              }`}
            />
            <span className="whitespace-nowrap">{it.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
