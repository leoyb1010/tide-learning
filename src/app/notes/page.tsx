"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MagnifyingGlass, DownloadSimple, Waves, GridFour, BookOpen, Star } from "@phosphor-icons/react";
import { EmptyTide } from "@/components/TideIllustration";
import { ErrorState, LoadingSkeleton, CardSkeleton, Button, Badge } from "@/components/ui";
import { TidalReveal } from "@/components/motion";
import { useToast } from "@/components/Toast";
import { NoteTimeline } from "@/components/NoteTimeline";
import { NoteGallery } from "@/components/NoteGallery";
import { track } from "@/lib/analytics-client";

// 供 NoteTimeline / NoteGallery 复用的行类型（唯一真相源）
export interface NoteTagLite {
  id: string;
  name: string;
  color: string;
}
export interface NoteRow {
  id: string;
  title: string | null;
  contentMd: string;
  sourceText: string | null;
  kind: string;
  captureUrl: string | null;
  starred: boolean;
  timestampSec: number | null;
  createdAt: string;
  updatedAt: string;
  courseId: string;
  lessonId: string;
  course: { title: string; slug: string };
  lesson: { title: string };
  tags: NoteTagLite[];
}

interface TagFacet {
  id: string;
  name: string;
  color: string;
  count: number;
}

type View = "timeline" | "gallery" | "course";

const VIEWS: { key: View; label: string; icon: typeof Waves }[] = [
  { key: "timeline", label: "时间轴", icon: Waves },
  { key: "gallery", label: "画廊", icon: GridFour },
  { key: "course", label: "课程", icon: BookOpen },
];

export default function NotesPage() {
  const { toast } = useToast();
  const [notes, setNotes] = useState<NoteRow[] | null>(null);
  const [tags, setTags] = useState<TagFacet[]>([]);
  const [error, setError] = useState(false);
  const [needLogin, setNeedLogin] = useState(false);
  const [view, setView] = useState<View>("timeline");

  // 筛选状态
  const [q, setQ] = useState("");
  const [courseId, setCourseId] = useState<string>("");
  const [tagId, setTagId] = useState<string>("");
  const [captureOnly, setCaptureOnly] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);

  // 请求序号守卫：筛选快速变化时，仅接受最新一次请求的结果，
  // 防止较慢的旧响应后返回覆盖较新筛选的结果（竞态）。
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setError(false);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (courseId) params.set("courseId", courseId);
      if (tagId) params.set("tag", tagId);
      if (captureOnly) params.set("kind", "capture");
      if (starredOnly) params.set("starred", "1");

      const [notesRes, tagsRes, meRes] = await Promise.all([
        fetch(`/api/notes?${params.toString()}`).then((r) => r.json()),
        fetch(`/api/note-tags`).then((r) => r.json()),
        fetch(`/api/auth/me`).then((r) => r.json()),
      ]);
      // 已有更新的请求发出，丢弃本次过期结果
      if (seq !== loadSeq.current) return;
      if (!notesRes.ok) throw new Error();
      setNotes(notesRes.data.notes as NoteRow[]);
      setTags((tagsRes.ok ? tagsRes.data.tags : []) as TagFacet[]);
      setNeedLogin(!meRes.data?.user);
    } catch {
      if (seq !== loadSeq.current) return;
      setError(true);
    }
  }, [q, courseId, tagId, captureOnly, starredOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  // 课程下拉选项（从当前笔记聚合）
  const courseOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of notes ?? []) map.set(n.courseId, n.course.title);
    return Array.from(map.entries()).map(([id, title]) => ({ id, title }));
  }, [notes]);

  // 乐观更新：收藏
  async function toggleStar(n: NoteRow) {
    setNotes((prev) => prev?.map((x) => (x.id === n.id ? { ...x, starred: !x.starred } : x)) ?? prev);
    const res = await fetch(`/api/notes/${n.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ starred: !n.starred }),
    }).then((r) => r.json());
    if (!res.ok) {
      setNotes((prev) => prev?.map((x) => (x.id === n.id ? { ...x, starred: n.starred } : x)) ?? prev);
      toast("操作失败，请重试", { tone: "warn" });
    }
  }

  // 软删（带撤销提示）
  async function remove(n: NoteRow) {
    const prev = notes;
    setNotes((cur) => cur?.filter((x) => x.id !== n.id) ?? cur);
    const res = await fetch(`/api/notes/${n.id}`, { method: "DELETE" }).then((r) => r.json());
    if (!res.ok) {
      setNotes(prev);
      toast("删除失败，请重试", { tone: "warn" });
      return;
    }
    track("note_delete", { note_id: n.id, kind: n.kind });
    toast("笔记已删除", { tone: "success" });
  }

  function exportNotes() {
    track("note_export", { format: "md" });
    // 直接触发浏览器下载（附件响应）
    window.location.href = "/api/notes/export?format=md";
  }

  const hasNotes = (notes?.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      <TidalReveal>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink-950">笔记馆</h1>
            <p className="mt-1 text-ink-500">时间轴 · 画廊 · 课程 —— 你的每一次涨落都留在这里</p>
          </div>
          {hasNotes && (
            <Button variant="secondary" size="sm" onClick={exportNotes}>
              <DownloadSimple size={16} weight="bold" /> 导出 Markdown
            </Button>
          )}
        </div>
      </TidalReveal>

      {/* 视图切换 */}
      <div className="flex items-center gap-1 rounded-xl bg-ink-50 p-1">
        {VIEWS.map((v) => {
          const Icon = v.icon;
          const active = view === v.key;
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                active ? "bg-paper-raised text-accent-700 shadow-sm" : "text-ink-500 hover:text-ink-800"
              }`}
            >
              <Icon size={16} weight={active ? "fill" : "regular"} /> {v.label}
            </button>
          );
        })}
      </div>

      {/* 筛选栏 */}
      <div className="space-y-3">
        <div className="relative">
          <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索标题、正文或剪藏原文…"
            className="w-full rounded-xl border border-ink-200 bg-paper-raised py-2.5 pl-9 pr-4 text-sm outline-none focus:border-accent-400"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {courseOptions.length > 0 && (
            <select
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              className="rounded-lg border border-ink-200 bg-paper-raised px-3 py-1.5 text-sm text-ink-700 outline-none focus:border-accent-400"
            >
              <option value="">全部课程</option>
              {courseOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => setCaptureOnly((v) => !v)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors ${
              captureOnly
                ? "bg-accent-50 text-accent-700 ring-accent-200"
                : "bg-paper-raised text-ink-500 ring-ink-200 hover:text-ink-800"
            }`}
          >
            仅截帧
          </button>
          <button
            type="button"
            onClick={() => setStarredOnly((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors ${
              starredOnly
                ? "bg-accent-50 text-accent-700 ring-accent-200"
                : "bg-paper-raised text-ink-500 ring-ink-200 hover:text-ink-800"
            }`}
          >
            <Star size={12} weight={starredOnly ? "fill" : "regular"} /> 仅收藏
          </button>
          {/* 标签筛选 */}
          {tags.map((t) => {
            const active = tagId === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTagId(active ? "" : t.id)}
                className={active ? "" : "opacity-70 hover:opacity-100"}
              >
                <Badge tone={active ? t.color : "muted"}>
                  {t.name} · {t.count}
                </Badge>
              </button>
            );
          })}
        </div>
      </div>

      {/* 主体 */}
      {error ? (
        <ErrorState hint="笔记加载失败" onRetry={() => void load()} />
      ) : notes === null ? (
        <div className="space-y-4">
          <LoadingSkeleton lines={2} />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : needLogin ? (
        <EmptyTide
          variant="notes"
          description="笔记永久属于你，停订后仍可访问"
          action={<Button href="/login?next=/notes">去登录</Button>}
        />
      ) : !hasNotes ? (
        <EmptyTide
          variant="notes"
          description="进入任意课程，边学边记，截帧与剪藏都会汇聚到这里"
          action={<Button href="/courses">去学习</Button>}
        />
      ) : view === "gallery" ? (
        <NoteGallery notes={notes} />
      ) : view === "course" ? (
        <CourseView notes={notes} />
      ) : (
        <NoteTimeline notes={notes} onToggleStar={toggleStar} onDelete={remove} />
      )}
    </div>
  );
}

