import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  ShieldCheck,
  CreditCard,
  SlidersHorizontal,
  Lock,
  Question,
  CaretRight,
  DownloadSimple,
} from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement, STATUS_LABELS } from "@/lib/entitlement";
import { ElderModeToggle } from "@/components/ElderModeToggle";
import {
  SettingsNav,
  ChangePasswordForm,
  NotificationToggles,
  DeleteAccountButton,
} from "@/components/SettingsSections";

export const dynamic = "force-dynamic";
export const metadata = { title: "设置" };

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

const NAV_ITEMS = [
  { id: "security", label: "账号安全" },
  { id: "subscription", label: "订阅与积分" },
  { id: "preferences", label: "偏好" },
  { id: "privacy", label: "隐私与数据" },
  { id: "help", label: "帮助" },
];

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/me/settings");

  const snapshot = await resolveEntitlement(user.id);
  const meta =
    STATUS_LABELS[snapshot.subscriptionStatus] ?? STATUS_LABELS.free;
  const isThirdParty = user.authProvider !== "password";

  return (
    <div className="mx-auto max-w-[1040px] py-4">
      {/* 顶部返回 */}
      <Link
        href="/me"
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--ink3)] transition-colors hover:text-[var(--ink)]"
      >
        <ArrowLeft size={14} weight="bold" /> 成长档案
      </Link>
      <h1 className="mt-3 text-[24px] font-bold text-[var(--ink)]">设置中心</h1>
      <p className="mt-1 text-[13px] text-[var(--ink3)]">
        管理你的账号、订阅、偏好与数据
      </p>

      <div className="mt-6 flex flex-col gap-6 md:flex-row md:items-start md:gap-8">
        {/* 左窄栏锚点导航（桌面 sticky；移动端隐藏，改用分组列表滚动） */}
        <aside className="hidden w-44 shrink-0 md:block">
          <div className="sticky top-6">
            <SettingsNav items={NAV_ITEMS} />
          </div>
        </aside>

        {/* 右分区卡 */}
        <div className="min-w-0 flex-1 space-y-6">
          {/* 1. 账号安全 */}
          <SectionCard
            id="security"
            icon={<ShieldCheck size={18} weight="fill" />}
            title="账号安全"
            desc="登录信息与密码"
          >
            <div className="space-y-1">
              <InfoRow
                label="昵称"
                value={user.nickname}
                action={
                  <span className="text-[12px] text-[var(--ink4)]">
                    改名功能即将上线
                  </span>
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

          {/* 2. 订阅与积分 */}
          <SectionCard
            id="subscription"
            icon={<CreditCard size={18} weight="fill" />}
            title="订阅与积分"
            desc="会员状态与学习积分"
          >
            <LinkRow
              href="/me/subscription"
              label="订阅管理"
              hint={meta.label}
            />
            <LinkRow
              href="/me"
              label="积分与学习明细"
              hint="查看成长档案"
            />
          </SectionCard>

          {/* 3. 偏好 */}
          <SectionCard
            id="preferences"
            icon={<SlidersHorizontal size={18} weight="fill" />}
            title="偏好"
            desc="阅读与通知"
          >
            {/* 长辈模式 / 字号（复用 ElderModeToggle，已迁 STUDIO token） */}
            <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface2)] p-4">
              <ElderModeToggle />
            </div>
            {/* 通知开关 */}
            <div className="mt-4 border-t border-[var(--border)] pt-4">
              <p className="mb-1 text-[14px] font-bold text-[var(--ink)]">通知</p>
              <NotificationToggles />
            </div>
          </SectionCard>

          {/* 4. 隐私与数据 */}
          <SectionCard
            id="privacy"
            icon={<Lock size={18} weight="fill" />}
            title="隐私与数据"
            desc="导出与账号注销"
          >
            <a
              href="/api/notes/export?format=md"
              className="studio-lift flex items-center justify-between rounded-[12px] border border-[var(--border)] bg-[var(--surface2)] px-4 py-3.5"
            >
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-[var(--red-soft)] text-[var(--red)]">
                  <DownloadSimple size={16} weight="bold" />
                </span>
                <div>
                  <p className="text-[14px] font-semibold text-[var(--ink)]">
                    导出我的笔记
                  </p>
                  <p className="text-[12px] text-[var(--ink3)]">
                    打包为 Markdown 下载，随时备份
                  </p>
                </div>
              </div>
              <CaretRight size={15} weight="bold" className="text-[var(--ink4)]" />
            </a>

            <div className="mt-4 border-t border-[var(--border)] pt-4">
              <p className="mb-1 text-[14px] font-bold text-[var(--ink)]">注销账号</p>
              <p className="mb-3 text-[12px] text-[var(--ink3)]">
                注销后数据不可恢复，请谨慎操作。
              </p>
              <DeleteAccountButton />
            </div>
          </SectionCard>

          {/* 5. 帮助 */}
          <SectionCard
            id="help"
            icon={<Question size={18} weight="fill" />}
            title="帮助"
            desc="客服、关于与条款"
          >
            <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface2)] p-4 text-[13px] text-[var(--ink2)]">
              <p className="font-bold text-[var(--ink)]">客服与反馈</p>
              <p className="mt-1">
                遇到问题？发送邮件到 support@tide.learning，或在需求广场留言。
              </p>
            </div>
            <div className="mt-3 space-y-1">
              <LinkRow href="/demands" label="意见反馈" hint="去需求广场" />
              <LinkRow href="/terms" label="用户协议" />
              <LinkRow href="/privacy" label="隐私政策" />
            </div>
          </SectionCard>

          <p className="pt-1 text-center text-[11px] text-[var(--ink4)]">
            长辈模式完整体验、家庭协助、语音输入将于后续版本上线
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------- 服务端展示组件 ---------- */

function SectionCard({
  id,
  icon,
  title,
  desc,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="studio-rise scroll-mt-6 rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)] sm:p-6"
    >
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-[var(--surface-inset)] text-[var(--ink2)]">
          {icon}
        </span>
        <div>
          <h2 className="text-[16px] font-bold text-[var(--ink)]">{title}</h2>
          {desc && <p className="text-[12px] text-[var(--ink3)]">{desc}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function InfoRow({
  label,
  value,
  action,
}: {
  label: string;
  value: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-[13px] text-[var(--ink3)]">{label}</span>
      <span className="flex items-center gap-3">
        <span className="text-[14px] font-medium text-[var(--ink)]">{value}</span>
        {action}
      </span>
    </div>
  );
}

function LinkRow({
  href,
  label,
  hint,
}: {
  href: string;
  label: string;
  hint?: string;
}) {
  return (
    <Link
      href={href}
      className="studio-lift flex items-center justify-between rounded-[12px] border border-[var(--border)] bg-[var(--surface2)] px-4 py-3.5"
    >
      <span className="text-[14px] font-semibold text-[var(--ink)]">{label}</span>
      <span className="flex items-center gap-2 text-[13px] text-[var(--ink3)]">
        {hint}
        <CaretRight size={14} weight="bold" className="text-[var(--ink4)]" />
      </span>
    </Link>
  );
}
