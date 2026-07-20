"use client";

import { useState } from "react";
import { useToast } from "@/components/Toast";

export interface ModPost {
  id: string;
  type: string;
  content: string;
  imageCount: number;
  tags: string[];
  authorName: string;
  createdAt: string;
}

export interface ModCourse {
  id: string;
  title: string;
  subtitle: string | null;
  category: string;
  level: string;
  lessonCount: number;
  updatedAt: string;
}

const POST_TYPE_LABEL: Record<string, string> = {
  insight: "学习心得",
  checkin: "打卡",
  question: "求助",
};

// 常用拒绝理由模板（快捷选择，避免每次手打）。
const REJECT_TEMPLATES = [
  "含未经核实的医疗/健康建议",
  "含未经核实的投资/财务承诺",
  "疑似诱导、引流或广告",
  "内容与学习社区主题无关",
  "含攻击性或不当言论",
];

export function ModerationConsole({
  posts,
  courses,
}: {
  posts: ModPost[];
  courses: ModCourse[];
}) {
  const { toast } = useToast();
  const [postList, setPostList] = useState(posts);
  const [courseList, setCourseList] = useState(courses);
  const [busy, setBusy] = useState<string | null>(null);
  // 拒绝面板：记录正在填理由的目标 { kind, id } 及当前文本。
  const [rejecting, setRejecting] = useState<{ kind: "post" | "course"; id: string } | null>(null);
  const [reason, setReason] = useState("");

  function openReject(kind: "post" | "course", id: string) {
    setRejecting({ kind, id });
    setReason("");
  }

  async function moderatePost(postId: string, action: "approve" | "reject", rej?: string) {
    if (busy) return;
    setBusy(postId);
    try {
      const json = await fetch("/api/admin/moderation/post", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postId, action, reason: rej }),
      }).then((r) => r.json());
      if (!json.ok) {
        toast(json.error ?? "操作失败", { tone: "warn" });
        return;
      }
      setPostList((list) => list.filter((p) => p.id !== postId));
      setRejecting(null);
      toast(action === "approve" ? "已批准" : "已拒绝", { tone: "success" });
    } catch {
      toast("网络异常，请重试", { tone: "warn" });
    } finally {
      setBusy(null);
    }
  }

  async function moderateCourse(courseId: string, action: "approve" | "reject", rej?: string) {
    if (busy) return;
    setBusy(courseId);
    try {
      const json = await fetch("/api/admin/moderation/course", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseId, action, reason: rej }),
      }).then((r) => r.json());
      if (!json.ok) {
        toast(json.error ?? "操作失败", { tone: "warn" });
        return;
      }
      setCourseList((list) => list.filter((c) => c.id !== courseId));
      setRejecting(null);
      toast(action === "approve" ? "已上架集市" : "已拒绝分享", { tone: "success" });
    } catch {
      toast("网络异常，请重试", { tone: "warn" });
    } finally {
      setBusy(null);
    }
  }

  function submitReject() {
    if (!rejecting) return;
    const r = reason.trim();
    if (!r) {
      toast("请填写或选择拒绝理由", { tone: "warn" });
      return;
    }
    if (rejecting.kind === "post") void moderatePost(rejecting.id, "reject", r);
    else void moderateCourse(rejecting.id, "reject", r);
  }

  return (
    <div className="space-y-8">
      {/* ── 区一：待审帖子 ── */}
      <section className="space-y-3">
        <SectionHead
          title="待审帖子"
          count={postList.length}
          hint="LLM 拿不准、转人工的社区帖子"
        />
        {postList.length === 0 ? (
          <EmptyCard label="没有待审帖子" />
        ) : (
          <div className="space-y-3">
            {postList.map((p) => (
              <article
                key={p.id}
                className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mono rounded-full bg-[var(--surface2)] px-2.5 py-0.5 text-[11px] text-[var(--ink2)]">
                    {POST_TYPE_LABEL[p.type] ?? p.type}
                  </span>
                  <span className="text-[13px] font-semibold text-[var(--ink)]">{p.authorName}</span>
                  <span className="mono text-[11px] text-[var(--ink4)]">{fmtDate(p.createdAt)}</span>
                  {p.imageCount > 0 && (
                    <span className="mono text-[11px] text-[var(--ink3)]">图 ×{p.imageCount}</span>
                  )}
                </div>
                <p className="mt-2.5 whitespace-pre-wrap text-[14px] leading-[1.6] text-[var(--ink)]">
                  {p.content}
                </p>
                {p.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {p.tags.map((t) => (
                      <span key={t} className="mono text-[11px] text-[var(--ink3)]">
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
                {rejecting?.kind === "post" && rejecting.id === p.id ? (
                  <RejectPanel
                    reason={reason}
                    setReason={setReason}
                    onCancel={() => setRejecting(null)}
                    onSubmit={submitReject}
                    busy={busy === p.id}
                  />
                ) : (
                  <div className="mt-3.5 flex gap-2">
                    <ApproveBtn onClick={() => moderatePost(p.id, "approve")} disabled={!!busy} />
                    <RejectBtn onClick={() => openReject("post", p.id)} disabled={!!busy} />
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {/* ── 区二：课程集市待审 ── */}
      <section className="space-y-3">
        <SectionHead
          title="课程集市待审"
          count={courseList.length}
          hint="用户申请把课程分享到集市"
        />
        {courseList.length === 0 ? (
          <EmptyCard label="没有待审课程" />
        ) : (
          <div className="space-y-3">
            {courseList.map((c) => (
              <article
                key={c.id}
                className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mono rounded-full bg-[var(--surface2)] px-2.5 py-0.5 text-[11px] text-[var(--ink2)]">
                    {c.category} · {c.level}
                  </span>
                  <span className="mono text-[11px] text-[var(--ink3)]">章节 ×{c.lessonCount}</span>
                  <span className="mono text-[11px] text-[var(--ink4)]">{fmtDate(c.updatedAt)}</span>
                </div>
                <p className="mt-2.5 text-[15px] font-bold text-[var(--ink)]">{c.title}</p>
                {c.subtitle && (
                  <p className="mt-1 text-[13px] leading-[1.5] text-[var(--ink2)]">{c.subtitle}</p>
                )}
                {rejecting?.kind === "course" && rejecting.id === c.id ? (
                  <RejectPanel
                    reason={reason}
                    setReason={setReason}
                    onCancel={() => setRejecting(null)}
                    onSubmit={submitReject}
                    busy={busy === c.id}
                  />
                ) : (
                  <div className="mt-3.5 flex gap-2">
                    <ApproveBtn
                      label="批准上架"
                      onClick={() => moderateCourse(c.id, "approve")}
                      disabled={!!busy}
                    />
                    <RejectBtn onClick={() => openReject("course", c.id)} disabled={!!busy} />
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {/* ── 区三：拒绝理由模板 ── */}
      <section className="space-y-3">
        <SectionHead title="拒绝理由模板" hint="点击可填入当前打开的拒绝面板" />
        <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]">
          <div className="flex flex-wrap gap-2">
            {REJECT_TEMPLATES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  if (!rejecting) {
                    toast("先在某条内容上点“拒绝”，再选择理由", { tone: "warn" });
                    return;
                  }
                  setReason(t);
                }}
                className="rounded-full border border-[var(--border)] bg-[var(--surface2)] px-3 py-1.5 text-[12px] text-[var(--ink2)] transition-colors hover:border-[var(--ink3)] hover:text-[var(--ink)]"
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function SectionHead({ title, count, hint }: { title: string; count?: number; hint: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[15px] font-bold text-[var(--ink)]">{title}</h2>
        {typeof count === "number" && (
          <span className="mono text-[12px] text-[var(--ink3)]">{count}</span>
        )}
      </div>
      <span className="text-[12px] text-[var(--ink4)]">{hint}</span>
    </div>
  );
}

function EmptyCard({ label }: { label: string }) {
  return (
    <div className="rounded-[16px] border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center text-[13px] text-[var(--ink3)]">
      {label}
    </div>
  );
}

function ApproveBtn({
  onClick,
  disabled,
  label = "批准",
}: {
  onClick: () => void;
  disabled: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-[12px] bg-[var(--ink)] px-4 py-2 text-[13px] font-bold text-[var(--surface)] transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {label}
    </button>
  );
}

function RejectBtn({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-[12px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-4 py-2 text-[13px] font-bold text-[var(--red)] transition-colors hover:border-[var(--red)] disabled:opacity-50"
    >
      拒绝
    </button>
  );
}

function RejectPanel({
  reason,
  setReason,
  onCancel,
  onSubmit,
  busy,
}: {
  reason: string;
  setReason: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  return (
    <div className="mt-3.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface2)] p-3">
      <label className="text-[12px] font-semibold text-[var(--ink2)]">拒绝理由</label>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="填写或从下方模板选择理由，将通知作者"
        className="mt-1.5 w-full resize-none rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--ink)] outline-none placeholder:text-[var(--ink4)] focus:border-[var(--ink3)]"
      />
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy}
          className="rounded-[10px] bg-[var(--red)] px-4 py-2 text-[13px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          确认拒绝
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[13px] font-semibold text-[var(--ink2)] transition-colors hover:border-[var(--ink3)] disabled:opacity-50"
        >
          取消
        </button>
      </div>
    </div>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}