/** 课程视图：按课程归档，复用旧版归组样式 */
function CourseView({ notes }: { notes: NoteRow[] }) {
  const groups = useMemo(() => {
    const map = new Map<string, { course: NoteRow["course"]; items: NoteRow[] }>();
    for (const n of notes) {
      const g = map.get(n.courseId) ?? { course: n.course, items: [] };
      g.items.push(n);
      map.set(n.courseId, g);
    }
    return Array.from(map.entries());
  }, [notes]);

  return (
    <div className="space-y-8">
      {groups.map(([courseId, { course, items }]) => (
        <section key={courseId}>
          <div className="mb-3 flex items-center justify-between">
            <Link href={`/courses/${course.slug}`} className="font-medium text-ink-950 hover:text-accent-700">
              {course.title}
            </Link>
            <span className="text-xs text-ink-400">{items.length} 条</span>
          </div>
          <div className="space-y-2">
            {items.map((n) => (
              <Link
                key={n.id}
                href={`/courses/${n.courseId}/learn/${n.lessonId}${n.timestampSec != null ? `?t=${n.timestampSec}` : ""}`}
                className="block rounded-xl border border-ink-100 bg-paper-raised p-4 hover:border-accent-400"
              >
                <div className="mb-1 flex items-center gap-2 text-xs text-ink-400">
                  <span className="truncate">{n.lesson.title}</span>
                  {n.starred && <Star size={12} weight="fill" className="text-accent-500" />}
                </div>
                {n.title && <p className="font-medium text-ink-950">{n.title}</p>}
                {n.contentMd?.trim() && <p className="line-clamp-2 text-sm text-ink-800">{n.contentMd}</p>}
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
