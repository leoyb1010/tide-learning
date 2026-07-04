import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck, Lock } from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/session";
import { ChangePasswordForm } from "@/components/SettingsSections";
import { SectionCard, InfoRow } from "@/components/settings/SettingsShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "账号安全" };

/** 邮箱脱敏：a***@domain。 */
function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!domain) return "***";
  const head = name.slice(0, 1);
  return `${head}${"*".repeat(Math.max(name.length - 1, 2))}@${domain}`;
}

/** 手机脱敏：138****8888。 */
function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return "*".repeat(digits.length);
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
}

export default async function AccountSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/me/settings/account");

  const isThirdParty = user.authProvider !== "password";

  return (
    <div className="stagger space-y-6">
      <SectionCard
        index={0}
        tone="info"
        icon={<ShieldCheck size={18} weight="fill" />}
        title="账号安全"
        desc="登录信息与密码"
      >
        <div className="space-y-1">
          <InfoRow
            label="昵称"
            value={user.nickname}
            action={
              <Link
                href="/me/settings/profile"
                className="text-[12px] font-semibold text-[var(--red)] transition-opacity hover:opacity-80"
              >
                去个人资料修改
              </Link>
            }
          />
          <InfoRow
            label="手机"
            value={user.phone ? maskPhone(user.phone) : "未绑定"}
          />
          <InfoRow
            label="邮箱"
            value={user.email ? maskEmail(user.email) : "未绑定"}
          />
          <InfoRow
            label="登录方式"
            value={isThirdParty ? "微信登录" : "账号密码"}
          />
        </div>

        {/* 修改密码：第三方登录用户隐藏 */}
        {isThirdParty ? (
          <div className="mt-4 rounded-[12px] border border-[var(--border)] bg-[var(--surface2)] p-4 text-[12px] text-[var(--ink3)]">
            你使用第三方账号登录，无需在此设置密码。
          </div>
        ) : (
          <div className="mt-5 border-t border-[var(--border)] pt-5">
            <div className="mb-3 flex items-center gap-2">
              <Lock size={14} weight="fill" className="text-[var(--ink3)]" />
              <p className="text-[14px] font-bold text-[var(--ink)]">修改密码</p>
            </div>
            <ChangePasswordForm />
          </div>
        )}
      </SectionCard>
    </div>
  );
}
