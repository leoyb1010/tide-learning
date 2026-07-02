import Link from "next/link";
import { ElderModeToggle } from "@/components/ElderModeToggle";

export const metadata = { title: "设置" };

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 py-4">
      <Link href="/me" className="text-sm text-tide-700 hover:underline">← 我的</Link>
      <h1 className="text-2xl font-semibold text-ink-950">设置</h1>

      {/* 长辈模式与字号（§13.6） */}
      <ElderModeToggle />

      <section className="rounded-2xl border border-ink-100 bg-paper-raised p-5">
        <h2 className="mb-3 font-medium text-ink-950">通知</h2>
        <label className="flex items-center justify-between py-2 text-sm text-ink-800">
          课程上新提醒
          <input type="checkbox" defaultChecked className="h-4 w-4 accent-tide-600" />
        </label>
        <label className="flex items-center justify-between py-2 text-sm text-ink-800">
          我投票的需求上线通知
          <input type="checkbox" defaultChecked className="h-4 w-4 accent-tide-600" />
        </label>
      </section>

      <p className="text-center text-xs text-ink-400">
        长辈模式完整体验、家庭协助、语音输入将于后续版本上线
      </p>
    </div>
  );
}
