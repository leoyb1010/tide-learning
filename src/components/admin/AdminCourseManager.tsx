"use client";

import { useEffect, useState } from "react";
import { LoadingSkeleton, ErrorState, Badge } from "@/components/ui";
import { useToast } from "@/components/Toast";

interface AdminCourse {
  id: string; title: string; subtitle: string | null; description: string | null;
  category: string; level: string; status: string;
  instructorName: string | null; reviewerName: string | null;
  _count: { lessons: number; updateLogs: number };
}

const STATUS_OPTS = ["draft", "beta", "published", "archived"];
const STATUS_LABEL: Record<string, string> = { draft: "草稿", beta: "内测", published: "已发布", archived: "已下架" };
const CATS: Record<string, string> = { ai_skill: "AI技能", exam: "备考", life: "生活" };

export function AdminCourseManager() {
  const { toast } = useToast();
  const [courses, setCourses] = useState<AdminCourse[] | null>(null);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", subtitle: "", description: "", category: "ai_skill", level: "L1", instructorName: "", reviewerName: "" });
  const [creating, setCreating] = useState(false);
  const [drafting, setDrafting] = useState(false);

  // AI 起草：按当前标题/分类调 LLM 生成简介与副标题，回填到 description / subtitle。
  // AI 可能返回错误（402 余额不足 / 503 未配置），一律 toast 提示、不崩溃。
  async function aiDraft() {
    if (!form.title.trim()) { toast("请先填写课程标题", { tone: "warn" }); return; }
    setDrafting(true);
    try {
      const json = await fetch("/api/admin/ai/course-draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: form.title.trim(), category: form.category }),
      }).then((r) => r.json());
      if (!json.ok) { toast(json.error ?? "AI 起草失败", { tone: "warn" }); return; }
      const { intro, subtitle } = json.data;
      setForm((f) => ({ ...f, description: intro ?? f.description, subtitle: subtitle ?? f.subtitle }));
      toast("已填入 AI 起草的简介与副标题", { tone: "success" });
    } catch {
      toast("AI 起草失败，请稍后重试", { tone: "warn" });
    } finally {
      setDrafting(false);
    }
  }

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
    setForm({ title: "", subtitle: "", description: "", category: "ai_skill", level: "L1", instructorName: "", reviewerName: "" });
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
          <input value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} placeholder="副标题" className="rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-accent-400 sm:col-span-2" />
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="课程简介" rows={3} className="rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-accent-400 sm:col-span-2" />
          <input value={form.reviewerName} onChange={(e) => setForm({ ...form, reviewerName: e.target.value })} placeholder="审核人（健康/防诈骗必填）" className="rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-accent-400 sm:col-span-2" />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button disabled={creating} className="rounded-lg bg-accent-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50">{creating ? "创建中…" : "创建课程"}</button>
          {/* AI 起草：按标题+分类生成简介/副标题并回填（type=button 避免触发表单提交） */}
          <button type="button" onClick={aiDraft} disabled={drafting} className="rounded-lg border border-ink-200 px-4 py-2 text-sm font-medium text-ink-700 hover:border-accent-400 disabled:opacity-50">{drafting ? "AI 起草中…" : "AI 起草"}</button>
        </div>
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
                <button onClick={() => setEditing(editing === c.id ? null : c.id)} className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm hover:border-accent-400">
                  {editing === c.id ? "取消编辑" : "编辑"}
                </button>
                <button onClick={() => setExpanded(expanded === c.id ? null : c.id)} className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm hover:border-accent-400">
                  {expanded === c.id ? "收起" : "管理"}
                </button>
              </div>
            </div>
            {editing === c.id && <CourseEditForm course={c} onDone={() => { setEditing(null); load(); }} />}
            {expanded === c.id && <CourseInlinePanel courseId={c.id} onDone={load} />}
          </div>
        ))}
      </div>
    </div>
  );
}

