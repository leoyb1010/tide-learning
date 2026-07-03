"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GearSix } from "@phosphor-icons/react/dist/ssr";

const ITEMS = [
  { href: "/admin", label: "数据看板" },
  { href: "/admin/courses", label: "课程管理" },
  { href: "/admin/content-calendar", label: "内容排期" },
  { href: "/admin/demands", label: "需求审核" },
  { href: "/admin/moderation", label: "内容审核" },
  { href: "/admin/leads", label: "建联队列" },
  { href: "/admin/orders", label: "订单/订阅" },
  { href: "/admin/credits", label: "积分管理" },
  { href: "/admin/users", label: "用户管理" },
];

// 仅超级管理员可见的入口（权限矩阵为高危管理页）
const ADMIN_ONLY_ITEMS = [{ href: "/admin/permissions", label: "权限管理" }];

export function AdminNav({ role }: { role: string }) {
  const pathname = usePathname();
  const items = role === "admin" ? [...ITEMS, ...ADMIN_ONLY_ITEMS] : ITEMS;
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
