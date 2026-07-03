"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  MagnifyingGlass, DownloadSimple, Waves, GridFour, BookOpen, Star,
  Sparkle, CaretDown, ListBullets, ListChecks, Translate, Cards, Copy, Check,
  ListDashes, Notebook as NotebookIcon, PushPin, Plus, FloppyDisk, Camera, Scissors,
} from "@phosphor-icons/react";
import { EmptyTide } from "@/components/TideIllustration";
import { ErrorState, LoadingSkeleton, CardSkeleton, Button, Badge } from "@/components/ui";
import { TidalReveal } from "@/components/motion";
import { useToast } from "@/components/Toast";
import { Dialog } from "@/components/Dialog";
import { NoteTimeline } from "@/components/NoteTimeline";
import { NoteGallery } from "@/components/NoteGallery";
import NotebookGrid from "@/components/NotebookGrid";
import { track } from "@/lib/analytics-client";
import { renderMarkdown } from "@/lib/markdown";

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
  excerpt: string | null; // v2.2：列表预览摘要（写入时落库）
  sourceText: string | null;
  kind: string;
  source: string; // v2.2：lesson(课程内记) / manual(独立笔记) / ai_transform(AI整理产物)
  captureUrl: string | null;
  starred: boolean;
  pinned: boolean; // v2.2：置顶（「全部」列表优先）
  timestampSec: number | null;
  createdAt: string;
  updatedAt: string;
  notebookId: string | null;
  // v2.2：独立笔记(source=manual|ai_transform)不绑定课程/章节，故以下四项可空
  courseId: string | null;
  lessonId: string | null;
  course: { title: string; slug: string } | null;
  lesson: { title: string } | null;
  tags: NoteTagLite[];
}

interface TagFacet {
  id: string;
  name: string;
  color: string;
  count: number;
}

type View = "all" | "timeline" | "gallery" | "course" | "notebook";

const VIEWS: { key: View; label: string; icon: typeof Waves }[] = [
  { key: "all", label: "全部", icon: ListDashes },
  { key: "timeline", label: "时间轴", icon: Waves },
  { key: "gallery", label: "画廊", icon: GridFour },
  { key: "course", label: "按课程", icon: BookOpen },
  { key: "notebook", label: "笔记本", icon: NotebookIcon },
];

export default function NotesPage() {
  const { toast } = useToast();
  const [notes, setNotes] = useState<NoteRow[] | null>(null);
  const [tags, setTags] = useState<TagFacet[]>([]);
  const [error, setError] = useState(false);
  const [needLogin, setNeedLogin] = useState(false);
  const [view, setView] = useState<View>("all"); // v2.2：默认落「全部」普通列表

  // 「记一条」独立笔记编辑弹窗
  const [composeOpen, setComposeOpen] = useState(false);

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

  // 课程下拉选项（从当前笔记聚合；独立笔记无 course，跳过）
  const courseOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of notes ?? []) {
      if (n.courseId && n.course) map.set(n.courseId, n.course.title);
    }
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
              你在所有课程里记下与截取的一切，还有随手记的独立笔记，都收在这里。
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            {/* 记一条：随手记独立笔记（source=manual） */}
            <button
              type="button"
              onClick={() => setComposeOpen(true)}
              className="studio-press inline-flex items-center gap-1.5 rounded-[12px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-4 py-2.5 text-[13px] font-semibold text-[var(--red)] transition-colors"
            >
              <Plus size={15} weight="bold" /> 记一条
            </button>
            {hasNotes && (
              <>
                {/* 全局 AI 整理：对当前筛选出的笔记（noteIds）做转换 */}
                <AiTidyMenu
                  scope={{ noteIds: (notes ?? []).slice(0, 80).map((n) => n.id) }}
                  title="当前笔记"
                  onSaved={() => void load()}
                />
                <button
                  type="button"
                  onClick={exportNotes}
                  className="studio-press inline-flex items-center gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-[13px] font-semibold text-[var(--ink)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)]"
                >
                  <DownloadSimple size={15} weight="bold" /> 导出 Markdown
                </button>
              </>
            )}
          </div>
        </div>
      </TidalReveal>

      {/* 视图切换 + 筛选胶囊行 */}
      <div className="flex flex-wrap items-center gap-2.5">
        {/* 视图分段控件 */}
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

        {/* 笔记本视图无筛选胶囊；其余视图显示 */}
        {view !== "notebook" && (
          <>
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
          </>
        )}
      </div>

      {/* 搜索框 + 课程下拉（笔记本视图不需要，由 NotebookGrid 自管） */}
      {view !== "notebook" && (
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
      )}

      {/* 主体 */}
      {view === "notebook" ? (
        // v2.2：笔记本视图 —— 笔记本网格（新建/进入/整理）。
        <NotebookGrid />
      ) : error ? (
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
          description="进入任意课程边学边记，或点右上「记一条」随手写，都会汇聚到这里"
          action={<Button href="/courses">去学习</Button>}
        />
      ) : view === "gallery" ? (
        <NoteGallery notes={notes} />
      ) : view === "course" ? (
        <CourseView notes={notes} onSaved={() => void load()} />
      ) : view === "timeline" ? (
        <NoteTimeline notes={notes} onToggleStar={toggleStar} onDelete={remove} />
      ) : (
        // 默认「全部」：普通可点击列表，整卡跳 /notes/{id}
        <AllNotesList notes={notes} />
      )}

      {/* 记一条：独立笔记编辑弹窗 */}
      <ComposeDialog
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onCreated={() => {
          setComposeOpen(false);
          void load();
        }}
      />
    </div>
  );
}

