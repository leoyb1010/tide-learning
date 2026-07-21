import { Suspense } from "react";
import { redirect } from "next/navigation";
import dynamic from "next/dynamic";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { freeCourseGenRemaining } from "@/lib/ai-guard";
import { prisma } from "@/lib/db";
import type { GeneratingCourse, DraftCheckpoint, ManualCourseState } from "@/components/CreateStudio";

export const metadata = { title: "课程创作" };

// 造课剧场按需懒加载：CreateStudio 体量大（造课全流程），拆出独立 chunk
// 减小 /create 首包。宿主是 Server Component，next/dynamic 不能用 ssr:false，
// 故保留 SSR（组件本身无浏览器专用 API，SSR 安全），等待期给出骨架屏占位。
const CreateStudio = dynamic(
  () => import("@/components/CreateStudio").then((m) => m.CreateStudio),
  { loading: () => <CreateStudioSkeleton /> },
);

/** CreateStudio 懒加载占位：仿造课工作台布局，reduce-motion 下骨架自动静止。 */
function CreateStudioSkeleton() {
  return (
    <div className="rounded-[20px] border border-[var(--border)] bg-[var(--surface)] p-7 shadow-[var(--card)]">
      <div className="flex flex-col items-center">
        <div className="skeleton h-3 w-32" />
        <div className="skeleton mt-3 h-8 w-72 max-w-full" />
        <div className="skeleton mt-3 h-4 w-96 max-w-full" />
      </div>
      <div className="skeleton mt-8 h-40 w-full rounded-[14px]" />
      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="flex gap-2">
          <div className="skeleton h-9 w-24 rounded-[10px]" />
          <div className="skeleton h-9 w-24 rounded-[10px]" />
        </div>
        <div className="skeleton h-11 w-36 rounded-[12px]" />
      </div>
    </div>
  );
}

/**
 * /create —— AI 造课页（页面壳，server）。
 * 服务端取当前用户 + 权益快照，仅把布尔 canUseLLM 透给客户端交互组件；
 * 真正的权益闸门在各 AI route 内二次校验（越权/权益判断只信服务端）。
 * 未登录先引导登录（AI 功能必须登录）。
 */
export default async function CreatePage({ searchParams }: { searchParams: Promise<{ manual?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/create");
  const requestedManualId = (await searchParams).manual?.trim();

  const snapshot = await resolveEntitlement(user.id);

  // 蓝图 D5：免费用户每月 N 次体验造课——展示态与闸门共用 freeCourseGenRemaining 唯一口径
  // （审计修复：不再各自复制月界统计与开关判断），真正的闸门仍在 route 内二次校验。
  let canCreate = snapshot.canUseLLM;
  if (!canCreate) {
    const remaining = await freeCourseGenRemaining(user.id);
    canCreate = remaining !== null && remaining > 0;
  }

  // —— 剧场恢复预取：服务端直接把「我正在生成中的课」透给客户端 ——
  // 服务端 after() 关页面也继续跑，回到 /create 时用它渲染「生产中横幅」，
  // 无需前端再单查列表；genStatus=generating 为准，按 createdAt desc 取最近若干。
  const genRows = await prisma.course.findMany({
    where: { authorUserId: user.id, genStatus: "generating", origin: { in: ["ai_generated", "user_imported"] } },
    orderBy: { createdAt: "desc" },
    take: 4,
    select: {
      id: true,
      slug: true,
      title: true,
      origin: true,
      lessons: { orderBy: { sortOrder: "asc" }, select: { id: true, blocksJson: true } },
    },
  });
  const generatingCourses: GeneratingCourse[] = genRows.map((c) => ({
    id: c.id,
    slug: c.slug,
    title: c.title,
    isImport: c.origin === "user_imported",
    total: c.lessons.length,
    done: c.lessons.filter((l) => l.blocksJson != null).length,
    firstLessonId: c.lessons[0]?.id ?? null,
  }));

  // —— L2 大纲检查点恢复：把「最近一份未确认的大纲草稿」透给客户端 ——
  // 专业模式造课停在 outline_draft，用户若离开/刷新，回到 /create 用它把检查点重新打开
  // （否则草稿会成为无客户端可达的死角，/outline* 系列接口没有入口）。
  const draftRow = await prisma.course.findFirst({
    where: { authorUserId: user.id, genStatus: "outline_draft", origin: { in: ["ai_generated", "user_imported"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, slug: true, title: true, origin: true, lessons: { orderBy: { sortOrder: "asc" }, select: { id: true, title: true } } },
  });
  const draftCheckpoint: DraftCheckpoint | null = draftRow
    ? { courseId: draftRow.id, slug: draftRow.slug, title: draftRow.title, isImport: draftRow.origin === "user_imported", lessons: draftRow.lessons.map((l) => ({ id: l.id, title: l.title })) }
    : null;

  // 手工课程恢复：只能读取当前用户自己的 user_created 课程，刷新/离开后仍能继续导演。
  const manualRow = requestedManualId
    ? await prisma.course.findFirst({
        where: { id: requestedManualId, authorUserId: user.id, origin: "user_created" },
        select: { id: true, slug: true, title: true, lessons: { orderBy: { sortOrder: "asc" }, select: { id: true, title: true } } },
      })
    : null;
  const initialManualCourse: ManualCourseState | null = manualRow
    ? { id: manualRow.id, slug: manualRow.slug, title: manualRow.title, lessons: manualRow.lessons }
    : null;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-160px)] w-full max-w-[1040px] flex-col justify-center py-8 sm:py-12">
      {/* CreateStudio 用 useSearchParams 读 ?prompt，Next15 需 Suspense 边界 */}
      <Suspense fallback={null}>
        <CreateStudio canUseLLM={canCreate} generatingCourses={generatingCourses} draftCheckpoint={draftCheckpoint} initialManualCourse={initialManualCourse} />
      </Suspense>
    </div>
  );
}
