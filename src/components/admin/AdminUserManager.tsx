"use client";

import { Fragment, useEffect, useState, useCallback } from "react";
import { useToast } from "@/components/Toast";

interface UserRow {
  id: string;
  nickname: string;
  email: string | null;
  phone: string | null;
  role: string;
  deletedAt: string | null;
  createdAt: string;
  notesCount: number;
  ordersCount: number;
  subscriptionStatus: string;
}

const ROLES = ["user", "admin", "content_manager", "demand_moderator", "support", "finance", "reviewer"];
const ROLE_LABEL: Record<string, string> = {
  user: "用户", admin: "超级管理员", content_manager: "内容管理", demand_moderator: "需求审核",
  support: "客服", finance: "财务", reviewer: "审核员",
};

const inputCls =
  "rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--ink3)]";
const btnGhost =
  "rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--ink)] transition-colors hover:border-[var(--ink3)] disabled:opacity-40";

/**
 * 用户管理台：列表 + 展开行的管理动作。写动作仅超级管理员可见（isSuperAdmin）。
 * 读列表走既有 GET /api/admin/users；创建走 POST；行内动作走 PATCH /[id]；
 * 发积分走 /api/admin/credits/grant；赠会员走 /api/admin/subscriptions/grant。
 */
export function AdminUserManager({ isSuperAdmin, currentUserId }: { isSuperAdmin: boolean; currentUserId: string }) {
  const { toast } = useToast();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const json = await fetch("/api/admin/users").then((r) => r.json());
      if (json.ok) setUsers(json.data.users as UserRow[]);
      else toast(json.error ?? "加载失败", { tone: "warn" });
    } catch {
      toast("网络异常，请重试", { tone: "warn" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5">
      {isSuperAdmin && <CreateUserForm onCreated={load} />}

      <div className="flex items-center justify-between">
        <p className="text-[13px] text-[var(--ink3)]">共 {users?.length ?? 0} 位用户</p>
        <button onClick={load} disabled={loading} className={btnGhost}>{loading ? "刷新中…" : "刷新"}</button>
      </div>

      <div className="overflow-x-auto rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card)]">
        <table className="w-full text-[13px]">
          <thead className="border-b border-[var(--border)] text-left text-[var(--ink4)]">
            <tr>
              <th className="px-3 py-2.5 font-medium">昵称</th>
              <th className="px-3 py-2.5 font-medium">账号</th>
              <th className="px-3 py-2.5 font-medium">角色</th>
              <th className="px-3 py-2.5 font-medium">订阅</th>
              <th className="px-3 py-2.5 font-medium">状态</th>
              {isSuperAdmin && <th className="px-3 py-2.5 font-medium">管理</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {(users ?? []).map((u) => (
              <Fragment key={u.id}>
                <tr className={u.deletedAt ? "opacity-55" : ""}>
                  <td className="px-3 py-2.5 font-medium text-[var(--ink)]">{u.nickname}</td>
                  <td className="mono px-3 py-2.5 text-[var(--ink3)]">{u.email ?? u.phone ?? "—"}</td>
                  <td className="px-3 py-2.5 text-[var(--ink2)]">{ROLE_LABEL[u.role] ?? u.role}</td>
                  <td className="px-3 py-2.5">
                    <span className={`mono inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${u.subscriptionStatus === "active" ? "bg-[var(--ok-soft)] text-[var(--ok)]" : "bg-[var(--surface-inset)] text-[var(--ink3)]"}`}>{u.subscriptionStatus}</span>
                  </td>
                  <td className="px-3 py-2.5">{u.deletedAt ? <span className="text-[var(--red)]">已停用</span> : <span className="text-[var(--ink4)]">正常</span>}</td>
                  {isSuperAdmin && (
                    <td className="px-3 py-2.5">
                      <button onClick={() => setExpanded(expanded === u.id ? null : u.id)} className={btnGhost}>
                        {expanded === u.id ? "收起" : "管理"}
                      </button>
                    </td>
                  )}
                </tr>
                {isSuperAdmin && expanded === u.id && (
                  <tr>
                    <td colSpan={6} className="bg-[var(--surface2)] px-3 py-4">
                      <UserActions user={u} currentUserId={currentUserId} onChanged={load} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CreateUserForm({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() && !phone.trim()) return toast("请提供邮箱或手机号", { tone: "warn" });
    if (!password) return toast("请填写初始密码", { tone: "warn" });
    setBusy(true);
    try {
      const json = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nickname: nickname.trim() || undefined, email: email.trim() || undefined, phone: phone.trim() || undefined, password, role }),
      }).then((r) => r.json());
      if (json.ok) {
        toast(`已创建账号 ${json.data.nickname}`, { tone: "success" });
        setNickname(""); setEmail(""); setPhone(""); setPassword(""); setRole("user");
        onCreated();
      } else {
        toast(json.error ?? "创建失败", { tone: "warn" });
      }
    } catch {
      toast("网络异常，请重试", { tone: "warn" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)]">
      <p className="mb-3 text-[14px] font-semibold text-[var(--ink)]">创建账号</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] text-[var(--ink3)]">昵称（可空）
          <input value={nickname} onChange={(e) => setNickname(e.target.value)} className={`${inputCls} w-[140px]`} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-[var(--ink3)]">邮箱
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@x.com" className={`${inputCls} mono w-[180px]`} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-[var(--ink3)]">手机号
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="可选" className={`${inputCls} mono w-[140px]`} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-[var(--ink3)]">初始密码
          <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="≥8 位含字母数字" className={`${inputCls} mono w-[170px]`} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-[var(--ink3)]">角色
          <select value={role} onChange={(e) => setRole(e.target.value)} className={`${inputCls} w-[140px]`}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </label>
        <button type="submit" disabled={busy} className="rounded-[10px] bg-[var(--ink)] px-4 py-2 text-[13px] font-semibold text-[var(--surface)] transition-opacity hover:opacity-90 disabled:opacity-40">
          {busy ? "创建中…" : "创建"}
        </button>
      </div>
      <p className="mt-2 text-[12px] text-[var(--ink4)]">初始密码由管理员设定并线下告知用户；密码明文不落库，仅存哈希。</p>
    </form>
  );
}

function UserActions({ user, currentUserId, onChanged }: { user: UserRow; currentUserId: string; onChanged: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [role, setRole] = useState(user.role);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [memberDays, setMemberDays] = useState("");
  const [memberReason, setMemberReason] = useState("");
  const isSelf = user.id === currentUserId;

  async function post(url: string, body: object, key: string, okMsg: string) {
    setBusy(key);
    try {
      const method = url.includes("/users/") ? "PATCH" : "POST";
      const json = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
      if (json.ok) { toast(okMsg, { tone: "success" }); onChanged(); return json.data; }
      toast(json.error ?? "操作失败", { tone: "warn" });
    } catch {
      toast("网络异常，请重试", { tone: "warn" });
    } finally {
      setBusy(null);
    }
    return null;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* 停用/启用 + 改角色 */}
      <div className="space-y-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3.5">
        <p className="text-[12px] font-semibold text-[var(--ink2)]">账号状态与角色</p>
        <div className="flex flex-wrap items-center gap-2">
          {user.deletedAt ? (
            <button disabled={busy === "enable"} onClick={() => post(`/api/admin/users/${user.id}`, { action: "enable" }, "enable", "已启用")} className={btnGhost}>启用账号</button>
          ) : (
            <button disabled={busy === "disable" || isSelf} title={isSelf ? "不能停用自己" : ""} onClick={() => post(`/api/admin/users/${user.id}`, { action: "disable" }, "disable", "已停用并吊销会话")} className={btnGhost}>停用账号</button>
          )}
          <select value={role} onChange={(e) => setRole(e.target.value)} className={`${inputCls} w-[130px]`}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          <button disabled={busy === "role" || role === user.role} onClick={() => post(`/api/admin/users/${user.id}`, { action: "change-role", role }, "role", "角色已更新")} className={btnGhost}>改角色</button>
        </div>
      </div>

      {/* 重置密码 */}
      <div className="space-y-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3.5">
        <p className="text-[12px] font-semibold text-[var(--ink2)]">重置密码</p>
        <div className="flex flex-wrap items-center gap-2">
          <input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="新密码（≥8 位含字母数字）" className={`${inputCls} mono min-w-[200px] flex-1`} />
          <button disabled={busy === "pw" || !newPassword} onClick={async () => { const d = await post(`/api/admin/users/${user.id}`, { action: "reset-password", password: newPassword }, "pw", "密码已重置并吊销会话"); if (d) setNewPassword(""); }} className={btnGhost}>重置</button>
        </div>
      </div>

      {/* 发积分 */}
      <div className="space-y-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3.5">
        <p className="text-[12px] font-semibold text-[var(--ink2)]">发放积分</p>
        <div className="flex flex-wrap items-center gap-2">
          <input type="number" min={1} value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} placeholder="积分数" className={`${inputCls} mono w-[100px]`} />
          <input value={creditReason} onChange={(e) => setCreditReason(e.target.value)} placeholder="发放原因" className={`${inputCls} min-w-[140px] flex-1`} />
          <button disabled={busy === "credit"} onClick={async () => { const amt = Number(creditAmount); if (!Number.isInteger(amt) || amt <= 0) return toast("积分须为正整数", { tone: "warn" }); if (!creditReason.trim()) return toast("请填写原因", { tone: "warn" }); const d = await post("/api/admin/credits/grant", { userId: user.id, amount: amt, reason: creditReason.trim() }, "credit", "积分已发放"); if (d) { setCreditAmount(""); setCreditReason(""); } }} className={btnGhost}>发放</button>
        </div>
      </div>

      {/* 赠会员 */}
      <div className="space-y-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3.5">
        <p className="text-[12px] font-semibold text-[var(--ink2)]">赠送会员</p>
        <div className="flex flex-wrap items-center gap-2">
          <input type="number" min={1} value={memberDays} onChange={(e) => setMemberDays(e.target.value)} placeholder="天数" className={`${inputCls} mono w-[90px]`} />
          <input value={memberReason} onChange={(e) => setMemberReason(e.target.value)} placeholder="原因（可空）" className={`${inputCls} min-w-[140px] flex-1`} />
          <button disabled={busy === "member"} onClick={async () => { const d = Number(memberDays); if (!Number.isInteger(d) || d <= 0) return toast("天数须为正整数", { tone: "warn" }); const r = await post("/api/admin/subscriptions/grant", { userId: user.id, days: d, reason: memberReason.trim() || undefined }, "member", "会员已赠送"); if (r) { setMemberDays(""); setMemberReason(""); } }} className={btnGhost}>赠送</button>
        </div>
      </div>
    </div>
  );
}
