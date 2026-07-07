import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/session";
import { SettingsNav } from "@/components/settings/SettingsNav";

export const dynamic = "force-dynamic";
export const metadata = { title: "设置" };

/**
 * 设置中心共享 layout —— 六个真路由子页共用。
 * 桌面：左窄栏 nav（sticky）+ 右内容区；移动：顶部横向 scroll tab + 下方内容。
 * 鉴权在此统一：未登录跳登录（各子页无需重复）。
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/me/settings");

  return (
    <div className="mx-auto max-w-[1120px] py-4">
      {/* 顶部返回 + 标题 */}
      <Link
        href="/me"
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--ink3)] transition-colors hover:text-[var(--ink)]"
      >
        <ArrowLeft size={14} weight="bold" /> 成长档案
      </Link>
      <div className="mono mt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink4)]">SETTINGS · 设置中心</div>
      <h1 className="mt-1 text-[24px] font-bold text-[var(--ink)]">设置中心</h1>
      <p className="mt-1 text-[13px] text-[var(--ink3)]">
        管理你的账号、订阅、偏好与数据
      </p>

      <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-start md:gap-8">
        {/* 左窄栏导航：桌面 sticky 纵向；移动横向 scroll tab（在 SettingsNav 内切换布局） */}
        <aside className="shrink-0 md:w-48">
          <div className="md:sticky md:top-[84px]">
            <SettingsNav />
          </div>
        </aside>

        {/* 右内容区：各子路由 page.tsx 渲染于此 */}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
