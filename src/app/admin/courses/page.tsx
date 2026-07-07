import { AdminCourseManager } from "@/components/admin/AdminCourseManager";
import { requireAdminPage } from "@/lib/admin-guard";

export default async function AdminCoursesPage() {
  // 页面级权限门（P0-1）：与课程管理 API 的 requirePermission("course:write") 对齐。
  await requireAdminPage("course:write", "/admin/courses");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-ink-950">课程管理</h1>
      <AdminCourseManager />
    </div>
  );
}
