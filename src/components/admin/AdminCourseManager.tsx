"use client";

import { useEffect, useState } from "react";
import { LoadingSkeleton, ErrorState, Badge } from "@/components/ui";

interface AdminCourse {
  id: string; title: string; category: string; level: string; status: string;
  instructorName: string | null; reviewerName: string | null;
  _count: { lessons: number; updateLogs: number };
}

const STATUS_OPTS = ["draft", "beta", "published", "archived"];
const STATUS_LABEL: Record<string, string> = { draft: "草稿", beta: "内测", published: "已发布", archived: "已下架" };
const CATS: Record<string, string> = { ai_skill: "AI技能", exam: "备考", life: "生活" };

export function AdminCourseManager() {
  const [courses, setCourses] = useState<AdminCourse[] | null>(null);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", category: "ai_skill", level: "L1", instructorName: "", reviewerName: "" });
  const [creating, setCreating] = useState(false);

  async function load() {
    setError(false);
    try {
      const json = await fetch("/api/admin/courses").then((r) => r.json());
      if (!json.ok) throw new Error();
      setCourses(json.data.courses);
    } catch { setError(true); }
  }
  useEffect(() => { load(); }, []);

  async function createCourse(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    await fetch("/api/admin/courses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
    setForm({ title: "", category: "ai_skill", level: "L1", instructorName: "", reviewerName: "" });
    setCreating(false);
    load();
  }

  async function setStatus(id: string, status: string) {
    await fetch(`/api/admin/courses/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    load();
  }

  if (error) return <ErrorState hint="课程加载失败" onRetry={load} />;
  if (courses === null) return <LoadingSkeleton lines={6} />;

  return (
    <div className="space-y-6">
      {/* 新建课程 */}
      <form onSubmit={createCourse} className="rounded-2xl border border-ink-100 bg-paper-raised p-5">
        <h2 className="mb-3 font-medium text-ink-950">新建课程（草稿）</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="课程标题 *" className="rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-accent-400" />
          <input value={form.instructorName} onChange={(e) => setForm({ ...form, instructorName: e.target.value })} placeholder="讲师" className="rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-accent-400" />
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="rounded-lg border border-ink-200 px-3 py-2 text-sm">
            {Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} className="rounded-lg border border-ink-200 px-3 py-2 text-sm">
            {["L1", "L2", "L3"].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <input value={form.reviewerName} onChange={(e) => setForm({ ...form, reviewerName: e.target.value })} placeholder="审核人（健康/防诈骗必填）" className="rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-accent-400 sm:col-span-2" />
        </div>
        <button disabled={creating} className="mt-3 rounded-lg bg-accent-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50">{creating ? "创建中…" : "创建课程"}</button>
      </form>

      {/* 课程列表 */}
      <div className="space-y-2">
        {courses.map((c) => (
          <div key={c.id} className="rounded-2xl border border-ink-100 bg-paper-raised">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink-950">{c.title}</span>
                  <Badge tone="muted">{CATS[c.category] ?? c.category}</Badge>
                  <Badge tone="muted">{c.level}</Badge>
                </div>
                <p className="mt-1 text-xs text-ink-400">
                  {c._count.lessons} 章 · {c._count.updateLogs} 条更新日志 · 讲师 {c.instructorName ?? "—"}
                  {c.reviewerName && ` · 审核 ${c.reviewerName}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select value={c.status} onChange={(e) => setStatus(c.id, e.target.value)} className="rounded-lg border border-ink-200 px-2 py-1.5 text-sm">
                  {STATUS_OPTS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
                <button onClick={() => setExpanded(expanded === c.id ? null : c.id)} className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm hover:border-accent-400">
                  {expanded === c.id ? "收起" : "管理"}
                </button>
              </div>
            </div>
            {expanded === c.id && <CourseInlinePanel courseId={c.id} onDone={load} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function CourseInlinePanel({ courseId, onDone }: { courseId: string; onDone: () => void }) {
  const [lesson, setLesson] = useState({ title: "", durationSec: 600, isFree: false, contentType: "video" });
  const [log, setLog] = useState({ updateType: "added", title: "", description: "" });
  const [busy, setBusy] = useState(false);

  async function addLesson() {
    setBusy(true);
    await fetch(`/api/admin/courses/${courseId}/lessons`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(lesson) });
    setLesson({ title: "", durationSec: 600, isFree: false, contentType: "video" });
    setBusy(false);
    onDone();
  }
  async function addLog() {
    setBusy(true);
    await fetch(`/api/admin/course-update-logs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ courseId, ...log }) });
    setLog({ updateType: "added", title: "", description: "" });
    setBusy(false);
    onDone();
  }

  return (
    <div className="grid gap-4 border-t border-ink-100 p-4 sm:grid-cols-2">
      <div>
        <p className="mb-2 text-sm font-medium text-ink-950">新增章节</p>
        <div className="space-y-2">
          <input value={lesson.title} onChange={(e) => setLesson({ ...lesson, title: e.target.value })} placeholder="章节标题" className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-accent-400" />
          <div className="flex items-center gap-2">
            <input type="number" value={lesson.durationSec} onChange={(e) => setLesson({ ...lesson, durationSec: Number(e.target.value) })} className="w-24 rounded-lg border border-ink-200 px-2 py-1.5 text-sm" />
            <span className="text-xs text-ink-400">秒</span>
            <select value={lesson.contentType} onChange={(e) => setLesson({ ...lesson, contentType: e.target.value })} className="rounded-lg border border-ink-200 px-2 py-1.5 text-sm">
              <option value="video">视频</option><option value="article">图文</option>
            </select>
            <label className="flex items-center gap-1 text-xs text-ink-500"><input type="checkbox" checked={lesson.isFree} onChange={(e) => setLesson({ ...lesson, isFree: e.target.checked })} className="accent-accent-600" />免费试看</label>
          </div>
          <button disabled={busy || !lesson.title} onClick={addLesson} className="rounded-lg bg-accent-600 px-4 py-1.5 text-sm text-white disabled:opacity-50">添加章节</button>
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-ink-950">新增更新日志</p>
        <div className="space-y-2">
          <div className="flex gap-2">
            <select value={log.updateType} onChange={(e) => setLog({ ...log, updateType: e.target.value })} className="rounded-lg border border-ink-200 px-2 py-2 text-sm">
              <option value="added">新增</option><option value="revised">修订</option><option value="fixed">纠错</option><option value="removed">删除</option>
            </select>
            <input value={log.title} onChange={(e) => setLog({ ...log, title: e.target.value })} placeholder="更新标题" className="flex-1 rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-accent-400" />
          </div>
          <input value={log.description} onChange={(e) => setLog({ ...log, description: e.target.value })} placeholder="更新说明" className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-accent-400" />
          <button disabled={busy || !log.title} onClick={addLog} className="rounded-lg bg-accent-600 px-4 py-1.5 text-sm text-white disabled:opacity-50">发布日志</button>
        </div>
      </div>
    </div>
  );
}
