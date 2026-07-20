"use client";

/**
 * CoursewareManager —— 成稿后「可控造课 · 内容管理」面板（L4 + L5）。
 *
 * 给一门已生成的课提供用户可控的编辑能力，避免「点一次生成就再也改不动」的黑盒：
 *  · L5 换肤：选艺术方向 → POST /theme（免费确定性重排，force 重渲）。
 *  · L5 精修：会员对单节触发 bespoke HTML 精修 → POST /ai/generate-lesson-html {enhance:true}。
 *  · L4 改写：给单节一句指令定向重造 → POST /ai/regenerate-lesson。
 *  · L4 回滚：GET /lessons/:id/revisions → 选版本 → POST /lessons/:id/rollback（后悔药）。
 *
 * 纯客户端；所有写操作走既有同源 API（服务端已做越权/IDOR/计费闸门）。动效沿用站内 studio-* / 现有 Toast。
 */

import { useState, useEffect } from "react";
import {
  Palette, PencilSimple, ClockCounterClockwise, Sparkle, ArrowClockwise, Check, ListBullets,
} from "@phosphor-icons/react";
import { Dialog } from "@/components/Dialog";
import { useToast } from "@/components/Toast";
import { Spinner } from "@/components/GenProgress";
import { BlockEditor } from "@/components/BlockEditor";
import { track } from "@/lib/analytics-client";

/** 换肤可选的艺术方向（key 与服务端 ART_DIRECTIONS 一致；此处只需 key+label，避免打包服务端 token 数据）。 */
const ART_SKINS: { key: string; label: string }[] = [
  { key: "editorial_paper", label: "编辑纸刊" },
  { key: "dark_tech", label: "深色科技" },
  { key: "blueprint", label: "工程蓝图" },
  { key: "soft_structure", label: "银白柔构" },
  { key: "scoreboard", label: "冲刺计分" },
  { key: "storybook", label: "剧场绘本" },
  { key: "cinematic_neon", label: "霓虹剧场" },
  { key: "dev_terminal", label: "终端代码" },
  { key: "academic_lecture", label: "学术讲义" },
  { key: "magazine_bold", label: "大胆杂志" },
  { key: "zen_mono", label: "禅意极简" },
  { key: "journal_washi", label: "和纸手账" },
];

export interface ManagerLesson {
  id: string;
  title: string;
}
interface RevisionRow {
  id: string;
  reason: string;
  createdAt: string;
  hasBlocks: boolean;
  hasHtml: boolean;
}

