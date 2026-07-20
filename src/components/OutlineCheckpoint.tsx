"use client";

/**
 * OutlineCheckpoint —— L2 可控造课：大纲检查点编辑屏。
 *
 * 专业模式下 generate-course 停在 outline_draft，本组件让用户在扇出前对大纲增删改排序：
 *  · 编辑标题/学习目标；上移/下移；删除；末尾加一节。
 *  · 「重新生成大纲」→ POST /outline/regenerate（有偿，整体换一版）。
 *  · 「确认开工」→ 先 PATCH /outline 落库编辑，再 POST /outline/confirm 触发逐节扇出，交回父组件进剧场。
 *
 * 纯客户端；服务端已做归属/IDOR/计费/状态闸门。动效沿用 gen-row-in + studio-*。
 */

import { useState } from "react";
import {
  ArrowUp, ArrowDown, Trash, Plus, ArrowClockwise, Check, CaretRight,
} from "@phosphor-icons/react";
import { useToast } from "@/components/Toast";
import { Spinner } from "@/components/GenProgress";
import { track } from "@/lib/analytics-client";
import type { CSSProperties } from "react";

export interface CheckpointLesson {
  id?: string; // 已有节带 id；新增节无 id（确认时服务端补建）
  title: string;
  summary?: string | null;
}

