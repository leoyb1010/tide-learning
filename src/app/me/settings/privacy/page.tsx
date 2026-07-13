import { redirect } from "next/navigation";
import { Lock, CaretRight, DownloadSimple } from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/session";
import { DeleteAccountButton } from "@/components/SettingsSections";
import { SectionCard } from "@/components/settings/SettingsShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "隐私与数据" };

export default async function PrivacySettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/me/settings/privacy");

  return (
    <div className="stagger space-y-6">
      <SectionCard
        index={0}
        icon={<Lock size={18} weight="fill" />}
        title="隐私与数据"
        desc="导出与账号注销"
      >
        {/* API 下载需要浏览器文件响应，不能由 Next Link 客户端导航接管。 */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/api/notes/export?format=md"
          className="studio-lift flex items-center justify-between rounded-[12px] border border-[var(--border)] bg-[var(--surface2)] px-4 py-3.5"
        >
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-[var(--red-soft)] text-[var(--red)]">
              <DownloadSimple size={16} weight="bold" />
            </span>
            <div>
              <p className="text-[14px] font-semibold text-[var(--ink)]">导出我的笔记</p>
              <p className="text-[12px] text-[var(--ink3)]">打包为 Markdown 下载，随时备份</p>
            </div>
          </div>
          <CaretRight size={15} weight="bold" className="text-[var(--ink4)]" />
        </a>

        {/* 危险操作：注销账号（全站唯一红色危险区） */}
        <div className="mt-4 border-t border-[var(--border)] pt-4">
          <p className="mb-1 text-[14px] font-bold text-[var(--ink)]">注销账号</p>
          <p className="mb-3 text-[12px] text-[var(--ink3)]">
            注销后数据不可恢复，请谨慎操作。
          </p>
          <DeleteAccountButton requiresPassword={user.authProvider === "password" && !!user.passwordHash} />
        </div>
      </SectionCard>
    </div>
  );
}
