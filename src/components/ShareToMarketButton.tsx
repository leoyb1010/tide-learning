"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Export, CheckCircle, HourglassMedium } from "@phosphor-icons/react";
import { useToast } from "./Toast";
import { track } from "@/lib/analytics-client";

export type ShareState = "private" | "pending" | "shared" | "rejected";

/**
 * ShareToMarketButton —— 「我的课」卡片上的「分享到社区」按钮（client）。
 * 调 /api/market/share。分享前服务端 LLM 审核课程标题+简介：
 *   shared → 已上架；pending → 转人工；rejected → 返回 fail 文案。
 * 已上架/审核中显示只读态。STUDIO token。
 */
export function ShareToMarketButton({
  courseId,
  initialStatus,
}: {
  courseId: string;
  initialStatus: ShareState;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [status, setStatus] = useState<ShareState>(initialStatus);
  const [loading, setLoading] = useState(false);

  async function share() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/market/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseId }),
      });
      const json = (await res.json()) as
        | { ok: true; data: { status: string; message: string } }
        | { ok: false; error: string };
      if (!json.ok) {
        // 审核不通过（rejected）也走这里：标红提示，本地切到 rejected。
        setStatus("rejected");
        toast(json.error, { tone: "warn" });
        return;
      }
      const next = json.data.status as ShareState;
      setStatus(next);
      toast(json.data.message, { tone: next === "shared" ? "success" : "info" });
      track("market_share", { course_id: courseId, status: next });
      router.refresh();
    } catch {
      toast("网络异常，请重试", { tone: "warn" });
    } finally {
      setLoading(false);
    }
  }

  if (status === "shared") {
    return (
      <span className="inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-1.5 text-[12px] font-semibold text-[var(--ink2)]">
        <CheckCircle size={13} weight="fill" className="text-[var(--red)]" />
        已在集市
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-1.5 text-[12px] font-semibold text-[var(--ink3)]">
        <HourglassMedium size={13} weight="fill" />
        审核中
      </span>
    );
  }

  return (
    <button
      onClick={share}
      disabled={loading}
      className="studio-press inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[12px] font-semibold text-[var(--ink2)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)] disabled:opacity-50"
    >
      <Export size={13} weight="bold" />
      {loading ? "审核中…" : status === "rejected" ? "重新分享" : "分享到社区"}
    </button>
  );
}
