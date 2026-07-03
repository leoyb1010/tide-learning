"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lightbulb, CheckCircle, Question, PaperPlaneRight, X } from "@phosphor-icons/react";
import { useToast } from "./Toast";

// 三类帖子的元数据（图标 + 文案 + 占位）
const TYPES = [
  { key: "insight", label: "学习心得", icon: Lightbulb, placeholder: "今天学到了什么？分享一点你的领悟…" },
  { key: "checkin", label: "打卡", icon: CheckCircle, placeholder: "记录今天的学习：学了多久、完成了哪节课…" },
  { key: "question", label: "求助", icon: Question, placeholder: "遇到什么卡点？描述清楚更容易得到回应…" },
] as const;

type PostType = (typeof TYPES)[number]["key"];

/**
 * PostComposer —— 自习室广场发帖组件（仅登录+订阅用户可见入口）。
 * 选类型 + 写内容 + 发布；发布前服务端 LLM 审核，实时反馈 审核中/被拒/已发布。
 * STUDIO token 设计；发布成功后刷新列表。
 */
export function PostComposer({ onPosted }: { onPosted?: () => void }) {
  const { toast } = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<PostType>("insight");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  // 审核结果提示：approved / pending / rejected
  const [result, setResult] = useState<{ status: string; message: string } | null>(null);

  async function submit() {
    const text = content.trim();
    if (text.length < 4) {
      toast("内容太短了，多写几句吧", { tone: "warn" });
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, content: text }),
      });
      const json = (await res.json()) as
        | { ok: true; data: { status: string; message: string } }
        | { ok: false; error: string };
      if (!json.ok) {
        toast(json.error, { tone: "warn" });
        return;
      }
      const { status, message } = json.data;
      if (status === "approved") {
        toast("已发布到广场", { tone: "success" });
        setContent("");
        setOpen(false);
        setResult(null);
        onPosted?.();
        router.refresh();
      } else {
        // pending / rejected：留在弹层内提示，不刷新
        setResult({ status, message });
        if (status === "rejected") setContent("");
      }
    } catch {
      toast("网络异常，请重试", { tone: "warn" });
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="studio-press inline-flex items-center gap-2 rounded-[12px] bg-[var(--red)] px-5 py-3 text-[14px] font-bold text-white shadow-[0_2px_10px_rgba(0,0,0,0.18)] transition-all hover:brightness-105"
      >
        ＋ 发帖
      </button>
    );
  }

  return (
    <div className="studio-rise rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]">
      <div className="flex items-center justify-between">
        <div className="mono text-[11px] uppercase tracking-[0.12em] text-[var(--ink3)]">发一条到广场</div>
        <button
          onClick={() => { setOpen(false); setResult(null); }}
          className="studio-press inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--ink3)] transition-colors hover:bg-[var(--surface-inset)] hover:text-[var(--ink)]"
          aria-label="关闭"
        >
          <X size={15} />
        </button>
      </div>

      {/* 类型选择 */}
      <div className="mt-3 flex flex-wrap gap-2">
        {TYPES.map((t) => {
          const Icon = t.icon;
          const active = type === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setType(t.key)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${
                active
                  ? "bg-[var(--red-soft)] text-[var(--red)] border border-[var(--red-soft-border)]"
                  : "border border-[var(--border)] bg-[var(--surface)] text-[var(--ink3)] hover:text-[var(--ink)]"
              }`}
            >
              <Icon size={14} weight={active ? "fill" : "regular"} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* 内容输入 */}
      <textarea
        value={content}
        onChange={(e) => { setContent(e.target.value); if (result) setResult(null); }}
        maxLength={800}
        rows={4}
        placeholder={TYPES.find((t) => t.key === type)?.placeholder}
        className="mt-3 w-full resize-none rounded-[12px] border border-[var(--border)] bg-[var(--surface-inset)] px-3.5 py-3 text-[14px] leading-[1.65] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--ink3)]"
      />

      {/* 审核结果提示 */}
      {result && (
        <div
          className={`mt-2 rounded-[10px] px-3 py-2 text-[12.5px] ${
            result.status === "pending"
              ? "border border-[var(--border)] bg-[var(--surface-inset)] text-[var(--ink2)]"
              : "border border-[var(--red-soft-border)] bg-[var(--red-soft)] text-[var(--red)]"
          }`}
        >
          {result.status === "pending" ? "⏳ " : "⚠️ "}
          {result.message}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span className="mono text-[11px] text-[var(--ink4)]">
          {content.length}/800 · 发布前会经过内容审核，禁止外链与广告
        </span>
        <button
          onClick={submit}
          disabled={loading || content.trim().length < 4}
          className="studio-press inline-flex items-center gap-1.5 rounded-[11px] bg-[var(--red)] px-4 py-2 text-[13px] font-bold text-white transition-all hover:brightness-105 disabled:opacity-50"
        >
          <PaperPlaneRight size={14} weight="fill" />
          {loading ? "审核中…" : "发布"}
        </button>
      </div>
    </div>
  );
}
