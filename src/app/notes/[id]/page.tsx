import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { NoteDetail } from "@/components/NoteDetail";
import { NoteTransformPanel } from "@/components/NoteTransformPanel";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return { title: "笔记" };
  // 越权防护：强制 where userId，找不到（含他人笔记）一律回落默认标题，不泄露存在性
  const note = await prisma.note.findFirst({
    where: { id, userId: user.id, deletedAt: null },
    select: { title: true },
  });
  return { title: note?.title?.trim() || "未命名笔记" };
}

export default async function NoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/notes/${id}`);

  // 越权防护：所有 DB 查询强制 where userId；他人/已删笔记 → notFound()
  const note = await prisma.note.findFirst({
    where: { id, userId: user.id, deletedAt: null },
    include: {
      course: { select: { slug: true, title: true } },
      lesson: { select: { id: true, title: true } },
      tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
    },
  });
  if (!note) notFound();

  // 一键多转面板：仅对有正文的笔记开放（无正文的空笔记 / 纯截帧笔记转换无意义）
  const hasBody = note.contentMd.trim().length > 0;

  // 序列化为可传给 client 组件的普通对象（Date → ISO 字符串）
  return (
    <div className="mx-auto max-w-[760px] space-y-6">
      {/* relative z-10：把详情主体（含导出下拉）抬到「AI 一键多转」面板之上。该面板是
          studio-rise 动效元素（transform 自成 stacking context）且在 DOM 中更晚，默认会
          盖住上方就近弹出的导出菜单。此处在同级抬升整棵子树，是跨 stacking context 的根因修复。 */}
      <div className="relative z-10">
      <NoteDetail
        note={{
          id: note.id,
          title: note.title,
          contentMd: note.contentMd,
          kind: note.kind,
          source: note.source,
          sourceText: note.sourceText,
          captureUrl: note.captureUrl,
          timestampSec: note.timestampSec,
          starred: note.starred,
          createdAt: note.createdAt.toISOString(),
          updatedAt: note.updatedAt.toISOString(),
          course: note.course ? { slug: note.course.slug, title: note.course.title } : null,
          lesson: note.lesson ? { id: note.lesson.id, title: note.lesson.title } : null,
          tags: note.tags.map((t) => t.tag),
        }}
      />
      </div>
      {hasBody && <NoteTransformPanel noteId={note.id} noteTitle={note.title} />}
    </div>
  );
}
