"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  MagnifyingGlass, Waves, GridFour, BookOpen, Star,
  Sparkle, CaretDown, ListBullets, ListChecks, Translate, Cards, Copy, Check,
  ListDashes, Notebook as NotebookIcon, PushPin, Plus, FloppyDisk, Camera, Scissors,
  PencilSimple, LinkSimple, Image as ImageIcon, Paperclip, ArrowLeft, CircleNotch,
  UploadSimple, ArrowClockwise, Warning, X as XIcon, FileText,
  Tag, BookBookmark, GraduationCap,
} from "@phosphor-icons/react";
import { EmptyTide } from "@/components/TideIllustration";
import { ErrorState, Button, Badge } from "@/components/ui";
import { TidalReveal } from "@/components/motion";
import { useToast } from "@/components/Toast";
import { Dialog } from "@/components/Dialog";
import { NoteTimeline } from "@/components/NoteTimeline";
import { NoteGallery } from "@/components/NoteGallery";
import NotebookGrid from "@/components/NotebookGrid";
import { ExportMenu } from "@/components/ExportMenu";
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

export interface TagFacet {
  id: string;
  name: string;
  color: string;
  count: number;
}

// SSR 首屏数据：服务端直查后作为 initialData 注入，客户端无需首屏 fetch。
export interface NotesInitialData {
  notes: NoteRow[];
  nextCursor: string | null;
  total: number;
  tags: TagFacet[];
  loggedIn: boolean;
  /** 首屏落地视图（如从笔记本详情页返回时经 ?view=notebook 直达笔记本视图）。缺省「全部」。 */
  initialView?: View;
}

type View = "all" | "timeline" | "gallery" | "course" | "notebook";

const VIEWS: { key: View; label: string; icon: typeof Waves }[] = [
  { key: "all", label: "全部", icon: ListDashes },
  { key: "timeline", label: "时间轴", icon: Waves },
  { key: "gallery", label: "画廊", icon: GridFour },
  { key: "course", label: "按课程", icon: BookOpen },
  { key: "notebook", label: "笔记本", icon: NotebookIcon },
];

// 单页拉取条数（与服务端 NOTE_PAGE_DEFAULT 对齐）
const PAGE_LIMIT = 30;
// 超过此阈值时给列表卡片开启 content-visibility 虚拟化（零依赖减少回流）
const VIRTUALIZE_THRESHOLD = 60;

/**
 * NotesClient：笔记馆交互岛（"use client"）。
 * 首屏数据由 Server Component（page.tsx）直查后经 initialData 注入，
 * 客户端不再发首屏 fetch；仅在筛选变化时重取第一页、滚动到底用 nextCursor 加载更多。
 * 视图切换（全部/时间轴/画廊/课程/笔记本）纯客户端，复用已有数据不重新请求。
 */
