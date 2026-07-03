"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MagnifyingGlass, DownloadSimple, Waves, GridFour, BookOpen, Star } from "@phosphor-icons/react";
import { EmptyTide } from "@/components/TideIllustration";
import { ErrorState, LoadingSkeleton, CardSkeleton, Button, Badge } from "@/components/ui";
import { TidalReveal } from "@/components/motion";
import { useToast } from "@/components/Toast";
import { Dialog } from "@/components/Dialog";
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
    <div className="space-y-7">
      <TidalReveal>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink4)]">NOTES · 笔记馆</div>
            <h1 className="mt-2 text-[26px] font-bold leading-tight text-[var(--ink)]">笔记馆</h1>
            <p className="mt-1.5 max-w-[520px] text-[15px] leading-[1.7] text-[var(--ink2)]">
              你在所有课程里记下与截取的一切，都收在这里。
            </p>
          </div>
          {hasNotes && (
            <button
              type="button"
              onClick={exportNotes}
              className="studio-press inline-flex items-center gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-[13px] font-semibold text-[var(--ink)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)]"
            >
              <DownloadSimple size={15} weight="bold" /> 导出 Markdown
            </button>
          )}
        </div>
      </TidalReveal>

      {/* 视图切换 + 筛选胶囊行 */}
      <div className="flex flex-wrap items-center gap-2.5">
        {/* 三视图分段控件 */}
        <div className="inline-flex items-center gap-1 rounded-full bg-[var(--surface2)] p-1">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const active = view === v.key;
            return (
              <button
                key={v.key}
                type="button"
                onClick={() => setView(v.key)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-all ${
                  active
                    ? "bg-[var(--ink)] text-[var(--surface)] shadow-[var(--card)]"
                    : "text-[var(--ink3)] hover:text-[var(--ink)]"
                }`}
              >
                <Icon size={15} weight={active ? "fill" : "regular"} /> {v.label}
              </button>
            );
          })}
        </div>

        <span className="mx-0.5 hidden h-5 w-px bg-[var(--border)] sm:block" />

        {/* 筛选胶囊：仅截帧 / 仅收藏 */}
        <button
          type="button"
          onClick={() => setCaptureOnly((v) => !v)}
          className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
            captureOnly
              ? "border border-[var(--red-soft-border)] bg-[var(--red-soft)] text-[var(--red)]"
              : "border border-[var(--border)] bg-[var(--surface)] text-[var(--ink3)] hover:text-[var(--ink)]"
          }`}
        >
          仅截帧
        </button>
        <button
          type="button"
          onClick={() => setStarredOnly((v) => !v)}
          className={`inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
            starredOnly
              ? "border border-[var(--red-soft-border)] bg-[var(--red-soft)] text-[var(--red)]"
              : "border border-[var(--border)] bg-[var(--surface)] text-[var(--ink3)] hover:text-[var(--ink)]"
          }`}
        >
          <Star size={12} weight={starredOnly ? "fill" : "regular"} /> 仅收藏
        </button>

        {/* 标签筛选胶囊 */}
        {tags.map((t) => {
          const active = tagId === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTagId(active ? "" : t.id)}
              className={`inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
                active
                  ? "border border-[var(--red-soft-border)] bg-[var(--red-soft)] text-[var(--red)]"
                  : "border border-[var(--border)] bg-[var(--surface)] text-[var(--ink3)] hover:text-[var(--ink)]"
              }`}
            >
              {t.name} <span className="mono text-[11px] opacity-80">{t.count}</span>
            </button>
          );
        })}
      </div>

      {/* 搜索框 + 课程下拉 */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[240px] flex-1">
          <MagnifyingGlass size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--ink4)]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索标题、正文或剪藏原文…"
            className="w-full rounded-[13px] border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-10 pr-4 text-[14px] text-[var(--ink)] shadow-[var(--card)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--ink3)]"
          />
        </div>
        {courseOptions.length > 0 && (
          <select
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
            className="rounded-[13px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-[13px] font-medium text-[var(--ink2)] shadow-[var(--card)] outline-none transition-colors focus:border-[var(--ink3)]"
          >
            <option value="">全部课程</option>
            {courseOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        )}
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
    <div className="space-y-9">
      {groups.map(([courseId, { course, items }]) => (
        <CourseNoteGroup key={courseId} courseId={courseId} course={course} items={items} />
      ))}
    </div>
  );
}

/** 单个课程分组：标题 + AI 总结按钮 + 该课笔记列表；总结结果用 Dialog 展示要点 */
function CourseNoteGroup({
  courseId,
  course,
  items,
}: {
  courseId: string;
  course: NoteRow["course"];
  items: NoteRow[];
}) {
  const { toast } = useToast();
  const [summarizing, setSummarizing] = useState(false);
  const [summary, setSummary] = useState<string[] | null>(null);
  const [open, setOpen] = useState(false);

  // AI 总结本课笔记：调 /api/ai/note-summary，成功后弹 Dialog 展示要点。
  // 未订阅用户返回 402（“AI 总结为订阅会员权益”），直接 toast 该 error；其余错误亦优雅提示、不崩溃。
  async function summarize() {
    setSummarizing(true);
    try {
      const json = await fetch("/api/ai/note-summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseId, mode: "summary" }),
      }).then((r) => r.json());
      if (!json.ok) { toast(json.error ?? "AI 总结失败", { tone: "warn" }); return; }
      const points = (json.data?.summary ?? []) as string[];
      if (points.length === 0) { toast("没有可总结的要点", { tone: "info" }); return; }
      setSummary(points);
      setOpen(true);
    } catch {
      toast("AI 总结失败，请稍后重试", { tone: "warn" });
    } finally {
      setSummarizing(false);
    }
  }

  return (
    <section className="studio-rise">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Link
          href={`/courses/${course.slug}`}
          className="text-[18px] font-bold text-[var(--ink)] transition-colors hover:text-[var(--red)]"
        >
          {course.title}
        </Link>
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={summarize}
            disabled={summarizing}
            className="studio-press inline-flex items-center gap-1.5 rounded-[11px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-[12.5px] font-semibold text-[var(--ink)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)] disabled:opacity-45"
          >
            {summarizing ? "总结中…" : "AI 总结本课笔记"}
          </button>
          <span className="mono text-[12px] text-[var(--ink4)]">{items.length} 条</span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((n) => (
          <Link
            key={n.id}
            href={`/courses/${n.courseId}/learn/${n.lessonId}${n.timestampSec != null ? `?t=${n.timestampSec}` : ""}`}
            className="studio-lift block rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]"
          >
            <div className="mb-1.5 flex items-center gap-2 text-[12px] text-[var(--ink4)]">
              <span className="truncate">{n.lesson.title}</span>
              {n.starred && <Star size={12} weight="fill" className="text-[var(--red)]" />}
            </div>
            {n.title && <p className="font-semibold text-[var(--ink)]">{n.title}</p>}
            {n.contentMd?.trim() && (
              <p className="mt-0.5 line-clamp-2 text-[13px] leading-[1.6] text-[var(--ink2)]">{n.contentMd}</p>
            )}
          </Link>
        ))}
      </div>

      {/* AI 总结要点弹窗：每条要点一行 */}
      <Dialog open={open} onClose={() => setOpen(false)} title={`「${course.title}」笔记要点`}>
        {summary && (
          <ul className="space-y-2.5">
            {summary.map((point, i) => (
              <li key={i} className="flex gap-2.5 text-[14px] text-[var(--ink2)]">
                <span className="mono mt-0.5 shrink-0 font-semibold text-[var(--red)]">{i + 1}.</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </section>
  );
}
