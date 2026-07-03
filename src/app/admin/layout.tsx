import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { AdminNav } from "@/components/admin/AdminNav";

export const metadata = { title: "运营后台" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const adminRoles = ["admin", "content_manager", "demand_moderator", "support", "finance", "reviewer"];
  if (!user) redirect("/login?next=/admin");
  if (!adminRoles.includes(user.role)) {
    return (
      <div className="py-24 text-center">
        <h1 className="text-xl font-semibold text-[var(--ink)]">无权访问</h1>
        <p className="mt-2 text-[var(--ink3)]">该页面仅限后台角色访问</p>
        <Link href="/" className="mt-4 inline-block text-[var(--red)] hover:underline">返回首页</Link>
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-[200px_1fr]">
      <AdminNav role={user.role} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
