import { prisma } from "@/lib/db";
import { requireAdminPage } from "@/lib/admin-guard";
import { AdminContentCalendar } from "@/components/admin/AdminContentCalendar";

export const metadata = { title: "内容排期" };

// §8.2.2 内容排期
export default async function ContentCalendarPage() {
  // 页面级权限门（P0-1）：与内容排期 API 的 requirePermission("course:write") 对齐。
  await requireAdminPage("course:write", "/admin/content-calendar");

  const [items, courses] = await Promise.all([
    prisma.contentCalendar.findMany({ orderBy: { plannedPublishDate: "asc" }, include: { course: { select: { title: true } } } }),
    prisma.course.findMany({ orderBy: { title: "asc" }, select: { id: true, title: true } }),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-ink-950">内容排期</h1>
      <p className="text-sm text-ink-400">固定上新日 + 延期说明，保证滚动更新对用户可见。选题双输入：共创投票 + 投流数据。</p>
      <AdminContentCalendar initialItems={items.map((x) => ({ ...x, plannedPublishDate: x.plannedPublishDate.toISOString() }))} courses={courses} />
    </div>
  );
}
