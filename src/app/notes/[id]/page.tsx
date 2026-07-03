import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { NoteDetail } from "@/components/NoteDetail";

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

  // 序列化为可传给 client 组件的普通对象（Date → ISO 字符串）
  return (
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
  );
}
