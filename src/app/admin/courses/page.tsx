import { AdminCourseManager } from "@/components/admin/AdminCourseManager";

export default function AdminCoursesPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-ink-950">课程管理</h1>
      <AdminCourseManager />
    </div>
  );
}