// —— §5.2 消化层：AI 整理下拉菜单动作定义 ——
type TidyAction = "summary" | "flashcards" | "outline" | "actions" | "translate";
const TIDY_ITEMS: { key: TidyAction; label: string; Icon: typeof Sparkle }[] = [
  { key: "summary", label: "AI 总结", Icon: Sparkle },
  { key: "flashcards", label: "生成复习卡", Icon: Cards },
  { key: "outline", label: "改写大纲", Icon: ListBullets },
  { key: "actions", label: "提炼行动项", Icon: ListChecks },
  { key: "translate", label: "翻译（英）", Icon: Translate },
];

// AI 整理结果的统一形态：either 要点/行动项列表 or Markdown 文本 or 复习卡张数提示
interface TidyResult {
  title: string;
  kind: "list" | "markdown" | "cards";
  points?: string[];
  markdown?: string;
  count?: number;
  action?: TidyAction; // 落库时用于生成标题
}

/**
 * §5.2 AiTidyMenu —— 笔记「AI 整理」下拉。
 * scope 决定拉取范围：按课（courseId）或按选中笔记（noteIds）。
 * summary 走 /api/ai/note-summary；flashcards 走 /api/ai/review-card（落库）；
 * outline/actions/translate 走 /api/ai/note-transform。结果统一用 Dialog 展示。
 * v2.2：list/markdown 结果新增「存为笔记」按钮，POST /api/notes source=ai_transform 落库。
 */