export default function NotesClient({ initialData }: { initialData: NotesInitialData }) {
  const { toast } = useToast();
  const [notes, setNotes] = useState<NoteRow[]>(initialData.notes);
  const [nextCursor, setNextCursor] = useState<string | null>(initialData.nextCursor);
  const [total, setTotal] = useState<number>(initialData.total);
  const [tags, setTags] = useState<TagFacet[]>(initialData.tags);
  const [error, setError] = useState(false);
  const [needLogin] = useState(!initialData.loggedIn);
  const [loadingMore, setLoadingMore] = useState(false);
  const [view, setView] = useState<View>(initialData.initialView ?? "all"); // v2.2：默认落「全部」；?view= 可直达指定视图

  // 「记一条」独立笔记编辑弹窗
  const [composeOpen, setComposeOpen] = useState(false);

  // 筛选状态
  const [q, setQ] = useState("");
  const [courseId, setCourseId] = useState<string>("");
  const [tagId, setTagId] = useState<string>("");
  const [captureOnly, setCaptureOnly] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);

  // 首次挂载守卫：initialData 已是「无筛选」的第一页，避免挂载即重复请求覆盖 SSR 数据。
  const isFirstRun = useRef(true);

  // 请求序号守卫：筛选快速变化时，仅接受最新一次请求的结果，
  // 防止较慢的旧响应后返回覆盖较新筛选的结果（竞态）。
  const loadSeq = useRef(0);

  // 当前筛选拼 query（不含 cursor）
  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (courseId) params.set("courseId", courseId);
    if (tagId) params.set("tag", tagId);
    if (captureOnly) params.set("kind", "capture");
    if (starredOnly) params.set("starred", "1");
    params.set("limit", String(PAGE_LIMIT));
    return params;
  }, [q, courseId, tagId, captureOnly, starredOnly]);

  // 筛选变化 → 重取第一页（覆盖列表）。视图切换不触发（view 不在依赖里）。
  const reload = useCallback(async () => {
    const seq = ++loadSeq.current;
    setError(false);
    try {
      const params = buildParams();
      const notesRes = await fetch(`/api/notes?${params.toString()}`).then((r) => r.json());
      if (seq !== loadSeq.current) return; // 已有更新请求发出，丢弃过期结果
      if (!notesRes.ok) throw new Error();
      setNotes(notesRes.data.notes as NoteRow[]);
      setNextCursor((notesRes.data.nextCursor as string | null) ?? null);
      setTotal((notesRes.data.total as number) ?? 0);
    } catch {
      if (seq !== loadSeq.current) return;
      setError(true);
    }
  }, [buildParams]);

  // 标签面板可能随笔记增删变化：AI 存为笔记 / 新建后刷新时一并重取。
  const reloadTags = useCallback(async () => {
    try {
      const res = await fetch(`/api/note-tags`).then((r) => r.json());
      if (res.ok) setTags(res.data.tags as TagFacet[]);
    } catch {
      /* 标签刷新失败不阻塞主流程 */
    }
  }, []);

  // 全量刷新（笔记增删后）：重取第一页 + 标签。
  const refreshAll = useCallback(() => {
    void reload();
    void reloadTags();
  }, [reload, reloadTags]);

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return; // 首屏用 SSR 数据，跳过一次
    }
    void reload();
  }, [reload]);

  // 滚动加载更多：用 nextCursor 追加下一页（仅「全部」列表分页；其余视图消费已加载集合）。
  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    // 进入时快照当前请求序号；reload（筛选变化）会递增 loadSeq 使在途 loadMore 失效，
    // 避免旧筛选的第二页被 append 到新筛选列表（滚动分页 + 切筛选竞态）。
    const seq = loadSeq.current;
    setLoadingMore(true);
    try {
      const params = buildParams();
      params.set("cursor", nextCursor);
      const res = await fetch(`/api/notes?${params.toString()}`).then((r) => r.json());
      if (seq !== loadSeq.current) return; // 期间已有 reload，丢弃过期分页结果
      if (!res.ok) throw new Error();
      const more = res.data.notes as NoteRow[];
      setNotes((prev) => {
        // 去重：cursor 分页极端并发下防重复 id
        const seen = new Set(prev.map((n) => n.id));
        return [...prev, ...more.filter((n) => !seen.has(n.id))];
      });
      setNextCursor((res.data.nextCursor as string | null) ?? null);
      setTotal((res.data.total as number) ?? total);
    } catch {
      if (seq !== loadSeq.current) return; // 过期请求的异常不打扰用户
      toast("加载更多失败，请重试", { tone: "warn" });
    } finally {
      // 始终复位：loadingMore 是纯在途/UI 守卫，即便本次结果被丢弃也须解锁下一次分页。
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, buildParams, total, toast]);

  // 哨兵进入视口即触发 loadMore（IntersectionObserver）。仅「全部」视图挂载哨兵。
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (view !== "all" || !nextCursor) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [view, nextCursor, loadMore]);

  // 课程下拉选项（从当前已加载笔记聚合；独立笔记无 course，跳过）
  const courseOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of notes) {
      if (n.courseId && n.course) map.set(n.courseId, n.course.title);
    }
    return Array.from(map.entries()).map(([id, title]) => ({ id, title }));
  }, [notes]);

  // 乐观更新：收藏
  async function toggleStar(n: NoteRow) {
    setNotes((prev) => prev.map((x) => (x.id === n.id ? { ...x, starred: !x.starred } : x)));
    const res = await fetch(`/api/notes/${n.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ starred: !n.starred }),
    }).then((r) => r.json());
    if (!res.ok) {
      setNotes((prev) => prev.map((x) => (x.id === n.id ? { ...x, starred: n.starred } : x)));
      toast("操作失败，请重试", { tone: "warn" });
    }
  }

  // 软删（带撤销提示）
  async function remove(n: NoteRow) {
    const prev = notes;
    setNotes((cur) => cur.filter((x) => x.id !== n.id));
    const res = await fetch(`/api/notes/${n.id}`, { method: "DELETE" }).then((r) => r.json());
    if (!res.ok) {
      setNotes(prev);
      toast("删除失败，请重试", { tone: "warn" });
      return;
    }
    track("note_delete", { note_id: n.id, kind: n.kind });
    toast("笔记已删除", { tone: "success" });
  }

  const hasNotes = notes.length > 0;

  return (
    <div className="mx-auto max-w-[1120px] space-y-7">
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
              className="cta-glow studio-press inline-flex items-center gap-1.5 rounded-[12px] bg-[var(--red)] px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--red-hover)]"
            >
              <Plus size={15} weight="bold" /> 记一条
            </button>
            {hasNotes && (
              <>
                {/* 全局 AI 整理：对当前筛选出的笔记（noteIds）做转换 */}
                <AiTidyMenu
                  scope={{ noteIds: notes.slice(0, 80).map((n) => n.id) }}
                  title="当前笔记"
                  onSaved={refreshAll}
                />
                {/* 导出中心：md / html / txt / json / 打印版，一处显性选择 */}
                <ExportMenu scope={{ kind: "all" }} label="导出" />
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
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3.5 py-2.5 text-[13px] font-semibold transition-all sm:min-h-0 sm:py-1.5 ${
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
              className={`inline-flex min-h-[44px] items-center rounded-full px-3.5 py-2.5 text-[13px] font-semibold transition-colors sm:min-h-0 sm:py-1.5 ${
                captureOnly
                  ? "border border-[var(--red-soft-border)] bg-[var(--red-soft)] text-[var(--red-ink)]"
                  : "border border-[var(--border)] bg-[var(--surface)] text-[var(--ink3)] hover:text-[var(--ink)]"
              }`}
            >
              仅截帧
            </button>
            <button
              type="button"
              onClick={() => setStarredOnly((v) => !v)}
              className={`inline-flex min-h-[44px] items-center gap-1 rounded-full px-3.5 py-2.5 text-[13px] font-semibold transition-colors sm:min-h-0 sm:py-1.5 ${
                starredOnly
                  ? "border border-[var(--red-soft-border)] bg-[var(--red-soft)] text-[var(--red-ink)]"
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
              className="w-full rounded-[14px] border border-[var(--border)] bg-[var(--surface)] py-2.5 pl-10 pr-4 text-[14px] text-[var(--ink)] shadow-[var(--card)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--ink3)]"
            />
          </div>
          {courseOptions.length > 0 && (
            <select
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-[13px] font-medium text-[var(--ink2)] shadow-[var(--card)] outline-none transition-colors focus:border-[var(--ink3)]"
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

      {/* 主体：按 view 作 key，切换视图时重放 .studio-slide 转场 */}
      <div key={view} className="studio-slide">
        {view === "notebook" ? (
          // v2.2：笔记本视图，笔记本网格（新建/进入/整理）。
          <NotebookGrid />
        ) : error ? (
          <ErrorState hint="笔记加载失败" onRetry={() => void reload()} />
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
          <CourseView notes={notes} onSaved={refreshAll} />
        ) : view === "timeline" ? (
          <NoteTimeline notes={notes} onToggleStar={toggleStar} onDelete={remove} />
        ) : (
          // 默认「全部」：普通可点击列表，整卡跳 /notes/{id}
          <>
            <AllNotesList notes={notes} />
            {/* 加载更多：哨兵触发 + 手动按钮兜底（无障碍/IO 不可用时可点） */}
            {nextCursor && (
              <div ref={sentinelRef} className="mt-4 flex justify-center">
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="studio-press inline-flex items-center gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[13px] font-semibold text-[var(--ink2)] shadow-[var(--card)] transition-colors hover:text-[var(--ink)] disabled:opacity-55"
                >
                  {loadingMore ? <CircleNotch size={14} weight="bold" className="animate-spin" /> : null}
                  {loadingMore ? "加载中…" : "加载更多"}
                </button>
              </div>
            )}
            {!nextCursor && total > 0 && (
              <p className="mono mt-4 text-center text-[12px] text-[var(--ink4)]">共 {total} 条 · 已到底</p>
            )}
          </>
        )}
      </div>

      {/* 记一条：独立笔记编辑弹窗 */}
      <ComposeDialog
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onCreated={() => {
          setComposeOpen(false);
          refreshAll();
        }}
      />
    </div>
  );
}

// §5.2 消化层：AI 整理下拉菜单动作定义
type TidyAction = "summary" | "flashcards" | "outline" | "actions" | "translate";
const TIDY_ITEMS: { key: TidyAction; label: string; Icon: typeof Sparkle }[] = [
  { key: "summary", label: "AI 总结", Icon: Sparkle },
  { key: "flashcards", label: "生成复习卡", Icon: Cards },
  { key: "outline", label: "改写大纲", Icon: ListBullets },
  { key: "actions", label: "提炼行动项", Icon: ListChecks },
  { key: "translate", label: "翻译（英）", Icon: Translate },
];

// AI 整理请求兜底超时：15s 内无响应强制复位 busy，避免菜单永久卡「整理中…」（双击缺陷根因之一）
const TIDY_TIMEOUT_MS = 15_000;

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
 * §5.2 AiTidyMenu：笔记「AI 整理」下拉。
 * scope 决定拉取范围：按课（courseId）或按选中笔记（noteIds）。
 * summary 走 /api/ai/note-summary；flashcards 走 /api/ai/review-card（落库）；
 * outline/actions/translate 走 /api/ai/note-transform。结果统一用 Dialog 展示。
 * v2.2：list/markdown 结果新增「存为笔记」按钮，POST /api/notes source=ai_transform 落库。
 * v3.0 双击修复：菜单项改 onPointerDown 提前响应；busy 项显示 spinner；请求加 15s 超时兜底复位。
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
  // 超时兜底句柄：卸载/复位时清理，避免泄漏或误清后续请求的 busy
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearBusyTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // 点击外部关闭下拉
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // 卸载时清超时句柄
  useEffect(() => clearBusyTimeout, [clearBusyTimeout]);

  const payload = "courseId" in scope ? { courseId: scope.courseId } : { noteIds: scope.noteIds };

  async function run(action: TidyAction) {
    if (busy) return; // 请求进行中忽略重复触发（配合 onPointerDown 防双击重入）
    setOpen(false);
    setBusy(action);
    setSaved(false);
    // 15s 超时兜底：无论请求 resolve 与否，到点强制复位 busy 并提示，避免菜单永久卡死
    clearBusyTimeout();
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setBusy((cur) => {
        if (cur === action) {
          toast("AI 整理超时，请稍后重试", { tone: "warn" });
          return null;
        }
        return cur;
      });
    }, TIDY_TIMEOUT_MS);
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
      clearBusyTimeout();
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
        className={`studio-press inline-flex items-center gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] font-semibold text-[var(--ink)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)] disabled:opacity-45 ${
          compact ? "px-3 py-1.5 text-[12px]" : "px-3.5 py-2 text-[13px]"
        }`}
      >
        {busy ? (
          <CircleNotch size={14} weight="bold" className="animate-spin text-[var(--red)]" />
        ) : (
          <Sparkle size={14} weight="fill" className="text-[var(--red)]" />
        )}
        {busy ? "整理中…" : "AI 整理"}
        <CaretDown size={12} weight="bold" className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="studio-rise elev-3 absolute right-0 z-30 mt-1.5 w-44 overflow-hidden rounded-[12px] py-1">
          {TIDY_ITEMS.map((it) => {
            const Icon = it.Icon;
            const itemBusy = busy === it.key;
            return (
              <button
                key={it.key}
                type="button"
                // onPointerDown 提前响应：比 click 早一帧触发，防「点了没反应又点一下」的双击
                onPointerDown={(e) => {
                  e.preventDefault();
                  void run(it.key);
                }}
                disabled={busy !== null}
                className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] font-medium text-[var(--ink2)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--ink)] disabled:cursor-default disabled:opacity-60"
              >
                {itemBusy ? (
                  <CircleNotch size={15} weight="bold" className="animate-spin text-[var(--red)]" />
                ) : (
                  <Icon size={15} className="text-[var(--ink3)]" />
                )}
                {it.label}
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
        className="studio-press inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-3 py-1.5 text-[13px] font-semibold text-[var(--red)] transition-colors disabled:opacity-55"
      >
        {saved ? <Check size={13} weight="bold" /> : <FloppyDisk size={13} weight="bold" />}
        {saved ? "已保存" : saving ? "保存中…" : "存为笔记"}
      </button>
      <button
        type="button"
        onClick={onCopy}
        className="studio-press inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[13px] font-semibold text-[var(--ink2)] transition-colors hover:text-[var(--ink)]"
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
 * v2.2「全部」视图：普通可点击列表（解决「点不进去」）。
 * 排序：pinned 优先，再按 updatedAt/createdAt 倒序。整卡跳 /notes/{id}。
 * 课程来源作为卡内小字：可点跳课程（stopPropagation，避免与整卡链接冲突）。
 * v3.0 虚拟化：> 60 条时给每卡加 content-visibility:auto + contain-intrinsic-size，
 *   让视口外的卡片跳过布局/绘制，显著减少长列表 DOM 回流（零依赖）。
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

  // 仅在长列表启用虚拟化，短列表保持零成本
  const virtualize = sorted.length > VIRTUALIZE_THRESHOLD;
  // contain-intrinsic-size：占位高度估算（卡片约 150px + gap），避免滚动条抖动
  const cvStyle = virtualize
    ? ({ contentVisibility: "auto", containIntrinsicSize: "auto 150px" } as React.CSSProperties)
    : undefined;

  return (
    // 对齐规范（问题③）：items-stretch + 卡片 h-full flex-col，同行笔记卡等高。
    <div className="stagger grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2">
      {sorted.map((n, i) => {
        const src = sourceLabel(n);
        const kindMeta = KIND_TAG[n.kind];
        const KindIcon = kindMeta?.icon;
        const preview = n.excerpt?.trim() || n.contentMd?.trim() || n.sourceText?.trim() || "";
        const isAi = n.source === "ai_transform";
        return (
          <Link
            key={n.id}
            href={`/notes/${n.id}`}
            style={{ "--i": Math.min(i, 12), ...cvStyle } as React.CSSProperties}
            className="hover-sheen studio-lift group flex h-full flex-col rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card),var(--inner-hi)]"
          >
            {/* 顶部元信息：来源标识 · 相对时间 · 置顶/收藏 */}
            <div className="mb-1.5 flex items-center gap-2 text-[12px] text-[var(--ink4)]">
              {n.pinned && <PushPin size={12} weight="fill" className="shrink-0 text-[var(--red)]" />}
              {/* 来源标识：AI 整理用 info 语义色小圆点，课程/独立笔记用来源名 */}
              {isAi && <Sparkle size={11} weight="fill" className="shrink-0 text-[var(--info)]" />}
              {src.slug ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.location.href = `/courses/${src.slug}`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      window.location.href = `/courses/${src.slug}`;
                    }
                  }}
                  className="truncate text-left transition-colors hover:text-[var(--red)]"
                >
                  {src.text}
                </button>
              ) : (
                <span className={`truncate ${isAi ? "font-medium text-[var(--info)]" : ""}`}>{src.text}</span>
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
              <p className="truncate text-[15px] font-semibold text-[var(--ink)] transition-colors group-hover:text-[var(--red)]">{n.title || "未命名"}</p>
            </div>

            {/* 正文预览 */}
            {preview && (
              <p className="mt-1 line-clamp-2 text-[13px] leading-[1.6] text-[var(--ink2)]">{preview}</p>
            )}

            {/* 标签：mt-auto 贴底，让有无标签的同行卡片底部基线对齐（问题③） */}
            {n.tags.length > 0 && (
              <div className="mt-auto flex flex-wrap gap-1 pt-2">
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

// 采集面板：四入口
type CaptureEntry = "menu" | "write" | "link" | "image" | "attach";

const ENTRY_META: {
  key: Exclude<CaptureEntry, "menu">;
  label: string;
  hint: string;
  Icon: typeof PencilSimple;
  /** 图标底/字色（功能色语义，四入口彼此区分） */
  tintBg: string;
  tintFg: string;
}[] = [
  { key: "write", label: "随手写", hint: "写点想法，支持 Markdown", Icon: PencilSimple, tintBg: "var(--red-soft)", tintFg: "var(--red)" },
  { key: "link", label: "链接导入", hint: "粘贴网址，自动抓取正文", Icon: LinkSimple, tintBg: "var(--info-soft)", tintFg: "var(--info)" },
  { key: "image", label: "图片", hint: "上传截图或图片，挂成笔记", Icon: ImageIcon, tintBg: "var(--ok-soft)", tintFg: "var(--ok)" },
  { key: "attach", label: "附件", hint: "PDF / DOCX / TXT 等文件", Icon: Paperclip, tintBg: "var(--warn-soft)", tintFg: "var(--warn)" },
];

// ── 「记一条」智能化选项 ──────────────────────────────────────────
// 归入笔记本 / 标签多选 / 快捷关联课程 三组数据，由 GET /api/notes/compose-options 一次拉齐。
export interface ComposeNotebookOpt { id: string; title: string; icon: string | null }
export interface ComposeTagOpt { id: string; name: string; color: string }
export interface ComposeCourseOpt { id: string; slug: string; title: string }
export interface ComposeOptions {
  notebooks: ComposeNotebookOpt[];
  tags: ComposeTagOpt[];
  courses: ComposeCourseOpt[];
}

/**
 * 弹窗打开时按需拉取 compose-options（client 只 fetch，不 import server 链）。
 * 未打开时不请求；每次打开都重取，保证新建笔记本/标签后下拉即时刷新。
 */
function useComposeOptions(open: boolean) {
  const [opts, setOpts] = useState<ComposeOptions>({ notebooks: [], tags: [], courses: [] });
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/notes/compose-options").then((r) => r.json());
      if (res.ok) setOpts(res.data as ComposeOptions);
    } catch {
      /* 拉取失败静默：三控件降级为「仅可现场创建标签/不选笔记本课程」，不阻塞记一条主流程 */
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);
  // 现场新建标签后把它并入本地 tags（避免整段重拉），供 WritePanel 立即勾选。
  const addLocalTag = useCallback((t: ComposeTagOpt) => {
    setOpts((prev) =>
      prev.tags.some((x) => x.id === t.id) ? prev : { ...prev, tags: [...prev.tags, t] },
    );
  }, []);
  return { opts, loading, addLocalTag };
}

/**
 * 采集面板：四入口 [随手写][链接导入][图片][附件]。
 * - 随手写：POST /api/notes source=manual（v3.1 智能化：可选笔记本 / 标签多选 / 快捷关联课程）。
 * - 链接导入：POST /api/notes/import-url，服务端抓取正文落库。
 * - 图片 / 附件：POST /api/notes/attachments（multipart），存私有目录并通过本人鉴权 API 读取。
 *
 * prefillNotebookId：笔记本详情页「在此笔记本记一条」预填该笔记本（弹窗仅走随手写，直接落入该本）。
 * 导出：供笔记本详情页的 client 包装组件（NotebookComposeButton）复用同一弹窗。
 */
export function ComposeDialog({
  open,
  onClose,
  onCreated,
  prefillNotebookId,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (noteId?: string) => void;
  prefillNotebookId?: string;
}) {
  const [entry, setEntry] = useState<CaptureEntry>("menu");
  const { opts, addLocalTag } = useComposeOptions(open);

  // 打开时回到入口选择面板；带 prefillNotebookId（来自笔记本详情页）时直接进「随手写」。
  useEffect(() => {
    if (open) setEntry(prefillNotebookId ? "write" : "menu");
  }, [open, prefillNotebookId]);

  const activeMeta = ENTRY_META.find((e) => e.key === entry);
  const dialogTitle = entry === "menu" ? "记一条" : activeMeta?.label ?? "记一条";

  return (
    <Dialog open={open} onClose={onClose} title={dialogTitle}>
      {/* 非入口页顶部：返回选择（预填笔记本时不显示，避免误跳出定向写入流） */}
      {entry !== "menu" && !prefillNotebookId && (
        <button
          type="button"
          onClick={() => setEntry("menu")}
          className="mb-3 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--ink3)] transition-colors hover:text-[var(--ink)]"
        >
          <ArrowLeft size={13} weight="bold" /> 换个方式
        </button>
      )}

      {entry === "menu" && (
        <div className="stagger grid grid-cols-2 gap-2.5">
          {ENTRY_META.map(({ key, label, hint, Icon, tintBg, tintFg }, i) => (
            <button
              key={key}
              type="button"
              onClick={() => setEntry(key)}
              style={{ "--i": i } as React.CSSProperties}
              className="hover-sheen studio-lift group flex flex-col items-start gap-2 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4 text-left shadow-[var(--card),var(--inner-hi)]"
            >
              <span
                className="inline-flex h-10 w-10 items-center justify-center rounded-[12px] transition-transform duration-200 group-hover:scale-105"
                style={{ background: tintBg, color: tintFg }}
              >
                <Icon size={19} weight="bold" />
              </span>
              <span className="text-[14px] font-semibold text-[var(--ink)]">{label}</span>
              <span className="text-[12px] leading-[1.5] text-[var(--ink4)]">{hint}</span>
            </button>
          ))}
        </div>
      )}

      {entry === "write" && (
        <WritePanel
          onCreated={onCreated}
          options={opts}
          onTagCreated={addLocalTag}
          prefillNotebookId={prefillNotebookId}
        />
      )}
      {entry === "link" && <LinkImportPanel onCreated={onCreated} />}
      {entry === "image" && <UploadPanel kind="image" onCreated={onCreated} />}
      {entry === "attach" && <UploadPanel kind="attach" onCreated={onCreated} />}
    </Dialog>
  );
}

/**
 * 随手写（v3.1 智能化）：title + contentMd + 归入笔记本 + 标签多选 + 快捷关联课程
 * → 一次 POST /api/notes（source=manual，带 notebookId?/tagIds?/courseId?）。
 * 标签支持现场新建：POST /api/note-tags upsert 拿到 id 后并入本地并自动勾选。
 * 越权隔离由后端负责：notebookId/tagIds/courseId 均按 userId 二次校验（route 已实现）。
 */
function WritePanel({
  onCreated,
  options,
  onTagCreated,
  prefillNotebookId,
}: {
  onCreated: (id?: string) => void;
  options: ComposeOptions;
  onTagCreated: (t: ComposeTagOpt) => void;
  prefillNotebookId?: string;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [contentMd, setContentMd] = useState("");
  const [saving, setSaving] = useState(false);

  // 三组智能化选择态
  const [notebookId, setNotebookId] = useState<string>(prefillNotebookId ?? "");
  const [courseId, setCourseId] = useState<string>("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [creatingTag, setCreatingTag] = useState(false);

  // 预填笔记本变化（不同笔记本详情页复用同一弹窗）时同步默认归属
  useEffect(() => {
    setNotebookId(prefillNotebookId ?? "");
  }, [prefillNotebookId]);

  function toggleTag(id: string) {
    setSelectedTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  // 现场新建标签：note-tags 幂等 upsert；成功后并入本地选项并自动勾选。
  async function createTag() {
    const name = newTag.trim();
    if (!name) return;
    if (name.length > 20) return toast("标签名过长（≤20 字）", { tone: "warn" });
    // 已存在同名则直接勾选，不重复建
    const existing = options.tags.find((t) => t.name === name);
    if (existing) {
      if (!selectedTagIds.includes(existing.id)) toggleTag(existing.id);
      setNewTag("");
      return;
    }
    setCreatingTag(true);
    try {
      const res = await fetch("/api/note-tags", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      }).then((r) => r.json());
      if (!res.ok) return toast(res.error ?? "标签创建失败", { tone: "warn" });
      const tag: ComposeTagOpt = { id: res.data.id, name: res.data.name, color: res.data.color };
      onTagCreated(tag);
      setSelectedTagIds((prev) => (prev.includes(tag.id) ? prev : [...prev, tag.id]));
      setNewTag("");
    } catch {
      toast("标签创建失败，请稍后重试", { tone: "warn" });
    } finally {
      setCreatingTag(false);
    }
  }

  async function submit() {
    if (!contentMd.trim()) return toast("笔记内容不能为空", { tone: "warn" });
    setSaving(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || undefined,
          contentMd: contentMd.trim(),
          // 仅在有值时带上，避免污染独立笔记的空归属语义
          ...(notebookId ? { notebookId } : {}),
          ...(courseId ? { courseId } : {}),
          ...(selectedTagIds.length > 0 ? { tagIds: selectedTagIds } : {}),
        }),
      }).then((r) => r.json());
      if (!res.ok) return toast(res.error ?? "保存失败", { tone: "warn" });
      track("note_create", {
        source: "manual",
        has_notebook: !!notebookId,
        tag_count: selectedTagIds.length,
        has_course: !!courseId,
      });
      toast("已记下", { tone: "success" });
      onCreated(res.data?.id);
    } catch {
      toast("保存失败，请稍后重试", { tone: "warn" });
    } finally {
      setSaving(false);
    }
  }

  return (
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
        rows={6}
        className="w-full resize-y rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-[14px] leading-[1.7] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--ink3)]"
      />

      {/* 归入笔记本 + 快捷关联课程：两个下拉并排 */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--ink3)]">
            <BookBookmark size={13} weight="fill" className="text-[var(--ink4)]" /> 归入笔记本
          </span>
          <select
            value={notebookId}
            onChange={(e) => setNotebookId(e.target.value)}
            className="min-h-[44px] rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[13px] text-[var(--ink)] outline-none transition-colors focus:border-[var(--ink3)]"
          >
            <option value="">未归类</option>
            {options.notebooks.map((nb) => (
              <option key={nb.id} value={nb.id}>
                {nb.icon ? `${nb.icon} ` : ""}
                {nb.title}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--ink3)]">
            <GraduationCap size={13} weight="fill" className="text-[var(--ink4)]" /> 关联课程
          </span>
          <select
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
            disabled={options.courses.length === 0}
            className="min-h-[44px] rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[13px] text-[var(--ink)] outline-none transition-colors focus:border-[var(--ink3)] disabled:opacity-55"
          >
            <option value="">{options.courses.length === 0 ? "暂无在学课程" : "不关联"}</option>
            {options.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* 标签多选：已有标签作可勾选胶囊 + 现场新建 */}
      <div className="flex flex-col gap-2">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--ink3)]">
          <Tag size={13} weight="fill" className="text-[var(--ink4)]" /> 标签
        </span>
        {options.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {options.tags.map((t) => {
              const active = selectedTagIds.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTag(t.id)}
                  className={`inline-flex min-h-[32px] items-center gap-1 rounded-full px-3 py-1 text-[13px] font-medium transition-colors ${
                    active
                      ? "border border-[var(--red-soft-border)] bg-[var(--red-soft)] text-[var(--red)]"
                      : "border border-[var(--border)] bg-[var(--surface)] text-[var(--ink3)] hover:text-[var(--ink)]"
                  }`}
                >
                  {active && <Check size={12} weight="bold" />}
                  {t.name}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (!creatingTag) void createTag();
              }
            }}
            placeholder="新建标签，回车添加"
            maxLength={20}
            className="min-h-[40px] flex-1 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--ink3)]"
          />
          <button
            type="button"
            onClick={() => void createTag()}
            disabled={creatingTag || !newTag.trim()}
            className="studio-press inline-flex min-h-[40px] items-center gap-1 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] font-semibold text-[var(--ink2)] transition-colors hover:text-[var(--ink)] disabled:opacity-55"
          >
            {creatingTag ? <CircleNotch size={13} weight="bold" className="animate-spin" /> : <Plus size={13} weight="bold" />}
            添加
          </button>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] pt-3">
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
  );
}

/** 链接导入：url → POST /api/notes/import-url，服务端抓取正文。 */
function LinkImportPanel({ onCreated }: { onCreated: (id?: string) => void }) {
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const v = url.trim();
    if (!v) return toast("请输入链接", { tone: "warn" });
    setBusy(true);
    try {
      const res = await fetch("/api/notes/import-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: v }),
      }).then((r) => r.json());
      if (!res.ok) return toast(res.error ?? "导入失败", { tone: "warn" });
      track("note_import_url", {});
      toast("已导入网页正文", { tone: "success" });
      onCreated(res.data?.id);
    } catch {
      toast("导入失败，请稍后重试", { tone: "warn" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && !busy && submit()}
        placeholder="https://…"
        type="url"
        inputMode="url"
        className="mono w-full rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-[13px] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--ink3)]"
      />
      <p className="text-[12px] leading-[1.6] text-[var(--ink4)]">
        仅支持 http/https 公网链接，自动提取标题与正文（约 10 秒内完成）。
      </p>
      <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] pt-3">
        <button
          type="button"
          onClick={submit}
          disabled={busy || !url.trim()}
          className="studio-press inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-4 py-2 text-[13px] font-semibold text-[var(--red)] transition-colors disabled:opacity-55"
        >
          {busy ? <CircleNotch size={14} weight="bold" className="animate-spin" /> : <LinkSimple size={14} weight="bold" />}
          {busy ? "抓取中…" : "导入"}
        </button>
      </div>
    </div>
  );
}

// 前端可接受的 MIME（与后端 route.ts ALLOWED 保持一致，越权/类型拦截在服务端仍会二次校验）
const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const FILE_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
  "text/markdown",
]);
// 部分系统对 .md/.docx 给不出 type，落回扩展名兜底校验
const FILE_EXT = new Set(["pdf", "docx", "doc", "txt", "md"]);
const MAX_UPLOAD = 10 * 1024 * 1024;

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 客户端预检：类型/大小不符直接给出具体原因（拦在上传前，省一次失败往返）。返回 null 表示通过。 */
function precheck(f: File, kind: "image" | "attach"): string | null {
  if (f.size === 0) return "文件内容为空";
  if (f.size > MAX_UPLOAD) return `文件 ${humanSize(f.size)} 超过 10MB 上限`;
  const ext = extOf(f.name);
  if (kind === "image") {
    if (!IMAGE_MIME.has(f.type) && !["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) {
      return "仅支持 PNG / JPG / WEBP / GIF 图片";
    }
  } else {
    if (!FILE_MIME.has(f.type) && !FILE_EXT.has(ext)) {
      return "仅支持 PDF / DOCX / DOC / TXT / MD 文件";
    }
  }
  return null;
}

type UploadPhase =
  | { s: "idle" }
  | { s: "picked"; file: File }
  | { s: "uploading"; file: File; pct: number }
  | { s: "done"; noteId?: string; attachment: { fileName: string; mimeType: string; path: string; size: number } }
  | { s: "error"; file: File; message: string };

/**
 * 图片 / 附件上传：拖拽 + 点击 + 粘贴三入口 → POST /api/notes/attachments（multipart）。
 *
 * 修复原「服务异常」根因：
 *  1) 原实现用 `.then(r => r.json())`，遇到非 JSON 响应（413 体积超限 / 500 HTML / 网络中断）
 *     会在 json() 处抛错，被 catch 吞成笼统「上传失败」，后端真实原因看不到。
 *     现改用 XHR，按 HTTP status 兜底文案，并优先透传后端 `{ ok:false, error }` 的 error。
 *  2) multipart 绝不手动设 Content-Type —— 交给浏览器带上 boundary（手动设会破坏解析，
 *     后端 formData() 拿不到 file → 「缺少上传文件」）。XHR 不 setRequestHeader 即天然正确。
 * 边界：本组件为 client，只 fetch 自有 API，不引任何 server 链。
 */
function UploadPanel({ kind, onCreated }: { kind: "image" | "attach"; onCreated: (id?: string) => void }) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [phase, setPhase] = useState<UploadPhase>({ s: "idle" });
  const [dragging, setDragging] = useState(false);

  const accept = kind === "image" ? "image/png,image/jpeg,image/webp,image/gif" : ".pdf,.docx,.doc,.txt,.md";
  const hint =
    kind === "image"
      ? "拖入、点击或粘贴图片。PNG / JPG / WEBP / GIF，≤10MB，将自动挂成一条笔记。"
      : "拖入或点击选择文件。PDF / DOCX / TXT / MD，≤10MB，文本类会自动抽取前 2000 字预览。";

  // 卸载时中止在途请求并回收预览 objectURL，避免内存泄漏
  useEffect(() => {
    return () => {
      xhrRef.current?.abort();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const revokePreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  // 选定一个文件：预检 → 直接进入上传（拖/粘/点都走这里，体验一致）
  function accept_(f: File | null | undefined) {
    if (!f) return;
    const err = precheck(f, kind);
    if (err) {
      toast(err, { tone: "warn" });
      setPhase({ s: "error", file: f, message: err });
      return;
    }
    upload(f);
  }

  function upload(file: File) {
    revokePreview();
    setPhase({ s: "uploading", file, pct: 0 });

    const fd = new FormData();
    fd.append("file", file);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("POST", "/api/notes/attachments");
    // 关键：不 setRequestHeader("Content-Type", ...) —— 让浏览器自带 multipart boundary。

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.min(99, Math.round((e.loaded / e.total) * 100));
      setPhase((p) => (p.s === "uploading" ? { ...p, pct } : p));
    };

    xhr.onload = () => {
      xhrRef.current = null;
      // 优先解析后端 JSON body（含真实 error）；非 JSON 时按状态码兜底
      type AttachmentDto = { fileName: string; mimeType: string; size: number; path: string; summary: string | null };
      type UploadResp = { ok?: boolean; error?: string; data?: { noteId?: string; attachment?: AttachmentDto } };
      let body: UploadResp | null = null;
      try {
        body = JSON.parse(xhr.responseText) as UploadResp;
      } catch {
        body = null;
      }

      if (xhr.status >= 200 && xhr.status < 300 && body?.ok && body.data?.attachment) {
        const att = body.data.attachment;
        setPhase({
          s: "done",
          noteId: body.data.noteId,
          attachment: { fileName: att.fileName, mimeType: att.mimeType, path: att.path, size: att.size },
        });
        track("note_attachment", { is_image: kind === "image" });
        toast("已上传并保存", { tone: "success" });
        onCreated(body.data.noteId);
        return;
      }

      // 失败：透传后端 error，退而求其次按状态码给具体文案（不再是笼统「服务异常」）
      const msg =
        body?.error ??
        (xhr.status === 413
          ? "文件过大，请压缩后重试（≤10MB）"
          : xhr.status === 401
            ? "登录已过期，请重新登录后再上传"
            : xhr.status === 402
              ? "已达免费笔记上限，订阅后可无限记录"
              : xhr.status === 429
                ? "上传太频繁，请稍后再试"
                : xhr.status === 0
                  ? "网络中断，请检查连接后重试"
                  : `上传失败（HTTP ${xhr.status}）`);
      setPhase({ s: "error", file, message: msg });
      toast(msg, { tone: "warn" });
    };

    xhr.onerror = () => {
      xhrRef.current = null;
      const msg = "网络错误，上传未完成，请重试";
      setPhase({ s: "error", file, message: msg });
      toast(msg, { tone: "warn" });
    };

    xhr.onabort = () => {
      xhrRef.current = null;
    };

    xhr.send(fd);
  }

  // ---- 拖拽 ----
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    if (phase.s === "uploading") return;
    if (!dragging) setDragging(true);
  }
  function onDragLeave(e: React.DragEvent) {
    // 仅当离开容器本身（而非子元素）时才灭高亮
    if (dropRef.current && !dropRef.current.contains(e.relatedTarget as Node)) setDragging(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (phase.s === "uploading") return;
    accept_(e.dataTransfer.files?.[0]);
  }
  // ---- 粘贴（贴图/贴文件）----
  function onPaste(e: React.ClipboardEvent) {
    if (phase.s === "uploading") return;
    const item = Array.from(e.clipboardData.items).find((it) => it.kind === "file");
    const f = item?.getAsFile();
    if (f) {
      e.preventDefault();
      accept_(f);
    }
  }

  const busy = phase.s === "uploading";
  const done = phase.s === "done" ? phase : null;
  const isDoneImage = done ? done.attachment.mimeType.startsWith("image/") : false;

  return (
    <div className="space-y-3" onPaste={onPaste}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          accept_(e.target.files?.[0] ?? null);
          e.target.value = ""; // 允许连续选同一文件重试
        }}
      />

      {/* 成功态：缩略图 / 文件卡 + 再传一个 */}
      {done ? (
        <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--card),var(--inner-hi)]">
          <div className="flex items-center gap-3">
            {isDoneImage ? (

              <img
                src={done.attachment.path}
                alt={done.attachment.fileName}
                className="h-14 w-14 shrink-0 rounded-[10px] border border-[var(--border)] object-cover"
              />
            ) : (
              <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-[10px] bg-[var(--surface-inset)] text-[var(--ink3)]">
                <FileText size={24} weight="bold" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-[var(--ink)]">{done.attachment.fileName}</p>
              <p className="mono mt-0.5 flex items-center gap-1.5 text-[12px] text-[var(--ok)]">
                <Check size={13} weight="bold" /> 已保存 · {humanSize(done.attachment.size)}
              </p>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-end gap-2 border-t border-[var(--border)] pt-3">
            <button
              type="button"
              onClick={() => {
                revokePreview();
                setPhase({ s: "idle" });
              }}
              className="studio-press inline-flex min-h-[44px] items-center gap-1.5 rounded-[10px] border border-[var(--border2)] bg-[var(--surface)] px-4 text-[13px] font-semibold text-[var(--ink2)] transition-colors hover:border-[var(--ink3)]"
            >
              <Plus size={14} weight="bold" /> 再传一个
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* 拖拽 / 点击 命中区（≥44px；拖入高亮）。上传中/错误也在此区内渲染状态。 */}
          <div
            ref={dropRef}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            role="button"
            tabIndex={0}
            aria-label={kind === "image" ? "上传图片" : "上传附件"}
            aria-disabled={busy}
            onClick={() => !busy && inputRef.current?.click()}
            onKeyDown={(e) => {
              if (busy) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            className={`flex min-h-[44px] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed px-4 py-8 text-center transition-colors ${
              dragging
                ? "border-[var(--red)] bg-[var(--red-soft)]"
                : phase.s === "error"
                  ? "border-[var(--warn)] bg-[var(--warn-soft)]"
                  : "border-[var(--border2)] bg-[var(--surface-inset)] hover:border-[var(--ink3)]"
            }`}
          >
            {busy && phase.s === "uploading" ? (
              <>
                <CircleNotch size={26} weight="bold" className="animate-spin text-[var(--red)]" />
                <span className="mono max-w-full truncate text-[13px] text-[var(--ink)]">{phase.file.name}</span>
                {/* 进度条 */}
                <div className="mt-1 h-1.5 w-40 max-w-full overflow-hidden rounded-full bg-[var(--border2)]">
                  <div
                    className="h-full rounded-full bg-[var(--red)] transition-[width] duration-200"
                    style={{ width: `${phase.pct}%` }}
                  />
                </div>
                <span className="mono text-[12px] text-[var(--ink3)]">上传中 {phase.pct}%</span>
              </>
            ) : phase.s === "error" ? (
              <>
                <Warning size={26} weight="fill" className="text-[var(--warn)]" />
                <span className="text-[13px] font-semibold text-[var(--warn)]">上传失败</span>
                <span className="max-w-full text-[12px] leading-[1.5] text-[var(--ink2)]">{phase.message}</span>
              </>
            ) : (
              <>
                <span className="inline-flex h-11 w-11 items-center justify-center text-[var(--ink3)]">
                  <UploadSimple size={26} weight="bold" />
                </span>
                <span className="text-[13px] font-semibold text-[var(--ink2)]">拖入文件，或点击选择</span>
                <span className="text-[12px] leading-[1.5] text-[var(--ink4)]">{hint}</span>
              </>
            )}
          </div>

          {/* 底部操作条：上传中→取消；错误→重试；空闲→选择文件 */}
          <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] pt-3">
            {phase.s === "uploading" ? (
              <button
                type="button"
                onClick={() => xhrRef.current?.abort()}
                className="studio-press inline-flex min-h-[44px] items-center gap-1.5 rounded-[10px] border border-[var(--border2)] bg-[var(--surface)] px-4 text-[13px] font-semibold text-[var(--ink2)] transition-colors hover:border-[var(--ink3)]"
              >
                <XIcon size={14} weight="bold" /> 取消
              </button>
            ) : phase.s === "error" ? (
              <button
                type="button"
                onClick={() => upload(phase.file)}
                className="studio-press inline-flex min-h-[44px] items-center gap-1.5 rounded-[10px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-4 text-[13px] font-semibold text-[var(--red)] transition-colors"
              >
                <ArrowClockwise size={14} weight="bold" /> 重试
              </button>
            ) : (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="studio-press inline-flex min-h-[44px] items-center gap-1.5 rounded-[10px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-4 text-[13px] font-semibold text-[var(--red)] transition-colors"
              >
                <Paperclip size={14} weight="bold" /> 选择文件
              </button>
            )}
          </div>
        </>
      )}
    </div>
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
      <div className="stagger grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((n, i) => (
          <Link
            key={n.id}
            href={`/notes/${n.id}`}
            style={{ "--i": i } as React.CSSProperties}
            className="hover-sheen studio-lift group block rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card),var(--inner-hi)]"
          >
            <div className="mb-1.5 flex items-center gap-2 text-[12px] text-[var(--ink4)]">
              <span className="truncate">{n.lesson?.title ?? "课程笔记"}</span>
              {n.starred && <Star size={12} weight="fill" className="ml-auto shrink-0 text-[var(--red)]" />}
            </div>
            {n.title && <p className="font-semibold text-[var(--ink)] transition-colors group-hover:text-[var(--red)]">{n.title}</p>}
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
