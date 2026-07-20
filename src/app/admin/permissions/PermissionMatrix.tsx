"use client";

import { useState, useTransition } from "react";

export type Cell = { perm: string; granted: boolean };
export type RoleRow = { role: string; source: "db" | "default"; cells: Cell[] };

const ROLE_LABELS: Record<string, string> = {
  admin: "超级管理员",
  content_manager: "内容运营",
  demand_moderator: "需求审核",
  support: "客服支持",
  finance: "财务",
  reviewer: "内容审核员",
};

const PERM_LABELS: Record<string, string> = {
  "course:write": "课程编辑",
  "demand:moderate": "需求审核",
  "order:read": "订单查看",
  "order:refund": "退款/补偿",
  "user:read": "用户查询",
  "lead:manage": "建联队列",
  "content:review": "内容审核",
  "dashboard:read": "运营看板",
};

type Props = {
  initialRows: RoleRow[];
  permissions: string[];
  defaults: Record<string, string[]>;
  adminLocked: string[];
};

export function PermissionMatrix({ initialRows, permissions, defaults, adminLocked }: Props) {
  const [rows, setRows] = useState<RoleRow[]>(initialRows);
  const [busy, setBusy] = useState<string | null>(null); // `${role}:${perm}` 或 `reset:${role}`
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const lockedSet = new Set(adminLocked);

  function isLocked(role: string, perm: string): boolean {
    return role === "admin" && lockedSet.has(perm);
  }

  async function toggle(role: string, perm: string, next: boolean) {
    const key = `${role}:${perm}`;
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/admin/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, permission: perm, granted: next }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? "操作失败");
        return;
      }
      applyRowUpdate(json.data);
    } catch {
      setError("网络异常，请重试");
    } finally {
      setBusy(null);
    }
  }

  async function resetRole(role: string) {
    const key = `reset:${role}`;
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(`/api/admin/permissions?role=${encodeURIComponent(role)}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? "重置失败");
        return;
      }
      applyRowUpdate(json.data);
    } catch {
      setError("网络异常，请重试");
    } finally {
      setBusy(null);
    }
  }

  function applyRowUpdate(data: { role: string; source: "db" | "default"; permissions: Cell[] }) {
    startTransition(() => {
      setRows((prev) =>
        prev.map((r) =>
          r.role === data.role ? { role: r.role, source: data.source, cells: data.permissions } : r,
        ),
      );
    });
  }

  return (
    <div className="space-y-5">
      <header className="space-y-1.5">
        <p className="mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink3)]">RBAC · 权限矩阵</p>
        <h1 className="text-[22px] font-bold text-[var(--ink)]">权限矩阵管理</h1>
        <p className="text-[13px] leading-[1.6] text-[var(--ink3)]">
          勾选即写入数据库覆盖，取消勾选即收回；未覆盖的角色沿用代码默认。改动最迟 10 秒内全站生效。
          超级管理员的核心权限不可移除（防自锁）。
        </p>
      </header>

      {error && (
        <div className="rounded-[14px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-4 py-3 text-[13px] text-[var(--red-ink)]">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card)]">
        <table className="w-full min-w-[720px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="sticky left-0 z-10 bg-[var(--surface2)] px-4 py-3 text-left font-semibold text-[var(--ink)]">
                角色 \ 权限
              </th>
              {permissions.map((perm) => (
                <th
                  key={perm}
                  className="px-3 py-3 text-center align-bottom font-medium text-[var(--ink2)]"
                >
                  <span className="block text-[12px]">{PERM_LABELS[perm] ?? perm}</span>
                  <span className="mono mt-0.5 block text-[10px] text-[var(--ink4)]">{perm}</span>
                </th>
              ))}
              <th className="px-4 py-3 text-right font-medium text-[var(--ink2)]">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isDefaultDefaults = (defaults[row.role] ?? []).length; // for stable ref only
              void isDefaultDefaults;
              const resetting = busy === `reset:${row.role}`;
              return (
                <tr key={row.role} className="border-b border-[var(--border)] last:border-b-0">
                  <td className="sticky left-0 z-10 bg-[var(--surface)] px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[var(--ink)]">
                        {ROLE_LABELS[row.role] ?? row.role}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className="mono text-[10px] text-[var(--ink4)]">{row.role}</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                          row.source === "db"
                            ? "bg-[var(--red-soft)] text-[var(--red-ink)]"
                            : "bg-[var(--surface-inset)] text-[var(--ink3)]"
                        }`}
                      >
                        {row.source === "db" ? "已覆盖" : "代码默认"}
                      </span>
                    </div>
                  </td>
                  {row.cells.map((cell) => {
                    const key = `${row.role}:${cell.perm}`;
                    const locked = isLocked(row.role, cell.perm);
                    const pending = busy === key;
                    return (
                      <td key={cell.perm} className="px-3 py-3 text-center">
                        <label className="inline-flex items-center justify-center">
                          <input
                            type="checkbox"
                            checked={cell.granted}
                            disabled={locked || pending || resetting}
                            onChange={(e) => toggle(row.role, cell.perm, e.target.checked)}
                            title={locked ? "核心权限不可移除（防自锁）" : undefined}
                            className="h-[18px] w-[18px] cursor-pointer rounded-[5px] border border-[var(--border2)] bg-[var(--surface)] accent-[var(--red)] transition-colors focus:border-[var(--ink3)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-45"
                          />
                        </label>
                      </td>
                    );
                  })}
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => resetRole(row.role)}
                      disabled={row.source !== "db" || resetting}
                      className="studio-press rounded-[10px] border border-[var(--border)] bg-[var(--surface2)] px-3 py-1.5 text-[12px] font-medium text-[var(--ink2)] transition-colors hover:border-[var(--border2)] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {resetting ? "重置中…" : "重置默认"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[12px] leading-[1.6] text-[var(--ink4)]">
        「重置默认」清空该角色在数据库中的全部覆盖记录，回退到代码内置矩阵。所有变更均写入审计日志（
        <span className="mono">permission_change</span>）。
      </p>
    </div>
  );
}