export function CoursewareManager({
  courseId,
  lessons,
  initialArtKey,
  isSubscriber = false,
}: {
  courseId: string;
  lessons: ManagerLesson[];
  /** 当前皮肤 key（用于高亮），可空。 */
  initialArtKey?: string | null;
  /** 会员才可用 bespoke 精修（前端也钳一次，服务端仍是权威）。 */
  isSubscriber?: boolean;
}) {
  const { toast } = useToast();
  const [artKey, setArtKey] = useState<string | null>(initialArtKey ?? null);
  const [themeBusy, setThemeBusy] = useState<string | null>(null); // 正在切换的 artKey
  const [rewriteFor, setRewriteFor] = useState<ManagerLesson | null>(null);
  const [historyFor, setHistoryFor] = useState<ManagerLesson | null>(null);
  const [editFor, setEditFor] = useState<ManagerLesson | null>(null);

  async function switchSkin(key: string) {
    if (themeBusy || key === artKey) return;
    setThemeBusy(key);
    track("courseware_theme_switch", { course_id: courseId, art_key: key });
    try {
      const r = await fetch(`/api/courses/${courseId}/theme`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ artKey: key }),
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok) {
        setArtKey(key);
        toast(`已换肤并重排 ${j.data?.rendered ?? 0} 节`, { tone: "success" });
      } else {
        toast(j?.error || "换肤失败，请稍后再试", { tone: "warn" });
      }
    } catch {
      toast("网络异常，请稍后再试", { tone: "warn" });
    } finally {
      setThemeBusy(null);
    }
  }

  return (
    <div className="mt-4 rounded-[14px] border border-[var(--border)] bg-[var(--surface2)] p-4 shadow-[var(--card)]">
      <div className="flex items-center gap-2">
        <Palette size={16} weight="fill" className="text-[var(--red)]" />
        <span className="text-[13px] font-semibold text-[var(--ink)]">内容管理 · 可控编辑</span>
        <span className="mono text-[11px] text-[var(--ink4)]">换肤免费 · 改写按节计费</span>
      </div>

      {/* —— L5 换肤 —— */}
      <p className="mt-3 text-[12px] font-semibold text-[var(--ink2)]">换个皮肤（免费，即时重排）</p>
      <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-4">
        {ART_SKINS.map((s) => {
          const active = s.key === artKey;
          const busy = themeBusy === s.key;
          return (
            <button
              key={s.key}
              type="button"
              disabled={!!themeBusy}
              onClick={() => switchSkin(s.key)}
              className={`studio-press inline-flex items-center justify-center gap-1 rounded-[10px] border px-2 py-2 text-[12px] font-semibold transition-colors disabled:opacity-60 ${
                active
                  ? "border-[var(--red)] bg-[var(--red-soft)] text-[var(--red-ink)]"
                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink2)] hover:border-[var(--border2)]"
              }`}
            >
              {busy ? <Spinner size={11} /> : active ? <Check size={12} weight="bold" /> : null}
              {s.label}
            </button>
          );
        })}
      </div>

      {/* —— L4 逐节改写 / 回滚 —— */}
      <p className="mt-4 text-[12px] font-semibold text-[var(--ink2)]">逐节编辑</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {lessons.map((l, i) => (
          <li
            key={l.id}
            className="flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          >
            <span className="mono text-[11px] text-[var(--ink4)]">{String(i + 1).padStart(2, "0")}</span>
            <span className="flex-1 truncate text-[13px] text-[var(--ink2)]">{l.title}</span>
            <button
              type="button"
              onClick={() => setEditFor(l)}
              className="studio-press inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink2)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)]"
            >
              <ListBullets size={12} weight="bold" /> 编辑
            </button>
            <button
              type="button"
              onClick={() => setRewriteFor(l)}
              className="studio-press inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink2)] transition-colors hover:border-[var(--red-soft-border)] hover:text-[var(--red-ink)]"
            >
              <PencilSimple size={12} weight="fill" /> 改写
            </button>
            <button
              type="button"
              onClick={() => setHistoryFor(l)}
              className="studio-press inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink2)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)]"
            >
              <ClockCounterClockwise size={12} weight="bold" /> 历史
            </button>
          </li>
        ))}
      </ul>

      {editFor && <BlockEditor lessonId={editFor.id} lessonTitle={editFor.title} onClose={() => setEditFor(null)} />}
      {rewriteFor && (
        <RewriteDialog
          courseId={courseId}
          lesson={rewriteFor}
          isSubscriber={isSubscriber}
          onClose={() => setRewriteFor(null)}
        />
      )}
      {historyFor && <HistoryDialog lesson={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}

/** L4 改写：一句指令定向重造本节（可选升级模型精修）。 */
function RewriteDialog({
  courseId, lesson, isSubscriber, onClose,
}: {
  courseId: string;
  lesson: ManagerLesson;
  isSubscriber: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [refineBusy, setRefineBusy] = useState(false);

  async function rewrite() {
    if (busy) return;
    setBusy(true);
    track("courseware_lesson_rewrite", { course_id: courseId, lesson_id: lesson.id });
    try {
      const r = await fetch(`/api/ai/regenerate-lesson`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ lessonId: lesson.id, instruction: instruction.trim() || undefined }),
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok) {
        toast("本节已按你的要求重写", { tone: "success" });
        onClose();
      } else if (r.status === 402) {
        toast("AI 改写需订阅后使用", { tone: "warn" });
      } else {
        toast(j?.error || "改写失败，请稍后再试", { tone: "warn" });
      }
    } catch {
      toast("网络异常，请稍后再试", { tone: "warn" });
    } finally {
      setBusy(false);
    }
  }

  /** L5 会员 bespoke 精修：不改内容，只把本节 HTML 课件升级为 LLM 精修排版。 */
  async function refine() {
    if (refineBusy) return;
    setRefineBusy(true);
    track("courseware_lesson_refine", { course_id: courseId, lesson_id: lesson.id });
    try {
      const r = await fetch(`/api/ai/generate-lesson-html`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ lessonId: lesson.id, enhance: true }),
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok) {
        toast(j.data?.engine === "llm" ? "本节已精修排版" : "已重排（本次未走精修）", { tone: "success" });
        onClose();
      } else if (r.status === 402) {
        toast("精修排版为会员专享", { tone: "warn" });
      } else {
        toast(j?.error || "精修失败，请稍后再试", { tone: "warn" });
      }
    } catch {
      toast("网络异常，请稍后再试", { tone: "warn" });
    } finally {
      setRefineBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={`改写「${lesson.title}」`}>
      <p className="text-[13px] text-[var(--ink2)]">
        用一句话告诉 AI 怎么改（例如：这节太浅，加一个真实工作场景的实操案例）。留空则按原目标整体重写。
      </p>
      <textarea
        data-autofocus
        value={instruction}
        onChange={(e) => setInstruction(e.target.value.slice(0, 200))}
        rows={3}
        placeholder="≤200 字修改指令，可留空"
        className="mt-3 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[13px] outline-none focus:border-[var(--ink3)]"
      />
      <div className="mono mt-1 text-right text-[11px] text-[var(--ink4)]">{instruction.length}/200</div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={rewrite}
          disabled={busy}
          className="studio-press inline-flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-[12px] bg-[var(--red)] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--red-hover)] disabled:opacity-60"
        >
          {busy ? <Spinner size={13} /> : <ArrowClockwise size={15} weight="bold" />}
          {busy ? "重写中" : "开始改写"}
        </button>
        {isSubscriber && (
          <button
            type="button"
            onClick={refine}
            disabled={refineBusy}
            className="studio-press inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-[12px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-3 text-[13px] font-semibold text-[var(--red-ink)] transition-colors hover:border-[var(--red)] disabled:opacity-60"
          >
            {refineBusy ? <Spinner size={13} /> : <Sparkle size={15} weight="fill" />}
            AI 精修排版
          </button>
        )}
      </div>
    </Dialog>
  );
}