function AiTidyMenu({
  scope,
  title,
  compact,
  onSaved,
}: {
  scope: { courseId: string } | { noteIds: string[] };
  title: string;
  compact?: boolean;
  onSaved?: () => void; // 存为笔记成功后回调（刷新列表）
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<TidyAction | null>(null);
  const [result, setResult] = useState<TidyResult | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭下拉
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const payload = "courseId" in scope ? { courseId: scope.courseId } : { noteIds: scope.noteIds };

  async function run(action: TidyAction) {
    setOpen(false);
    setBusy(action);
    setSaved(false);
    try {
      if (action === "summary") {
        const json = await fetch("/api/ai/note-summary", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, mode: "summary" }),
        }).then((r) => r.json());
        if (!json.ok) return toast(json.error ?? "AI 总结失败", { tone: "warn" });
        const points = (json.data?.summary ?? []) as string[];
        if (points.length === 0) return toast("没有可总结的要点", { tone: "info" });
        setResult({ title: `${title} · 复习要点`, kind: "list", points, action });
        setDialogOpen(true);
      } else if (action === "flashcards") {
        // 生成复习卡直接落库（/api/ai/review-card 批量分支）
        const json = await fetch("/api/ai/review-card", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }).then((r) => r.json());
        if (!json.ok) return toast(json.error ?? "复习卡生成失败", { tone: "warn" });
        const count = (json.data?.count ?? 0) as number;
        setResult({ title: `${title} · 复习卡`, kind: "cards", count, action });
        setDialogOpen(true);
        toast(`已生成 ${count} 张复习卡，去复习页开始练习`, { tone: "success" });
      } else {
        // outline / actions / translate → note-transform
        const json = await fetch("/api/ai/note-transform", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, action }),
        }).then((r) => r.json());
        if (!json.ok) return toast(json.error ?? "AI 整理失败", { tone: "warn" });
        if (action === "actions") {
          const items = (json.data?.items ?? []) as string[];
          if (items.length === 0) return toast("没有可提炼的行动项", { tone: "info" });
          setResult({ title: `${title} · 行动项`, kind: "list", points: items, action });
        } else {
          const md = (json.data?.markdown ?? "") as string;
          if (!md) return toast("AI 未返回内容", { tone: "info" });
          const label = action === "outline" ? "知识大纲" : "英文翻译";
          setResult({ title: `${title} · ${label}`, kind: "markdown", markdown: md, action });
        }
        setDialogOpen(true);
      }
      track("ai_note_tidy", { action, scope: "courseId" in scope ? "course" : "notes" });
    } catch {
      toast("AI 整理失败，请稍后重试", { tone: "warn" });
    } finally {
      setBusy(null);
    }
  }

  async function copyResult() {
    const text = result?.kind === "markdown" ? result.markdown ?? "" : (result?.points ?? []).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast("复制失败", { tone: "warn" });
    }
  }

  // 存为笔记：把 AI 整理产物落库为独立笔记（source=ai_transform）
  async function saveAsNote() {
    if (!result || result.kind === "cards" || saving) return;
    const contentMd =
      result.kind === "markdown"
        ? result.markdown ?? ""
        : (result.points ?? []).map((p, i) => `${i + 1}. ${p}`).join("\n");
    if (!contentMd.trim()) return toast("没有可保存的内容", { tone: "info" });
    setSaving(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: `AI整理·${result.title}`,
          contentMd,
          source: "ai_transform",
        }),
      }).then((r) => r.json());
      if (!res.ok) return toast(res.error ?? "保存失败", { tone: "warn" });
      setSaved(true);
      toast("已存为笔记", { tone: "success" });
      track("ai_note_save", { action: result.action ?? "unknown" });
      onSaved?.();
    } catch {
      toast("保存失败，请稍后重试", { tone: "warn" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy !== null}
        className={`studio-press inline-flex items-center gap-1.5 rounded-[11px] border border-[var(--border)] bg-[var(--surface)] font-semibold text-[var(--ink)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)] disabled:opacity-45 ${
          compact ? "px-3 py-1.5 text-[12px]" : "px-3.5 py-2 text-[12.5px]"
        }`}
      >
        <Sparkle size={14} weight="fill" className="text-[var(--red)]" />
        {busy ? "整理中…" : "AI 整理"}
        <CaretDown size={12} weight="bold" className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="studio-rise absolute right-0 z-30 mt-1.5 w-44 overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)] py-1 shadow-[var(--lift)]">
          {TIDY_ITEMS.map((it) => {
            const Icon = it.Icon;
            return (
              <button
                key={it.key}
                type="button"
                onClick={() => run(it.key)}
                className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] font-medium text-[var(--ink2)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--ink)]"
              >
                <Icon size={15} className="text-[var(--ink3)]" /> {it.label}
              </button>
            );
          })}
        </div>
      )}

      {/* 结果弹窗 */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={result?.title}>
        {result?.kind === "cards" ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--red-soft)] text-[var(--red)]">
              <Cards size={26} weight="fill" />
            </div>
            <p className="text-[15px] text-[var(--ink)]">
              已生成 <span className="mono font-bold text-[var(--red)]">{result.count}</span> 张复习卡
            </p>
            <Button href="/review">去复习页开始练习</Button>
          </div>
        ) : result?.kind === "list" ? (
          <>
            <ul className="space-y-2.5">
              {(result.points ?? []).map((point, i) => (
                <li key={i} className="flex gap-2.5 text-[14px] leading-[1.7] text-[var(--ink2)]">
                  <span className="mono mt-0.5 shrink-0 font-semibold text-[var(--red)]">{i + 1}.</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
            <ResultActions copied={copied} onCopy={copyResult} saving={saving} saved={saved} onSave={saveAsNote} />
          </>
        ) : result?.kind === "markdown" ? (
          <>
            <div
              className="tide-md max-h-[52vh] overflow-y-auto text-[14px] leading-[1.7] text-[var(--ink)]"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(result.markdown ?? "") }}
            />
            <ResultActions copied={copied} onCopy={copyResult} saving={saving} saved={saved} onSave={saveAsNote} />
          </>
        ) : null}
      </Dialog>
    </div>
  );
}

