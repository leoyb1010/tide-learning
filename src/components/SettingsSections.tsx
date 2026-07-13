"use client";

import { useState } from "react";
import { useToast } from "./Toast";

/* ============================================================
 * 设置中心 · 客户端交互岛（STUDIO v2 token）
 * ============================================================ */

/** 修改密码表单（第三方登录用户不渲染此表单，由父组件按 authProvider 判断）。 */
export function ChangePasswordForm() {
  const { toast } = useToast();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirmPassword, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!currentPassword || !newPassword) return setErr("请填写当前密码和新密码");
    if (newPassword !== confirmPassword) return setErr("两次输入的新密码不一致");
    setLoading(true);
    try {
      const res = await fetch("/api/account/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const json = (await res.json().catch(() => ({ ok: false, error: "网络异常" }))) as {
        ok: boolean;
        error?: string;
      };
      if (!json.ok) {
        setErr(json.error ?? "修改失败");
        toast(json.error ?? "修改失败", { tone: "warn" });
        return;
      }
      setCurrent("");
      setNew("");
      setConfirm("");
      toast("密码已修改，请重新登录", { tone: "success" });
      // 改密后会话已被吊销，跳登录
      setTimeout(() => {
        window.location.href = "/login?next=/me/settings";
      }, 1200);
    } finally {
      setLoading(false);
    }
  }

  const inputCls =
    "w-full rounded-[10px] border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-2.5 text-[14px] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--ink3)]";

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="mb-1.5 block text-[12px] text-[var(--ink3)]">当前密码</label>
        <input
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrent(e.target.value)}
          className={inputCls}
          placeholder="请输入当前密码"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-[12px] text-[var(--ink3)]">新密码</label>
        <input
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNew(e.target.value)}
          className={inputCls}
          placeholder="至少 8 位，含字母和数字"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-[12px] text-[var(--ink3)]">确认新密码</label>
        <input
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirm(e.target.value)}
          className={inputCls}
          placeholder="再次输入新密码"
        />
      </div>
      {err && <p className="text-[12px] text-[var(--red)]">{err}</p>}
      <button
        type="submit"
        disabled={loading}
        className="studio-press inline-flex items-center gap-1.5 rounded-[10px] bg-[var(--red)] px-4 py-2.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {loading ? "提交中…" : "修改密码"}
      </button>
    </form>
  );
}

/** 通知开关组（本地状态；保留原有两项）。 */
export function NotificationToggles() {
  const [courseNew, setCourseNew] = useState(true);
  const [demandLive, setDemandLive] = useState(true);
  return (
    <div className="divide-y divide-[var(--border)]">
      <ToggleRow
        label="课程上新提醒"
        hint="有新课程发布时通知我"
        checked={courseNew}
        onChange={setCourseNew}
      />
      <ToggleRow
        label="我投票的需求上线通知"
        hint="我参与共创的需求上线后提醒我"
        checked={demandLive}
        onChange={setDemandLive}
      />
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-[var(--ink)]">{label}</p>
        {hint && <p className="mt-0.5 text-[12px] text-[var(--ink3)]">{hint}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        aria-label={label}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
          checked ? "bg-[var(--red)]" : "bg-[var(--surface-inset)]"
        }`}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-[var(--surface)] shadow-[var(--card)] transition-transform ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

/** 注销账号（红色警示，显式确认；密码账号额外校验当前密码）。 */
export function DeleteAccountButton({ requiresPassword }: { requiresPassword: boolean }) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function erase() {
    setError(null);
    if (confirmation !== "注销账号") return setError("请输入“注销账号”以确认");
    if (requiresPassword && !password) return setError("请输入当前密码");
    setLoading(true);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password, confirmation: "DELETE_ACCOUNT" }),
      });
      const json = await res.json().catch(() => ({ ok: false, error: "网络异常" }));
      if (!json.ok) {
        setError(json.error || "注销失败");
        return;
      }
      toast("账号已注销，个人数据已清除", { tone: "success" });
      window.location.assign("/login?deleted=1");
    } finally {
      setLoading(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-[10px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-4 py-2.5 text-[13px] font-semibold text-[var(--red)] transition-opacity hover:opacity-90"
      >
        注销账号
      </button>
    );
  }
  return (
    <div className="rounded-[12px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] p-4">
      <p className="text-[14px] font-bold text-[var(--ink)]">确定要注销账号吗？</p>
      <p className="mt-1.5 text-[12px] text-[var(--ink2)]">
        注销为不可逆操作，将清除你的学习记录与个人资料。建议先
        <span className="font-semibold text-[var(--ink)]"> 导出笔记 </span>
        备份。继续操作需输入下方确认文字{requiresPassword ? "并验证当前密码" : ""}。
      </p>
      <label className="mt-3 block text-[12px] font-medium text-[var(--ink2)]">
        输入“注销账号”
        <input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className="mt-1.5 w-full rounded-[9px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px]" />
      </label>
      {requiresPassword && (
        <label className="mt-3 block text-[12px] font-medium text-[var(--ink2)]">
          当前密码
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5 w-full rounded-[9px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px]" />
        </label>
      )}
      {error && <p className="mt-2 text-[12px] font-medium text-[var(--red)]">{error}</p>}
      <div className="mt-3 flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[13px] font-semibold text-[var(--ink)] transition-colors hover:border-[var(--border2)]"
        >
          取消
        </button>
        <button
          type="button"
          onClick={erase}
          disabled={loading || confirmation !== "注销账号" || (requiresPassword && !password)}
          className="rounded-[10px] border border-[var(--red-soft-border)] px-4 py-2 text-[13px] font-semibold text-[var(--red)] transition-opacity hover:opacity-90"
        >
          {loading ? "正在注销…" : "永久注销账号"}
        </button>
      </div>
    </div>
  );
}