// 二次编辑：改课程 title/subtitle/description（调 PATCH /api/admin/courses/[id]）。
function CourseEditForm({ course, onDone }: { course: AdminCourse; onDone: () => void }) {
  const [edit, setEdit] = useState({
    title: course.title,
    subtitle: course.subtitle ?? "",
    description: course.description ?? "",
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await fetch(`/api/admin/courses/${course.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(edit),
    });
    setSaving(false);
    onDone();
  }

  return (
    <div className="grid gap-3 border-t border-ink-100 p-4">
      <p className="text-sm font-medium text-ink-950">编辑课程信息</p>
      <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="课程标题 *" className="rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-accent-400" />
      <input value={edit.subtitle} onChange={(e) => setEdit({ ...edit, subtitle: e.target.value })} placeholder="副标题" className="rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-accent-400" />
      <textarea value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} placeholder="课程简介" rows={3} className="rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-accent-400" />
      <div>
        <button disabled={saving || !edit.title.trim()} onClick={save} className="rounded-lg bg-accent-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? "保存中…" : "保存修改"}</button>
      </div>
    </div>
  );
}

function CourseInlinePanel({ courseId, onDone }: { courseId: string; onDone: () => void }) {
  const [lesson, setLesson] = useState({ title: "", summary: "", durationSec: 600, isFree: false, contentType: "video", articleMd: "" });
  const [log, setLog] = useState({ updateType: "added", title: "", description: "" });
  const [busy, setBusy] = useState(false);
  // 上传得到的视频资源占位 id + 提示文案（mock 上传拿到后建章节时作为 videoAssetId 提交）
  const [videoAssetId, setVideoAssetId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadHint, setUploadHint] = useState("");

  // mock 上传：POST 到 /api/admin/upload，拿到占位 assetId 备用
  async function uploadVideo(file: File) {
    setUploading(true);
    setUploadHint("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const json = await fetch("/api/admin/upload", { method: "POST", body: fd }).then((r) => r.json());
      if (json.ok && json.data?.assetId) {
        setVideoAssetId(json.data.assetId);
        setUploadHint(`已上传：${file.name}（${json.data.assetId}）`);
      } else {
        setUploadHint(json.error ?? "上传失败");
      }
    } catch {
      setUploadHint("上传失败，请重试");
    }
    setUploading(false);
  }

  async function addLesson() {
    setBusy(true);
    // 提交章节：视频类型带上上传得到的 videoAssetId（没有则由后端生成占位）
    const payload = lesson.contentType === "video" && videoAssetId ? { ...lesson, videoAssetId } : lesson;
    await fetch(`/api/admin/courses/${courseId}/lessons`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    setLesson({ title: "", summary: "", durationSec: 600, isFree: false, contentType: "video", articleMd: "" });
    setVideoAssetId("");
    setUploadHint("");
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
          <input value={lesson.summary} onChange={(e) => setLesson({ ...lesson, summary: e.target.value })} placeholder="章节摘要" className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-accent-400" />
          <div className="flex items-center gap-2">
            <input type="number" value={lesson.durationSec} onChange={(e) => setLesson({ ...lesson, durationSec: Number(e.target.value) })} className="w-24 rounded-lg border border-ink-200 px-2 py-1.5 text-sm" />
            <span className="text-xs text-ink-400">秒</span>
            <select value={lesson.contentType} onChange={(e) => setLesson({ ...lesson, contentType: e.target.value })} className="rounded-lg border border-ink-200 px-2 py-1.5 text-sm">
              <option value="video">视频</option><option value="article">图文</option>
            </select>
            <label className="flex items-center gap-1 text-xs text-ink-500"><input type="checkbox" checked={lesson.isFree} onChange={(e) => setLesson({ ...lesson, isFree: e.target.checked })} className="accent-accent-600" />免费试看</label>
          </div>
          {/* 图文章节：Markdown 正文 */}
          {lesson.contentType === "article" && (
            <textarea value={lesson.articleMd} onChange={(e) => setLesson({ ...lesson, articleMd: e.target.value })} placeholder="图文正文（Markdown）" rows={5} className="w-full rounded-lg border border-ink-200 px-3 py-2 font-mono text-xs outline-none focus:border-accent-400" />
          )}
          {/* 视频章节：上传视频文件，mock 上传拿到 assetId 后建章节时作为 videoAssetId 提交 */}
          {lesson.contentType === "video" && (
            <div className="space-y-1">
              <input type="file" accept="video/*" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadVideo(f); }} className="w-full text-xs text-ink-500 file:mr-2 file:rounded-lg file:border-0 file:bg-ink-100 file:px-3 file:py-1.5 file:text-xs file:text-ink-700" />
              {uploading && <p className="text-xs text-ink-400">上传中…</p>}
              {uploadHint && <p className="text-xs text-ink-400">{uploadHint}</p>}
            </div>
          )}
          <button disabled={busy || uploading || !lesson.title} onClick={addLesson} className="rounded-lg bg-accent-600 px-4 py-1.5 text-sm text-white disabled:opacity-50">添加章节</button>
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
