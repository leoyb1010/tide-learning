"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }
  return (
    <button onClick={logout} className="w-full rounded-xl border border-ink-200 bg-white px-4 py-3 text-left text-sm text-ink-800 hover:border-error hover:text-error">
      退出登录
    </button>
  );
}

/** 取消订阅（§6.7：入口可见，一屏挽留但不隐藏取消按钮）。 */
export function CancelSubscription() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState("");

  async function cancel() {
    setLoading(true);
    await fetch("/api/subscription/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    setLoading(false);
    setConfirming(false);
    router.refresh();
  }

  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} className="text-sm text-ink-500 underline hover:text-error">
        取消订阅
      </button>
    );
  }
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-4">
      <p className="text-sm font-medium text-ink-950">确定要取消吗？</p>
      <p className="mt-1.5 text-sm text-ink-500">
        取消后：当前周期结束前仍可学习，之后课程锁定。
        <span className="text-ink-950">你的笔记会永久保留，可继续查看和导出。</span>
      </p>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="可以告诉我们原因吗？（可选）" className="mt-3 w-full resize-none rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-accent-400" />
      <div className="mt-3 flex gap-2">
        <button onClick={() => setConfirming(false)} className="flex-1 rounded-lg bg-accent-600 py-2.5 text-sm font-medium text-white">继续订阅</button>
        <button onClick={cancel} disabled={loading} className="rounded-lg border border-ink-200 px-4 py-2.5 text-sm text-ink-500 hover:text-error">
          {loading ? "处理中…" : "确认取消"}
        </button>
      </div>
    </div>
  );
}

export function RestoreButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  return (
    <button
      onClick={async () => { setLoading(true); await fetch("/api/subscription/restore", { method: "POST" }); setLoading(false); router.refresh(); }}
      className="text-sm text-accent-700 hover:underline"
    >
      {loading ? "恢复中…" : "恢复购买"}
    </button>
  );
}