/** L4 版本回滚：列出历史版本，选一版回滚（后悔药）。 */
function HistoryDialog({ lesson, onClose }: { lesson: ManagerLesson; onClose: () => void }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<RevisionRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [rollingBack, setRollingBack] = useState<string | null>(null);

  // 打开即拉版本列表。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/lessons/${lesson.id}/revisions`, { credentials: "same-origin" });
        const j = await r.json().catch(() => null);
        if (!cancelled) setRows(r.ok && j?.ok ? (j.data?.revisions ?? []) : []);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lesson.id]);

  async function rollback(revisionId: string) {
    if (rollingBack) return;
    setRollingBack(revisionId);
    track("courseware_lesson_rollback", { lesson_id: lesson.id, revision_id: revisionId });
    try {
      const r = await fetch(`/api/lessons/${lesson.id}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ revisionId }),
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok) {
        toast("已回滚到该版本", { tone: "success" });
        onClose();
      } else {
        toast(j?.error || "回滚失败，请稍后再试", { tone: "warn" });
      }
    } catch {
      toast("网络异常，请稍后再试", { tone: "warn" });
    } finally {
      setRollingBack(null);
    }
  }

  const REASON_LABEL: Record<string, string> = {
    generate: "首次生成", regen: "指令改写", manual: "手动/回滚", rerender: "重排快照",
  };

  return (
    <Dialog open onClose={onClose} title={`「${lesson.title}」历史版本`}>
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-[13px] text-[var(--ink3)]">
          <Spinner size={14} /> 读取版本…
        </div>
      ) : !rows || rows.length === 0 ? (
        <p className="py-6 text-[13px] text-[var(--ink3)]">暂无历史版本（本节还没被改写过）。</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-2">
          {rows.map((rev) => (
            <li key={rev.id} className="flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-[var(--ink)]">{REASON_LABEL[rev.reason] ?? rev.reason}</p>
                <p className="mono text-[11px] text-[var(--ink4)]">{new Date(rev.createdAt).toLocaleString("zh-CN")}</p>
              </div>
              <button
                type="button"
                disabled={!rev.hasBlocks || !!rollingBack}
                title={rev.hasBlocks ? "回滚到此版本" : "该版本仅排版快照，不可回滚"}
                onClick={() => rollback(rev.id)}
                className="studio-press inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-3 py-1.5 text-[12px] font-semibold text-[var(--ink2)] transition-colors hover:border-[var(--red-soft-border)] hover:text-[var(--red-ink)] disabled:opacity-40"
              >
                {rollingBack === rev.id ? <Spinner size={11} /> : <ClockCounterClockwise size={12} weight="bold" />}
                回滚
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-[var(--ink4)]">仅保留最近 3 版；回滚后本节课件会重排，学员端即时更新。</p>
    </Dialog>
  );
}
