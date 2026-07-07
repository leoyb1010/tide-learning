import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, primePermissionCache, ALL_ROLES } from "@/lib/session";
import { adminNavForUser } from "@/lib/admin-guard";
import { AdminNav } from "@/components/admin/AdminNav";

export const metadata = { title: "运营后台" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin");
  // 布局壳只负责「是不是后台身份」；具体页面各自用 requireAdminPage 做细粒度权限校验（P0-1）。
  if (!ALL_ROLES.includes(user.role)) {
    return (
      <div className="py-24 text-center">
        <h1 className="text-xl font-semibold text-[var(--ink)]">无权访问</h1>
        <p className="mt-2 text-[var(--ink3)]">该页面仅限后台角色访问</p>
        <Link href="/" className="mt-4 inline-block text-[var(--red)] hover:underline">返回首页</Link>
      </div>
    );
  }

  // 导航按用户有效权限过滤：越权入口不展示（P2-1），与页面守卫读同一张 ADMIN_NAV 表。
  await primePermissionCache();
  const navItems = adminNavForUser(user.role);

  return (
    <div className="grid gap-6 md:grid-cols-[200px_1fr]">
      <AdminNav role={user.role} items={navItems} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
