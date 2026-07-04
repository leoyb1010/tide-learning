import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, BookBookmark, PushPin, Sparkle, PencilSimpleLine, NotePencil, LinkSimple, Books } from "@phosphor-icons/react/dist/ssr";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { TidalReveal } from "@/components/motion";
import { EmptyTide } from "@/components/TideIllustration";
import NotebookAiTidy from "@/components/NotebookAiTidy";
import { ExportMenu } from "@/components/ExportMenu";

export const dynamic = "force-dynamic";

// 笔记来源标识（知识脉络第一层，与 Note.source 一致）；tint 用语义色区分来路。
const SOURCE_LABELS: Record<string, { label: string; Icon: typeof NotePencil; tint: string }> = {
  lesson: { label: "课程内记", Icon: PencilSimpleLine, tint: "var(--info)" },
  manual: { label: "手记", Icon: NotePencil, tint: "var(--ink3)" },
  ai_transform: { label: "AI 整理", Icon: Sparkle, tint: "var(--info)" },
  link_import: { label: "链接采集", Icon: LinkSimple, tint: "var(--ok)" },
};

/**
 * /notes/notebook/[id] · 笔记本详情（服务端渲染）
 * 越权铁律：所有查询强制 where userId；notebook 命中他人则 404（不泄露存在性）。
 * 未登录 → 去登录（回跳当前笔记本）。
 */
export default async function NotebookDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/notes/notebook/${id}`);

  const notebook = await prisma.notebook.findFirst({
    where: { id, userId: user.id },
    select: { id: true, title: true, description: true, icon: true },
  });
  if (!notebook) notFound();

  // 二次强制 userId：仅本人未删除笔记，pinned 优先 + 最近更新。
  // 带上课程/章节，供「知识脉络」呈现（本笔记本收纳自哪几门课）。
  const notes = await prisma.note.findMany({
    where: { notebookId: id, userId: user.id, deletedAt: null },
    select: {
      id: true, title: true, excerpt: true, source: true, pinned: true, updatedAt: true,
      courseId: true,
      course: { select: { title: true } },
      lesson: { select: { title: true } },
    },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
  });

  const noteIds = notes.map((n) => n.id);
  // 归属汇总：本笔记本收纳了 N 条笔记，来自 M 门课（去重非空 courseId）。
  const courseCount = new Set(notes.filter((n) => n.courseId).map((n) => n.courseId)).size;

  return (
    <div className="space-y-7">
      <TidalReveal>
        <Link
          href="/notes"
          className="mono inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--ink3)] transition-colors hover:text-[var(--ink)]"
        >
          <ArrowLeft size={13} weight="bold" /> 返回笔记馆
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[13px] border border-[var(--border)] bg-[var(--surface2)] text-[22px]">
              {notebook.icon ? (
                <span aria-hidden>{notebook.icon}</span>
              ) : (
                <BookBookmark size={22} weight="duotone" className="text-[var(--ink3)]" />
              )}
            </div>
            <div>
              <div className="mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink4)]">NOTEBOOK · 笔记本</div>
              <h1 className="mt-1.5 text-[24px] font-bold leading-tight text-[var(--ink)]">{notebook.title}</h1>
              {notebook.description && (
                <p className="mt-1.5 max-w-[560px] text-[14px] leading-[1.7] text-[var(--ink2)]">
                  {notebook.description}
                </p>
              )}
              {/* 归属汇总（知识脉络容器层）：本笔记本收纳了 N 条 · 来自 M 门课，让归属一目了然 */}
              <p className="mt-2 inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--ink4)]">
                <span className="mono">{notes.length} 条笔记</span>
                {courseCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-[var(--ink3)]">
                    <Books size={12} weight="regular" />
                    来自 <span className="mono text-[var(--ink2)]">{courseCount}</span> 门课
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* 导出中心：md / html / txt / json / 打印版，导出的是「本笔记本」范围 */}
            {notes.length > 0 && <ExportMenu scope={{ kind: "notebook", notebookId: notebook.id }} label="导出" />}
            {/* AI 整理本笔记本：透传本笔记本下笔记 id，走 /api/ai/note-transform（noteIds 范围） */}
            <NotebookAiTidy noteIds={noteIds} title={notebook.title} />
          </div>
        </div>
      </TidalReveal>

      {notes.length === 0 ? (
        <EmptyTide
          variant="notes"
          description="这个笔记本还是空的。在笔记馆里把笔记归入本笔记本，它们就会出现在这里。"
        />
      ) : (
        <div className="stagger grid grid-cols-1 gap-3 sm:grid-cols-2">
          {notes.map((n, i) => {
            const src = SOURCE_LABELS[n.source] ?? SOURCE_LABELS.manual;
            const SrcIcon = src.Icon;
            return (
              <Link
                key={n.id}
                href={`/notes/${n.id}`}
                style={{ "--i": Math.min(i, 12) } as React.CSSProperties}
                className="studio-lift block min-h-[44px] rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]"
              >
                {/* 知识脉络 · 来源层：来源徽章（语义色）+ 置顶 */}
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-[var(--ink4)]">
                  {n.pinned && <PushPin size={12} weight="fill" className="shrink-0 text-[var(--red)]" />}
                  <SrcIcon size={12} weight="fill" style={{ color: src.tint }} className="shrink-0" />
                  <span style={{ color: src.tint }} className="font-medium">{src.label}</span>
                </div>
                <p className="truncate font-semibold text-[var(--ink)]">{n.title?.trim() || "无标题笔记"}</p>
                {/* 知识脉络 · 血缘：若来自课程，标明出处课/节 */}
                {n.course && (
                  <p className="mt-1 truncate text-[11px] text-[var(--ink3)]">
                    <span className="text-[var(--ink4)]">来自</span> 《{n.course.title}》
                    {n.lesson && <span className="text-[var(--ink4)]"> · {n.lesson.title}</span>}
                  </p>
                )}
                {n.excerpt && (
                  <p className="mt-1 line-clamp-2 text-[13px] leading-[1.6] text-[var(--ink2)]">{n.excerpt}</p>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
