/** 顶栏（TopNav）所需的用户数据（layout 服务端组装）。 */
export interface NavUser {
  nickname: string;
  role: string;
  studentId: string; // 学号（userId 短哈希）
  credits?: number; // v2.3 积分余额
  // v2.3 §5 全局续学：最近在学的一节（供 TopNav 续学胶囊）。无进度则为 null。
  resumeInfo?: { courseSlug: string; courseTitle: string; lessonId: string; lessonTitle: string; pct: number } | null;
}
