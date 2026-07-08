import { prisma } from "@/lib/db";
import { ModerationConsole, type ModPost, type ModCourse } from "@/components/admin/ModerationConsole";
import { requireAdminPage } from "@/lib/admin-guard";

export const metadata = { title: "内容审核台" };

// 内容审核台：帖子 + 课程集市待审。入口权限 content:review（健康/财务/防诈骗内容审核）。
// 帖子与课程集市审批的写操作（moderation/post、moderation/course）均以 content:review 校验，
// 与本页 gate 一致，使同一 reviewer 角色能完整处理审核闭环（审计 P1-new-1 修复）。
export default async function AdminModerationPage() {
  // 页面级权限门（P0-1）：无权者干净重定向到可访问页（原 requirePermission 抛错会渲染成 500 错误页）。
  await requireAdminPage("content:review", "/admin/moderation");

  const [posts, courses] = await Promise.all([
    prisma.post.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: {
        id: true,
        type: true,
        content: true,
        images: true,
        topicTags: true,
        createdAt: true,
        user: { select: { id: true, nickname: true } },
      },
    }),
    prisma.course.findMany({
      where: { sharedStatus: "pending" },
      orderBy: { lastUpdatedAt: "asc" },
      take: 100,
      select: {
        id: true,
        title: true,
        subtitle: true,
        category: true,
        level: true,
        authorUserId: true,
        lastUpdatedAt: true,
        _count: { select: { lessons: true } },
      },
    }),
  ]);

  const modPosts: ModPost[] = posts.map((p) => ({
    id: p.id,
    type: p.type,
    content: p.content,
    imageCount: safeLen(p.images),
    tags: safeTags(p.topicTags),
    authorName: p.user.nickname,
    createdAt: p.createdAt.toISOString(),
  }));

  const modCourses: ModCourse[] = courses.map((c) => ({
    id: c.id,
    title: c.title,
    subtitle: c.subtitle,
    category: c.category,
    level: c.level,
    lessonCount: c._count.lessons,
    updatedAt: c.lastUpdatedAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-[22px] font-bold text-[var(--ink)]">内容审核台</h1>
        <p className="text-[13px] text-[var(--ink3)]">
          处理 LLM 拿不准的待审帖子与课程集市分享申请。拒绝需选择或填写理由。
        </p>
      </header>
      <ModerationConsole posts={modPosts} courses={modCourses} />
    </div>
  );
}

function safeLen(raw: string): number {
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

function safeTags(raw: string): string[] {
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}
