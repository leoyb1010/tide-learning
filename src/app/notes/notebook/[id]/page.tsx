import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, BookBookmark, PushPin, Sparkle, PencilSimpleLine, NotePencil } from "@phosphor-icons/react/dist/ssr";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { TidalReveal } from "@/components/motion";
import { EmptyTide } from "@/components/TideIllustration";
import NotebookAiTidy from "@/components/NotebookAiTidy";

export const dynamic = "force-dynamic";

// 笔记来源标识（与 Note.source 一致）
const SOURCE_LABELS: Record<string, { label: string; Icon: typeof NotePencil }> = {
  lesson: { label: "课程内记", Icon: PencilSimpleLine },
  manual: { label: "独立笔记", Icon: NotePencil },
  ai_transform: { label: "AI 整理", Icon: Sparkle },
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

  // 二次强制 userId：仅本人未删除笔记，pinned 优先 + 最近更新
  const notes = await prisma.note.findMany({
    where: { notebookId: id, userId: user.id, deletedAt: null },
    select: { id: true, title: true, excerpt: true, source: true, pinned: true, updatedAt: true },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
  });

  const noteIds = notes.map((n) => n.id);

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
              <p className="mono mt-2 text-[11px] text-[var(--ink4)]">{notes.length} 条笔记</p>
            </div>
          </div>

          {/* AI 整理本笔记本：透传本笔记本下笔记 id，走 /api/ai/note-transform（noteIds 范围） */}
          <NotebookAiTidy noteIds={noteIds} title={notebook.title} />
        </div>
      </TidalReveal>

      {notes.length === 0 ? (
        <EmptyTide
          variant="notes"
          description="这个笔记本还是空的。在笔记馆里把笔记归入本笔记本，它们就会出现在这里。"
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {notes.map((n) => {
            const src = SOURCE_LABELS[n.source] ?? SOURCE_LABELS.manual;
            const SrcIcon = src.Icon;
            return (
              <Link
                key={n.id}
                href={`/notes/${n.id}`}
                className="studio-lift studio-rise block rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]"
              >
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-[var(--ink4)]">
                  {n.pinned && <PushPin size={12} weight="fill" className="text-[var(--red)]" />}
                  <SrcIcon size={12} weight="regular" />
                  <span>{src.label}</span>
                </div>
                <p className="truncate font-semibold text-[var(--ink)]">{n.title?.trim() || "无标题笔记"}</p>
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
