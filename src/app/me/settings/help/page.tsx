import { redirect } from "next/navigation";
import { Question } from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/session";
import { SectionCard, LinkRow } from "@/components/settings/SettingsShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "帮助" };

export default async function HelpSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/me/settings/help");

  return (
    <div className="stagger space-y-6">
      <SectionCard
        index={0}
        icon={<Question size={18} weight="fill" />}
        title="帮助"
        desc="客服、关于与条款"
      >
        <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface2)] p-4 text-[13px] text-[var(--ink2)]">
          <p className="font-bold text-[var(--ink)]">客服与反馈</p>
          <p className="mt-1">
            遇到问题？发送邮件到 support@youdao.com，或在需求广场留言。
          </p>
        </div>
        <div className="mt-3 space-y-2.5">
          <LinkRow href="/demands" label="意见反馈" hint="去需求广场" />
          <LinkRow href="/terms" label="用户协议" />
          <LinkRow href="/privacy" label="隐私政策" />
        </div>
      </SectionCard>

      <p className="pt-1 text-center text-[11px] text-[var(--ink4)]">
        长辈模式完整体验、家庭协助、语音输入将于后续版本上线
      </p>
    </div>
  );
}
