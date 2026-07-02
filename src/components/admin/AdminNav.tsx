"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GearSix } from "@phosphor-icons/react/dist/ssr";

const ITEMS = [
  { href: "/admin", label: "数据看板" },
  { href: "/admin/courses", label: "课程管理" },
  { href: "/admin/content-calendar", label: "内容排期" },
  { href: "/admin/demands", label: "需求审核" },
  { href: "/admin/leads", label: "建联队列" },
  { href: "/admin/orders", label: "订单/订阅" },
  { href: "/admin/users", label: "用户管理" },
];

export function AdminNav({ role }: { role: string }) {
  const pathname = usePathname();
  return (
    <aside className="md:sticky md:top-24 md:h-fit">
      <div className="mb-4 flex items-center gap-2 px-2">
        <GearSix size={18} weight="fill" className="text-accent-600" />
        <div>
          <p className="text-sm font-semibold text-ink-950">运营后台</p>
          <p className="num text-xs text-ink-400">{role}</p>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
        {ITEMS.map((it) => {
          const active = it.href === "/admin" ? pathname === "/admin" : pathname.startsWith(it.href);
          return (
            <Link key={it.href} href={it.href} className={`shrink-0 rounded-lg px-3 py-2 text-sm ${active ? "bg-accent-600 text-white" : "text-ink-500 hover:bg-accent-50"}`}>
              {it.label}
            </Link>
          );
        })}
        <Link href="/" className="shrink-0 rounded-lg px-3 py-2 text-sm text-ink-400 hover:text-ink-950">← 返回前台</Link>
      </nav>
    </aside>
  );
}