// 结果弹窗底部操作条：存为笔记 + 复制
function ResultActions({
  copied,
  onCopy,
  saving,
  saved,
  onSave,
}: {
  copied: boolean;
  onCopy: () => void;
  saving: boolean;
  saved: boolean;
  onSave: () => void;
}) {
  return (
    <div className="mt-4 flex items-center justify-end gap-2 border-t border-[var(--border)] pt-3">
      <button
        type="button"
        onClick={onSave}
        disabled={saving || saved}
        className="studio-press inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--red)] transition-colors disabled:opacity-55"
      >
        {saved ? <Check size={13} weight="bold" /> : <FloppyDisk size={13} weight="bold" />}
        {saved ? "已保存" : saving ? "保存中…" : "存为笔记"}
      </button>
      <button
        type="button"
        onClick={onCopy}
        className="studio-press inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--ink2)] transition-colors hover:text-[var(--ink)]"
      >
        {copied ? <Check size={13} weight="bold" className="text-[var(--red)]" /> : <Copy size={13} />}
        {copied ? "已复制" : "复制"}
      </button>
    </div>
  );
}

/** 相对时间：刚刚 / N分钟前 / N小时前 / N天前 / MM-DD */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit" });
}

/** 来源标识：课程名（课程内记）/ AI整理 / 独立笔记 */
function sourceLabel(n: NoteRow): { text: string; slug: string | null } {
  if (n.source === "ai_transform") return { text: "AI 整理", slug: null };
  if (n.courseId && n.course) return { text: n.course.title, slug: n.course.slug };
  return { text: "独立笔记", slug: null };
}

const KIND_TAG: Record<string, { label: string; icon: typeof Camera }> = {
  capture: { label: "截帧", icon: Camera },
  clip: { label: "剪藏", icon: Scissors },
};

/**
 * v2.2「全部」视图 —— 普通可点击列表（解决「点不进去」）。
 * 排序：pinned 优先，再按 updatedAt/createdAt 倒序。整卡跳 /notes/{id}。
 * 课程来源作为卡内小字：可点跳课程（stopPropagation，避免与整卡链接冲突）。
 */
function AllNotesList({ notes }: { notes: NoteRow[] }) {
  const sorted = useMemo(() => {
    return [...notes].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const at = new Date(a.updatedAt || a.createdAt).getTime();
      const bt = new Date(b.updatedAt || b.createdAt).getTime();
      return bt - at;
    });
  }, [notes]);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {sorted.map((n) => {
        const src = sourceLabel(n);
        const kindMeta = KIND_TAG[n.kind];
        const KindIcon = kindMeta?.icon;
        const preview = n.excerpt?.trim() || n.contentMd?.trim() || n.sourceText?.trim() || "";
        return (
          <Link
            key={n.id}
            href={`/notes/${n.id}`}
            className="studio-lift studio-rise group block rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]"
          >
            {/* 顶部元信息：来源 · 相对时间 · 置顶/收藏 */}
            <div className="mb-1.5 flex items-center gap-2 text-[12px] text-[var(--ink4)]">
              {n.pinned && <PushPin size={12} weight="fill" className="shrink-0 text-[var(--red)]" />}
              {src.slug ? (
                <span
                  role="link"
                  tabIndex={0}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.location.href = `/courses/${src.slug}`;
                  }}
                  className="truncate transition-colors hover:text-[var(--red)]"
                >
                  {src.text}
                </span>
              ) : (
                <span className="truncate">{src.text}</span>
              )}
              <span aria-hidden>·</span>
              <span className="mono shrink-0">{relativeTime(n.updatedAt || n.createdAt)}</span>
              {n.starred && <Star size={12} weight="fill" className="ml-auto shrink-0 text-[var(--red)]" />}
            </div>

            {/* 标题 + 类型标记 */}
            <div className="flex items-center gap-1.5">
              {kindMeta && KindIcon && (
                <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[var(--surface-inset)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ink3)]">
                  <KindIcon size={11} weight="fill" /> {kindMeta.label}
                </span>
              )}
              <p className="truncate text-[15px] font-semibold text-[var(--ink)]">{n.title || "未命名"}</p>
            </div>

            {/* 正文预览 */}
            {preview && (
              <p className="mt-1 line-clamp-2 text-[13px] leading-[1.6] text-[var(--ink2)]">{preview}</p>
            )}

            {/* 标签 */}
            {n.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {n.tags.map((t) => (
                  <Badge key={t.id} tone={t.color}>
                    {t.name}
                  </Badge>
                ))}
              </div>
            )}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * 记一条：独立笔记编辑弹窗。title + contentMd textarea + 保存。
 * POST /api/notes 不传 courseId/lessonId → source=manual。
 */
function ComposeDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [contentMd, setContentMd] = useState("");
  const [saving, setSaving] = useState(false);

  // 打开时清空表单
  useEffect(() => {
    if (open) {
      setTitle("");
      setContentMd("");
      setSaving(false);
    }
  }, [open]);

  async function submit() {
    if (!contentMd.trim()) return toast("笔记内容不能为空", { tone: "warn" });
    setSaving(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // 不传 courseId/lessonId → 后端判定为独立笔记 source=manual
        body: JSON.stringify({ title: title.trim() || undefined, contentMd: contentMd.trim() }),
      }).then((r) => r.json());
      if (!res.ok) return toast(res.error ?? "保存失败", { tone: "warn" });
      track("note_create", { source: "manual" });
      toast("已记下", { tone: "success" });
      onCreated();
    } catch {
      toast("保存失败，请稍后重试", { tone: "warn" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="记一条">
      <div className="space-y-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="标题（可留空）"
          className="w-full rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-[14px] font-semibold text-[var(--ink)] outline-none transition-colors placeholder:font-normal placeholder:text-[var(--ink4)] focus:border-[var(--ink3)]"
        />
        <textarea
          value={contentMd}
          onChange={(e) => setContentMd(e.target.value)}
          placeholder="随手写点什么…支持 Markdown"
          rows={7}
          className="w-full resize-y rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-[14px] leading-[1.7] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--ink3)]"
        />
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] pt-3">
          <button
            type="button"
            onClick={onClose}
            className="studio-press rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-[13px] font-semibold text-[var(--ink2)] transition-colors hover:text-[var(--ink)]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !contentMd.trim()}
            className="studio-press inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-4 py-2 text-[13px] font-semibold text-[var(--red)] transition-colors disabled:opacity-55"
          >
            <FloppyDisk size={14} weight="bold" /> {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** 课程视图：按课程归档，复用旧版归组样式（仅课程内笔记） */
function CourseView({ notes, onSaved }: { notes: NoteRow[]; onSaved?: () => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, { course: NonNullable<NoteRow["course"]>; courseId: string; items: NoteRow[] }>();
    for (const n of notes) {
      // 独立笔记(无课程)不进课程分组
      if (!n.courseId || !n.course) continue;
      const g = map.get(n.courseId) ?? { course: n.course, courseId: n.courseId, items: [] };
      g.items.push(n);
      map.set(n.courseId, g);
    }
    return Array.from(map.values());
  }, [notes]);

  if (groups.length === 0) {
    return (
      <EmptyTide
        variant="notes"
        description="还没有课程内笔记。切到「全部」看你的所有笔记，或去课程边学边记"
        action={<Button href="/courses">去学习</Button>}
      />
    );
  }

  return (
    <div className="space-y-9">
      {groups.map(({ courseId, course, items }) => (
        <CourseNoteGroup key={courseId} courseId={courseId} course={course} items={items} onSaved={onSaved} />
      ))}
    </div>
  );
}

/** 单个课程分组：标题 + AI 整理按钮 + 该课笔记列表（整卡跳 /notes/{id}） */
function CourseNoteGroup({
  courseId,
  course,
  items,
  onSaved,
}: {
  courseId: string;
  course: NonNullable<NoteRow["course"]>;
  items: NoteRow[];
  onSaved?: () => void;
}) {
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
          <AiTidyMenu scope={{ courseId }} title={course.title} onSaved={onSaved} />
          <span className="mono text-[12px] text-[var(--ink4)]">{items.length} 条</span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((n) => (
          <Link
            key={n.id}
            href={`/notes/${n.id}`}
            className="studio-lift block rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]"
          >
            <div className="mb-1.5 flex items-center gap-2 text-[12px] text-[var(--ink4)]">
              <span className="truncate">{n.lesson?.title ?? "课程笔记"}</span>
              {n.starred && <Star size={12} weight="fill" className="text-[var(--red)]" />}
            </div>
            {n.title && <p className="font-semibold text-[var(--ink)]">{n.title}</p>}
            {(n.excerpt?.trim() || n.contentMd?.trim()) && (
              <p className="mt-0.5 line-clamp-2 text-[13px] leading-[1.6] text-[var(--ink2)]">
                {n.excerpt?.trim() || n.contentMd}
              </p>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}
