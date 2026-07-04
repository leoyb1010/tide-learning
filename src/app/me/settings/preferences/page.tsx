import { redirect } from "next/navigation";
import { SlidersHorizontal } from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/session";
import { ElderModeToggle } from "@/components/ElderModeToggle";
import { NotificationToggles } from "@/components/SettingsSections";
import { SectionCard } from "@/components/settings/SettingsShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "偏好" };

export default async function PreferencesSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/me/settings/preferences");

  return (
    <div className="stagger space-y-6">
      <SectionCard
        index={0}
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
    </div>
  );
}
