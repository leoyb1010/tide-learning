"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GearSix } from "@phosphor-icons/react/dist/ssr";

/**
 * 后台侧栏导航。展示项由服务端 layout 按用户有效权限过滤后传入（P2-1）——
 * 本组件不再自行硬编码全量入口，避免向低权限角色暴露越权页面链接。
 */
type NavItem = { href: string; label: string };

export function AdminNav({ role, items }: { role: string; items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <aside className="md:sticky md:top-24 md:h-fit">
      <div className="mb-4 flex items-center gap-2 px-2">
        <GearSix size={18} weight="fill" className="text-[var(--red)]" />
        <div>
          <p className="text-sm font-semibold text-[var(--ink)]">运营后台</p>
          <p className="mono text-xs text-[var(--ink4)]">{role}</p>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
        {items.map((it) => {
          const active = it.href === "/admin" ? pathname === "/admin" : pathname.startsWith(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`shrink-0 rounded-[10px] px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-[var(--ink)] font-medium text-[var(--surface)]"
                  : "text-[var(--ink3)] hover:bg-[var(--surface2)] hover:text-[var(--ink)]"
              }`}
            >
              {it.label}
            </Link>
          );
        })}
        <Link
          href="/"
          className="shrink-0 rounded-[10px] px-3 py-2 text-sm text-[var(--ink4)] transition-colors hover:text-[var(--ink)]"
        >
          ← 返回前台
        </Link>
      </nav>
    </aside>
  );
}
