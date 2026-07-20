import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { HtmlCourseware } from "@/components/HtmlCourseware";
import { trackLabel } from "@/lib/tracks";

export const dynamic = "force-dynamic";

/**
 * /courses/[id]/preview —— 课件公开预览页（蓝图 D4 / 审查 P1-2）。
 *
 * 免登录看第 1 节课件的 read-only 版：分享链接/二维码的转化入口，让「课件本身」成为传播物。
 * 安全边界：只暴露 可浏览课程(published + public/unlisted) 的**首个免费节**（isFree，与权益层
 * 免费试学口径一致，绝不外泄付费正文）；不传 lessonId → 宿主不落任何学习数据；页面加水印。
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const course = await prisma.course.findFirst({
    where: { OR: [{ id }, { slug: id }], status: "published", visibility: { in: ["public", "unlisted"] } },
    select: { title: true, subtitle: true },
  });
  if (!course) return { title: "课件预览" };
  return { title: `${course.title} · 课件试读`, description: course.subtitle ?? "潮汐学习 · 精品课件试读" };
}

export default async function CoursePreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const course = await prisma.course.findFirst({
    where: { OR: [{ id }, { slug: id }], status: "published", visibility: { in: ["public", "unlisted"] } },
    select: {
      id: true,
      slug: true,
      title: true,
      subtitle: true,
      category: true,
      lessons: {
        where: { isFree: true, htmlJson: { not: null }, status: "published" },
        orderBy: { sortOrder: "asc" },
        take: 1,
        select: { id: true, title: true, htmlJson: true },
      },
    },
  });
  const lesson = course?.lessons[0];
  if (!course || !lesson?.htmlJson) notFound();

  let html = "";
  try {
    html = (JSON.parse(lesson.htmlJson) as { html?: string }).html ?? "";
  } catch {
    notFound();
  }
  if (!html) notFound();

  // 审计修复:单列流式页按 CLAUDE.md 容器档位取 760(1120 是内容网格页专用档)。
  return (
    <div className="mx-auto w-full max-w-[760px] px-4 py-8 sm:py-12">
      <div className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink4)]">
        Preview · 课件试读 · {trackLabel(course.category)}
      </div>
      <h1 className="mt-1 text-2xl font-bold leading-snug tracking-tight text-[var(--ink)]">{course.title}</h1>
      <p className="mt-1 text-sm text-[var(--ink3)]">
        {course.subtitle ?? "第 1 节免费试读"} · 本页为只读预览，学习进度与笔记需登录后使用
      </p>

      {/* 水印容器：不拦截交互（翻页/测验仍可体验），仅叠加半透明标识。 */}
      <div className="relative mt-5">
        {/* lessonId → 课件走独立同源文档路由(免登录试读:该节 isFree,路由允许匿名),不再受父页 CSP/nonce 约束。 */}
        <HtmlCourseware html={html} lessonId={lesson.id} nonce={(await headers()).get("x-nonce") ?? undefined} />
        <div
          aria-hidden
          className="mono pointer-events-none absolute right-4 top-12 z-10 select-none rounded-md bg-black/25 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-white/80"
        >
          潮汐学习 · 试读
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)]">
        <div>
          <div className="text-[15px] font-semibold text-[var(--ink)]">喜欢这节课的排版与内容?</div>
          <div className="mt-0.5 text-sm text-[var(--ink3)]">完整课程共多节，登录后可记笔记、答题进错题本、连续学习记录</div>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/courses/${course.slug || course.id}`}
            className="studio-press rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--ink)]"
          >
            查看完整课程
          </Link>
          <Link
            href={`/login?next=/courses/${course.slug || course.id}`}
            className="studio-press rounded-[10px] bg-[var(--red)] px-4 py-2 text-sm font-semibold text-white"
          >
            登录开始学
          </Link>
        </div>
      </div>
    </div>
  );
}