export function OutlineCheckpoint({
  courseId,
  courseTitle,
  initialLessons,
  onConfirmed,
  onCancel,
}: {
  courseId: string;
  courseTitle: string;
  initialLessons: CheckpointLesson[];
  /** 确认并触发扇出后回调：父组件据此进入逐节生成剧场。传回最终节列表（含服务端补建的 id）。 */
  onConfirmed: (lessons: { id: string; title: string }[]) => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [lessons, setLessons] = useState<CheckpointLesson[]>(initialLessons);
  const [selected, setSelected] = useState(0);
  const [regenerating, setRegenerating] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const busy = regenerating || confirming;

  function update(i: number, patch: Partial<CheckpointLesson>) {
    setLessons((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  }
  function move(i: number, dir: -1 | 1) {
    setLessons((ls) => {
      const j = i + dir;
      if (j < 0 || j >= ls.length) return ls;
      const next = [...ls];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setSelected((s) => Math.min(Math.max(0, s + (s === i ? dir : 0)), lessons.length - 1));
  }
  function remove(i: number) {
    if (lessons.length <= 1) {
      toast("至少保留 1 节", { tone: "info" });
      return;
    }
    setLessons((ls) => ls.filter((_, k) => k !== i));
    setSelected((s) => Math.max(0, s - (i <= s ? 1 : 0)));
  }
  function add() {
    if (lessons.length >= 12) {
      toast("最多 12 节", { tone: "info" });
      return;
    }
    setLessons((ls) => [...ls, { title: "新的一节", summary: "" }]);
    setSelected(lessons.length);
  }

  async function regenerate() {
    if (busy) return;
    setRegenerating(true);
    track("outline_regenerate", { course_id: courseId });
    try {
      const r = await fetch(`/api/courses/${courseId}/outline/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({}),
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok) {
        const next = (j.data?.lessons ?? []) as { id: string; title: string; summary: string | null }[];
        setLessons(next.map((l) => ({ id: l.id, title: l.title, summary: l.summary })));
        setSelected(0);
        toast("已换一版大纲", { tone: "success" });
      } else if (r.status === 402) {
        toast("AI 造课需订阅后使用", { tone: "warn" });
      } else {
        toast(j?.error || "重新生成失败，请稍后再试", { tone: "warn" });
      }
    } catch {
      toast("网络异常，请稍后再试", { tone: "warn" });
    } finally {
      setRegenerating(false);
    }
  }

  async function confirm() {
    if (busy) return;
    const clean = lessons
      .map((l) => ({ ...l, title: l.title.trim() }))
      .filter((l) => l.title);
    if (clean.length === 0) {
      toast("大纲至少保留 1 节有标题的章节", { tone: "warn" });
      return;
    }
    setConfirming(true);
    track("outline_confirm", { course_id: courseId, lessons: clean.length });
    try {
      // 1) 落库编辑后的大纲（全量对账）。
      const saveRes = await fetch(`/api/courses/${courseId}/outline`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ lessons: clean.map((l) => ({ id: l.id, title: l.title, summary: l.summary ?? "" })) }),
      });
      const saveJson = await saveRes.json().catch(() => null);
      if (!saveRes.ok || !saveJson?.ok) {
        toast(saveJson?.error || "保存大纲失败", { tone: "warn" });
        setConfirming(false);
        return;
      }
      const savedLessons = (saveJson.data?.lessons ?? []) as { id: string; title: string }[];

      // 2) 确认开工，触发后台逐节扇出。
      const confirmRes = await fetch(`/api/courses/${courseId}/outline/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({}),
      });
      const confirmJson = await confirmRes.json().catch(() => null);
      if (!confirmRes.ok || !confirmJson?.ok) {
        if (confirmRes.status === 402) toast("AI 造课需订阅后使用", { tone: "warn" });
        else toast(confirmJson?.error || "确认失败，请稍后再试", { tone: "warn" });
        setConfirming(false);
        return;
      }
      onConfirmed(savedLessons.map((l) => ({ id: l.id, title: l.title })));
    } catch {
      toast("网络异常，请稍后再试", { tone: "warn" });
      setConfirming(false);
    }
  }

  const cur = lessons[selected];

  return (
    <div className="mt-5 w-full overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card)]">
      {/* 顶栏 */}
      <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface2)] px-5 py-3">
        <span className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink4)]">AI PRODUCTION LINE · 第 2 站</span>
        <span className="text-[13px] font-semibold text-[var(--ink)]">大纲待你确认</span>
        <span className="mono ml-auto text-[11px] text-[var(--ink4)]">{lessons.length} 节</span>
      </div>

      <div className="grid gap-0 md:grid-cols-[1fr_1fr]">
        {/* 左：节列表 */}
        <div className="border-b border-[var(--border)] p-3 md:border-b-0 md:border-r">
          <p className="mb-2 px-1 text-[12px] font-semibold text-[var(--ink2)]">章节（可改标题、排序、增删）</p>
          <ul className="flex flex-col gap-1.5">
            {lessons.map((l, i) => (
              <li
                key={l.id ?? `new-${i}`}
                style={{ "--i": i } as CSSProperties}
                className={`gen-row-in flex items-center gap-1.5 rounded-[11px] border px-2.5 py-2 transition-colors ${
                  i === selected
                    ? "border-[var(--red-soft-border)] bg-[var(--red-soft)]"
                    : "border-[var(--border)] bg-[var(--surface)]"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSelected(i)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span className="mono text-[11px] text-[var(--ink4)]">{String(i + 1).padStart(2, "0")}</span>
                  <span className="truncate text-[12.5px] font-medium text-[var(--ink)]">{l.title || "（未命名）"}</span>
                </button>
                <button type="button" disabled={i === 0} onClick={() => move(i, -1)} title="上移" className="studio-press shrink-0 rounded-md p-1 text-[var(--ink3)] hover:text-[var(--ink)] disabled:opacity-30">
                  <ArrowUp size={13} weight="bold" />
                </button>
                <button type="button" disabled={i === lessons.length - 1} onClick={() => move(i, 1)} title="下移" className="studio-press shrink-0 rounded-md p-1 text-[var(--ink3)] hover:text-[var(--ink)] disabled:opacity-30">
                  <ArrowDown size={13} weight="bold" />
                </button>
                <button type="button" onClick={() => remove(i)} title="删除" className="studio-press shrink-0 rounded-md p-1 text-[var(--ink3)] hover:text-[var(--red)]">
                  <Trash size={13} weight="bold" />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={add}
            className="studio-press mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-[11px] border border-dashed border-[var(--border2)] px-3 py-2 text-[12px] font-semibold text-[var(--ink3)] transition-colors hover:border-[var(--red-soft-border)] hover:text-[var(--red-ink)]"
          >
            <Plus size={13} weight="bold" /> 加一节
          </button>
        </div>

        {/* 右：选中节编辑 + 整单操作 */}
        <div className="flex flex-col p-4">
          {cur && (
            <div className="flex-1">
              <label className="mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--ink4)]">节标题</label>
              <input
                value={cur.title}
                onChange={(e) => update(selected, { title: e.target.value.slice(0, 120) })}
                className="mt-1 w-full rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] outline-none focus:border-[var(--ink3)]"
              />
              <label className="mono mt-3 block text-[10.5px] uppercase tracking-[0.14em] text-[var(--ink4)]">学习目标</label>
              <textarea
                value={cur.summary ?? ""}
                onChange={(e) => update(selected, { summary: e.target.value.slice(0, 300) })}
                rows={4}
                placeholder="本节希望学员能做到什么（可留空）"
                className="mt-1 w-full rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] outline-none focus:border-[var(--ink3)]"
              />
            </div>
          )}

          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={regenerate}
              disabled={busy}
              className="studio-press inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface2)] px-4 text-[13px] font-semibold text-[var(--ink2)] transition-colors hover:border-[var(--border2)] disabled:opacity-60"
            >
              {regenerating ? <Spinner size={13} /> : <ArrowClockwise size={14} weight="bold" />}
              {regenerating ? "重拟中" : "重新生成大纲"}
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className="cta-glow studio-press inline-flex min-h-[46px] items-center justify-center gap-2 rounded-[13px] bg-[var(--red)] px-5 text-[15px] font-semibold text-white transition-colors hover:bg-[var(--red-hover)] disabled:opacity-60"
            >
              {confirming ? <Spinner size={14} /> : <Check size={16} weight="bold" />}
              {confirming ? "开工中" : "确认开工，开始逐节生成"}
              {!confirming && <CaretRight size={14} weight="bold" />}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="text-[12px] text-[var(--ink4)] transition-colors hover:text-[var(--ink2)] disabled:opacity-60"
            >
              放弃这门课
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
