/** 顶栏（TopNav）所需的用户数据（layout 服务端组装）。 */
export interface NavUser {
  nickname: string;
  role: string;
  studentId: string; // 学号（userId 短哈希）
  credits?: number; // v2.3 积分余额
  // v2.3 §5 全局续学：最近在学的一节（供 TopNav 续学胶囊主入口）。无进度则为 null。
  resumeInfo?: { courseSlug: string; courseTitle: string; lessonId: string; lessonTitle: string; pct: number } | null;
  // v3.0：续学胶囊展开的最近学习课程（最多 5 门，按最近学习倒序）。空数组表示无历史。
  recentCourses?: {
    courseSlug: string;
    courseTitle: string;
    lessonId: string; // 该课程最近在学的章节（点击直达续学）
    coursePct: number; // 课程总进度（已完成章节 / 课程总章节）
  }[];
}
