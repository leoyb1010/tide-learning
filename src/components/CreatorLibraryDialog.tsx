"use client";

import { useEffect, useState } from "react";
import { Copy, Globe, Lock, Palette, Plus, Stack, Trash } from "@phosphor-icons/react";
import { Dialog } from "@/components/Dialog";
import { Spinner } from "@/components/GenProgress";
import { useToast } from "@/components/Toast";

type LibraryScope = "mine" | "market";
interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  visibility: string;
  status: string;
  usageCount: number;
  owner: { id: string; nickname: string };
}
interface ThemeRow extends TemplateRow {
  preview: null | { direction: string; background: string; surface: string; ink: string; accent: string; motif: string };
}

export function CreatorLibraryDialog({
  courseId,
  lessons,
  onClose,
}: {
  courseId: string;
  lessons: { id: string; title: string }[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [scope, setScope] = useState<LibraryScope>("mine");
  const [kind, setKind] = useState<"templates" | "themes">("templates");
  const [templates, setTemplates] = useState<Record<LibraryScope, TemplateRow[]>>({ mine: [], market: [] });
  const [themes, setThemes] = useState<Record<LibraryScope, ThemeRow[]>>({ mine: [], market: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [themeName, setThemeName] = useState("");
  const [sourceLessonId, setSourceLessonId] = useState(lessons[0]?.id ?? "");

  async function refresh() {
    setLoading(true);
    try {
      const [tm, tx, hm, hx] = await Promise.all([
        fetch("/api/creator/templates?scope=mine", { credentials: "same-origin" }),
        fetch("/api/creator/templates?scope=market", { credentials: "same-origin" }),
        fetch("/api/creator/themes?scope=mine", { credentials: "same-origin" }),
        fetch("/api/creator/themes?scope=market", { credentials: "same-origin" }),
      ]);
      const [tmj, txj, hmj, hxj] = await Promise.all([tm.json(), tx.json(), hm.json(), hx.json()]);
      setTemplates({ mine: tmj?.data?.templates ?? [], market: txj?.data?.templates ?? [] });
      setThemes({ mine: hmj?.data?.themes ?? [], market: hxj?.data?.themes ?? [] });
    } catch {
      toast("读取创作资产失败", { tone: "warn" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function write(url: string, method: string, body?: unknown) {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.ok) throw new Error(json?.error || "操作失败");
    return json.data;
  }

  async function saveTemplate() {
    const name = templateName.trim();
    if (!name || busy) return;
    setBusy("save-template");
    try {
      await write("/api/creator/templates", "POST", { courseId, name });
      setTemplateName("");
      toast("课程结构已保存到我的模板", { tone: "success" });
      await refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "保存失败", { tone: "warn" });
    } finally { setBusy(null); }
  }

  async function saveTheme() {
    const name = themeName.trim();
    if (!name || !sourceLessonId || busy) return;
    setBusy("save-theme");
    try {
      await write("/api/creator/themes", "POST", { sourceLessonId, name });
      setThemeName("");
      toast("课节设计已保存到我的皮肤", { tone: "success" });
      await refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "保存失败", { tone: "warn" });
    } finally { setBusy(null); }
  }

  async function instantiate(template: TemplateRow) {
    if (busy) return;
    setBusy(template.id);
    try {
      const data = await write(`/api/creator/templates/${template.id}/instantiate`, "POST", {});
      toast("已按模板创建一门私有草稿课", { tone: "success" });
      window.location.assign(`/courses/${data.course.slug}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "创建失败", { tone: "warn" });
      setBusy(null);
    }
  }

  async function applyTheme(theme: ThemeRow) {
    if (busy) return;
    setBusy(theme.id);
    try {
      const data = await write(`/api/creator/themes/${theme.id}/apply`, "POST", { courseId });
      toast(`已应用到 ${data.affected} 节，${data.rendered} 节完成原创重排`, { tone: "success" });
      await refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "应用失败", { tone: "warn" });
    } finally { setBusy(null); }
  }

  async function cloneTheme(theme: ThemeRow) {
    if (busy) return;
    setBusy(theme.id);
    try {
      await write("/api/creator/themes", "POST", { sourceThemeId: theme.id, name: `${theme.name} · 副本` });
      toast("已克隆到我的皮肤", { tone: "success" });
      setScope("mine");
      await refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "克隆失败", { tone: "warn" });
    } finally { setBusy(null); }
  }

  async function toggleVisibility(item: TemplateRow, itemKind: "templates" | "themes") {
    if (busy) return;
    setBusy(item.id);
    try {
      const next = item.visibility === "public" ? "private" : "public";
      await write(`/api/creator/${itemKind}/${item.id}`, "PATCH", { visibility: next });
      toast(next === "public" ? "已发布到创作市场" : "已转为仅自己可见", { tone: "success" });
      await refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "更新失败", { tone: "warn" });
    } finally { setBusy(null); }
  }

  async function remove(item: TemplateRow, itemKind: "templates" | "themes") {
    if (busy || !window.confirm(`删除「${item.name}」？`)) return;
    setBusy(item.id);
    try {
      await write(`/api/creator/${itemKind}/${item.id}`, "DELETE");
      toast("已删除", { tone: "success" });
      await refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "删除失败", { tone: "warn" });
    } finally { setBusy(null); }
  }

  const rows = kind === "templates" ? templates[scope] : themes[scope];
  return (
    <Dialog open onClose={onClose} title="创作资产库">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setKind("templates")} className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${kind === "templates" ? "bg-[var(--ink)] text-[var(--surface)]" : "border border-[var(--border)] text-[var(--ink2)]"}`}>
          课程模板
        </button>
        <button type="button" onClick={() => setKind("themes")} className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${kind === "themes" ? "bg-[var(--ink)] text-[var(--surface)]" : "border border-[var(--border)] text-[var(--ink2)]"}`}>
          视觉皮肤
        </button>
        <span className="mx-1 w-px bg-[var(--border)]" />
        <button type="button" onClick={() => setScope("mine")} className={`rounded-full px-3 py-1.5 text-[12px] ${scope === "mine" ? "bg-[var(--red-soft)] font-semibold text-[var(--red-ink)]" : "text-[var(--ink3)]"}`}>我的</button>
        <button type="button" onClick={() => setScope("market")} className={`rounded-full px-3 py-1.5 text-[12px] ${scope === "market" ? "bg-[var(--red-soft)] font-semibold text-[var(--red-ink)]" : "text-[var(--ink3)]"}`}>创作市场</button>
      </div>

      {scope === "mine" && kind === "templates" && (
        <div className="mt-4 rounded-xl border border-dashed border-[var(--border2)] bg-[var(--surface2)] p-3">
          <p className="text-[12px] font-semibold text-[var(--ink)]">保存当前课程结构</p>
          <div className="mt-2 flex gap-2">
            <input value={templateName} onChange={(event) => setTemplateName(event.target.value.slice(0, 80))} placeholder="模板名称" className="min-h-[38px] min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-[13px] outline-none focus:border-[var(--ink3)]" />
            <button type="button" onClick={() => void saveTemplate()} disabled={!templateName.trim() || !!busy} className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[var(--red)] px-3 text-[12px] font-semibold text-white disabled:opacity-50">
              {busy === "save-template" ? <Spinner size={12} /> : <Plus size={13} weight="bold" />} 保存
            </button>
          </div>
        </div>
      )}

      {scope === "mine" && kind === "themes" && (
        <div className="mt-4 rounded-xl border border-dashed border-[var(--border2)] bg-[var(--surface2)] p-3">
          <p className="text-[12px] font-semibold text-[var(--ink)]">把某节原创设计保存为皮肤</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <select value={sourceLessonId} onChange={(event) => setSourceLessonId(event.target.value)} className="min-h-[38px] rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-[12px] text-[var(--ink2)]">
              {lessons.map((lesson) => <option key={lesson.id} value={lesson.id}>{lesson.title}</option>)}
            </select>
            <input value={themeName} onChange={(event) => setThemeName(event.target.value.slice(0, 80))} placeholder="皮肤名称" className="min-h-[38px] min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-[13px] outline-none focus:border-[var(--ink3)]" />
            <button type="button" onClick={() => void saveTheme()} disabled={!themeName.trim() || !sourceLessonId || !!busy} className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg bg-[var(--red)] px-3 text-[12px] font-semibold text-white disabled:opacity-50">
              {busy === "save-theme" ? <Spinner size={12} /> : <Plus size={13} weight="bold" />} 保存
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 max-h-[420px] space-y-2 overflow-y-auto pr-1">
        {loading ? (
          <div className="flex items-center gap-2 py-8 text-[13px] text-[var(--ink3)]"><Spinner size={14} /> 读取资产库…</div>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-[var(--ink4)]">这里还没有{kind === "templates" ? "课程模板" : "视觉皮肤"}。</p>
        ) : rows.map((item) => {
          const theme = kind === "themes" ? item as ThemeRow : null;
          return (
            <article key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="flex items-start gap-3">
                {theme?.preview ? (
                  <div className="h-12 w-14 shrink-0 rounded-lg border p-1" style={{ background: theme.preview.background, borderColor: theme.preview.accent }}>
                    <div className="h-2 w-7 rounded-full" style={{ background: theme.preview.accent }} />
                    <div className="mt-2 h-1 w-10 rounded-full opacity-70" style={{ background: theme.preview.ink }} />
                    <div className="mt-1 h-1 w-7 rounded-full opacity-40" style={{ background: theme.preview.ink }} />
                  </div>
                ) : (
                  <div className="flex h-12 w-14 shrink-0 items-center justify-center rounded-lg bg-[var(--surface2)] text-[var(--ink3)]">
                    {kind === "templates" ? <Stack size={22} /> : <Palette size={22} />}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h3 className="truncate text-[13px] font-semibold text-[var(--ink)]">{item.name}</h3>
                    {item.visibility === "public" ? <Globe size={12} className="text-[var(--ink4)]" /> : <Lock size={12} className="text-[var(--ink4)]" />}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-[var(--ink3)]">{item.description || theme?.preview?.direction || `由 ${item.owner.nickname} 创建`}</p>
                  <p className="mono mt-1 text-[10px] text-[var(--ink4)]">使用 {item.usageCount} 次 · {item.owner.nickname}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {kind === "templates" ? (
                  <button type="button" onClick={() => void instantiate(item)} disabled={!!busy} className="inline-flex items-center gap-1 rounded-full bg-[var(--ink)] px-3 py-1.5 text-[11px] font-semibold text-[var(--surface)] disabled:opacity-50">
                    {busy === item.id ? <Spinner size={11} /> : <Copy size={12} />} 用它建课
                  </button>
                ) : (
                  <button type="button" onClick={() => void applyTheme(item as ThemeRow)} disabled={!!busy} className="inline-flex items-center gap-1 rounded-full bg-[var(--ink)] px-3 py-1.5 text-[11px] font-semibold text-[var(--surface)] disabled:opacity-50">
                    {busy === item.id ? <Spinner size={11} /> : <Palette size={12} />} 应用到整课
                  </button>
                )}
                {scope === "market" && kind === "themes" && (
                  <button type="button" onClick={() => void cloneTheme(item as ThemeRow)} disabled={!!busy} className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-3 py-1.5 text-[11px] font-semibold text-[var(--ink2)] disabled:opacity-50"><Copy size={12} /> 克隆编辑</button>
                )}
                {scope === "mine" && (
                  <>
                    <button type="button" onClick={() => void toggleVisibility(item, kind)} disabled={!!busy} className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[11px] font-semibold text-[var(--ink2)] disabled:opacity-50">{item.visibility === "public" ? "转为私有" : "发布市场"}</button>
                    <button type="button" onClick={() => void remove(item, kind)} disabled={!!busy} title="删除" className="inline-flex items-center rounded-full border border-[var(--border)] px-2.5 py-1.5 text-[var(--ink3)] hover:text-[var(--red)] disabled:opacity-50"><Trash size={12} /></button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </Dialog>
  );
}
