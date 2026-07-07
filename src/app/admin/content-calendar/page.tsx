import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui";
import { requireAdminPage } from "@/lib/admin-guard";

export const metadata = { title: "内容排期" };

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  planned: { label: "已计划", tone: "muted" },
  recording: { label: "录制中", tone: "tide" },
  editing: { label: "剪辑中", tone: "tide" },
  review: { label: "审核中", tone: "warning" },
  scheduled: { label: "已排期", tone: "dawn" },
  published: { label: "已发布", tone: "success" },
  delayed: { label: "延期", tone: "error" },
};

// §8.2.2 内容排期
export default async function ContentCalendarPage() {
  // 页面级权限门（P0-1）：与内容排期 API 的 requirePermission("course:write") 对齐。
  await requireAdminPage("course:write", "/admin/content-calendar");

  const items = await prisma.contentCalendar.findMany({
    orderBy: { plannedPublishDate: "asc" },
    include: { course: { select: { title: true } } },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-ink-950">内容排期</h1>
      <p className="text-sm text-ink-400">固定上新日 + 延期说明，保证滚动更新对用户可见。选题双输入：共创投票 + 投流数据。</p>
      <div className="overflow-x-auto rounded-2xl border border-ink-100 bg-paper-raised">
        <table className="w-full text-sm">
          <thead className="border-b border-ink-100 text-left text-ink-400">
            <tr><th className="px-4 py-3">计划发布</th><th className="px-4 py-3">课程</th><th className="px-4 py-3">内容</th><th className="px-4 py-3">负责人</th><th className="px-4 py-3">风险</th><th className="px-4 py-3">状态</th></tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {items.map((it) => {
              const s = STATUS_LABEL[it.status] ?? { label: it.status, tone: "muted" };
              return (
                <tr key={it.id}>
                  <td className="px-4 py-3 tabular text-ink-950">{new Date(it.plannedPublishDate).toLocaleDateString("zh-CN")}</td>
                  <td className="px-4 py-3">{it.course.title}</td>
                  <td className="px-4 py-3 text-ink-500">
                    {it.title}
                    {it.demandId && <span className="ml-2"><Badge tone="tide">共创选题</Badge></span>}
                  </td>
                  <td className="px-4 py-3 text-ink-500">{it.owner ?? "—"}</td>
                  <td className="px-4 py-3"><Badge tone={it.riskLevel === "high" ? "error" : it.riskLevel === "medium" ? "warning" : "muted"}>{it.riskLevel}</Badge></td>
                  <td className="px-4 py-3"><Badge tone={s.tone}>{s.label}</Badge></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
