"use client";

import { useState } from "react";

/**
 * 预约试听（0转正入口）— 融合有道端内/端外留资 + 电联建联漏斗。
 * 未登录也可留手机号；登录用户一键预约。留资后进入后台跟进队列。
 */
export function TrialBooking({ courseId, track, source }: { courseId: string; track: string; source?: string }) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    await fetch("/api/leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ courseId, track, phone, name, source: source ?? "youdao_dict" }),
    });
    setLoading(false);
    setDone(true);
  }

  if (done) {
    return (
      <div className="rounded-xl bg-success/10 px-4 py-3 text-sm text-success">
        ✅ 预约成功！我们会尽快与你联系安排试听。
      </div>
    );
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="w-full rounded-xl border border-tide-600 py-3 text-sm font-medium text-tide-700 hover:bg-tide-50">
        预约免费试听（含直播小班）
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-ink-100 bg-white p-4">
      <p className="text-sm font-medium text-ink-950">留下联系方式，安排试听</p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="称呼（可选）" className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-tide-400" />
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="手机号" className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-tide-400" />
      <button onClick={submit} disabled={loading || !phone} className="w-full rounded-lg bg-tide-600 py-2.5 text-sm font-medium text-white disabled:opacity-50">
        {loading ? "提交中…" : "确认预约"}
      </button>
      <p className="text-xs text-ink-400">仅用于安排试听与课程通知，不做其他用途。</p>
    </div>
  );
}
