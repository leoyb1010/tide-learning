"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { EmptyState, ErrorState, LoadingSkeleton, Button } from "@/components/ui";
import { mmss } from "@/lib/format";

interface NoteRow {
  id: string;
  title: string | null;
  contentMd: string;
  timestampSec: number | null;
  updatedAt: string;
  course: { title: string; slug: string };
  lesson: { title: string };
  courseId: string;
  lessonId: string;
}

export default function NotesPage() {
  const [notes, setNotes] = useState<NoteRow[] | null>(null);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const [needLogin, setNeedLogin] = useState(false);

  async function load(query = "") {
    setError(false);
    try {
      const res = await fetch(`/api/notes?q=${encodeURIComponent(query)}`);
      const json = await res.json();
      if (!json.ok) throw new Error();
      setNotes(json.data.notes);
      // 检查登录态：无登录时接口返回空数组，用 me 判断
      const me = await fetch("/api/auth/me").then((r) => r.json());
      setNeedLogin(!me.data.user);
    } catch {
      setError(true);
    }
  }

  useEffect(() => { load(); }, []);

  // 按课程归档
  const grouped = (notes ?? []).reduce<Record<string, { course: NoteRow["course"]; items: NoteRow[] }>>((acc, n) => {
    (acc[n.courseId] ??= { course: n.course, items: [] }).items.push(n);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-950">我的笔记</h1>
        <p className="mt-1 text-ink-500">按课程归档 · 时间戳可回跳 · 停订后仍可查看</p>
      </div>

      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") load(q); }}
          placeholder="搜索笔记标题或正文…"
          className="flex-1 rounded-xl border border-ink-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-tide-400"
        />
        <Button onClick={() => load(q)} variant="secondary">搜索</Button>
      </div>

      {error ? (
        <ErrorState hint="笔记加载失败" onRetry={() => load(q)} />
      ) : notes === null ? (
        <div className="space-y-4"><LoadingSkeleton lines={4} /><LoadingSkeleton lines={4} /></div>
      ) : needLogin ? (
        <EmptyState title="登录后查看你的笔记" hint="笔记永久属于你，停订后仍可访问" action={<Button href="/login?next=/notes">去登录</Button>} />
      ) : notes.length === 0 ? (
        <EmptyState title="还没有笔记" hint="进入任意课程，边学边记" action={<Button href="/courses">去学习</Button>} />
      ) : (
        <div className="space-y-8">
          {Object.entries(grouped).map(([courseId, { course, items }]) => (
            <section key={courseId}>
              <div className="mb-3 flex items-center justify-between">
                <Link href={`/courses/${course.slug}`} className="font-medium text-ink-950 hover:text-tide-700">{course.title}</Link>
                <span className="text-xs text-ink-400">{items.length} 条</span>
              </div>
              <div className="space-y-2">
                {items.map((n) => (
                  <Link key={n.id} href={`/courses/${n.courseId}/learn/${n.lessonId}`} className="block rounded-xl border border-ink-100 bg-paper-raised p-4 hover:border-tide-400">
                    <div className="mb-1.5 flex items-center gap-2 text-xs text-ink-400">
                      <span>{n.lesson.title}</span>
                      {n.timestampSec != null && <span className="rounded bg-tide-50 px-1.5 text-tide-700">⏱ {mmss(n.timestampSec)}</span>}
                    </div>
                    {n.title && <p className="font-medium text-ink-950">{n.title}</p>}
                    <p className="line-clamp-2 text-sm text-ink-800">{n.contentMd}</p>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
