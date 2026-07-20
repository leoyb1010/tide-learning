"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PaperPlaneRight, CheckCircle, HourglassMedium, GraduationCap } from "@phosphor-icons/react";
import { useToast } from "./Toast";
import { track } from "@/lib/analytics-client";

// 当前用户对该课的申请态（server 预取）。
export type RequestState = "none" | "pending" | "approved" | "rejected";

/**
 * MarketRequestButton —— 课程集市卡片上的「申请学习」按钮（client）。
 * 调 /api/market/request。已申请/已获权/已拒绝时显示对应态且禁用。
 * 展开一个小留言框（可选），提交后本地切到 pending 并 toast。STUDIO token。
 */
export function MarketRequestButton({
  courseId,
  courseTitle,
  initialState,
}: {
  courseId: string;
  courseTitle: string;
  initialState: RequestState;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [state, setState] = useState<RequestState>(initialState);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/market/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseId, message: message.trim() || undefined }),
      });
      const json = (await res.json()) as
        | { ok: true; data: { status: string; message: string } }
        | { ok: false; error: string };
      if (!json.ok) {
        toast(json.error, { tone: "warn" });
        return;
      }
      const status = json.data.status as RequestState;
      setState(status === "none" ? "pending" : status);
      setOpen(false);
      setMessage("");
      toast(json.data.message, { tone: "success" });
      track("market_request", { course_id: courseId });
      router.refresh();
    } catch {
      toast("网络异常，请重试", { tone: "warn" });
    } finally {
      setLoading(false);
    }
  }

  // 非「未申请」态：显示只读状态徽标。
  if (state === "approved") {
    return (
      <span className="inline-flex w-full items-center justify-center gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface-inset)] px-4 py-2.5 text-[13px] font-semibold text-[var(--ink2)]">
        <CheckCircle size={15} weight="fill" className="text-[var(--red)]" />
        已获学习权
      </span>
    );
  }
  if (state === "pending") {
    return (
      <span className="inline-flex w-full items-center justify-center gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface-inset)] px-4 py-2.5 text-[13px] font-semibold text-[var(--ink3)]">
        <HourglassMedium size={15} weight="fill" />
        申请审核中
      </span>
    );
  }
  if (state === "rejected") {
    return (
      <span className="inline-flex w-full items-center justify-center gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface-inset)] px-4 py-2.5 text-[13px] font-semibold text-[var(--ink4)]">
        申请未通过
      </span>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="studio-press inline-flex w-full items-center justify-center gap-1.5 rounded-[12px] bg-[var(--red)] px-4 py-2.5 text-[13px] font-bold text-white transition-all hover:brightness-105"
      >
        <GraduationCap size={15} weight="fill" />
        申请学习
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={200}
        rows={2}
        placeholder={`想对作者说点什么？（选填）想学《${courseTitle}》的原因…`}
        className="w-full resize-none rounded-[12px] border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-2.5 text-[13px] leading-[1.6] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--ink3)]"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={() => { setOpen(false); setMessage(""); }}
          className="studio-press rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-[13px] font-semibold text-[var(--ink3)] transition-colors hover:text-[var(--ink)]"
        >
          取消
        </button>
        <button
          onClick={submit}
          disabled={loading}
          className="studio-press inline-flex flex-1 items-center justify-center gap-1.5 rounded-[12px] bg-[var(--red)] px-4 py-2 text-[13px] font-bold text-white transition-all hover:brightness-105 disabled:opacity-50"
        >
          <PaperPlaneRight size={14} weight="fill" />
          {loading ? "提交中…" : "提交申请"}
        </button>
      </div>
    </div>
  );
}
