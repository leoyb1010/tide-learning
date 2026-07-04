import { redirect } from "next/navigation";
import { CreditCard } from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement, STATUS_LABELS } from "@/lib/entitlement";
import { SectionCard, LinkRow } from "@/components/settings/SettingsShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "订阅与积分" };

export default async function SubscriptionSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/me/settings/subscription");

  const snapshot = await resolveEntitlement(user.id);
  const meta = STATUS_LABELS[snapshot.subscriptionStatus] ?? STATUS_LABELS.free;

  return (
    <div className="stagger space-y-6">
      <SectionCard
        index={0}
        tone="red"
        icon={<CreditCard size={18} weight="fill" />}
        title="订阅与积分"
        desc="会员状态与学习积分"
      >
        <div className="space-y-2.5">
          <LinkRow
            href="/me/subscription"
            label="订阅管理"
            hint={meta.label}
            hintTone={meta.tone}
          />
          <LinkRow href="/me" label="积分与学习明细" hint="查看成长档案" />
        </div>
      </SectionCard>
    </div>
  );
}
