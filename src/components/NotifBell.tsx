"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Bell,
  UserPlus,
  CheckCircle,
  XCircle,
  ChatCircleDots,
  HandHeart,
  BookOpen,
  Coins,
  Info,
  Check,
} from "@phosphor-icons/react/dist/ssr";
import { track } from "@/lib/analytics-client";

/** 通知项（与 /api/notifications GET 返回结构一致）。 */
interface NotifItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  refType: string | null;
  refId: string | null;
  read: boolean;
  createdAt: string;
}

const ICON_FOR: Record<string, typeof Bell> = {
  access_request: UserPlus,
  access_approved: CheckCircle,
  access_rejected: XCircle,
  post_comment: ChatCircleDots,
  post_like: HandHeart,
  course_update: BookOpen,
  credit_grant: Coins,
  system: Info,
};

/** 相对时间文案（分钟/小时/天，超 7 天回落到日期）。挂载后计算，避免 hydration 抖动。 */
function formatWhen(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric" });
}

/** 通知 → 目标路由（refType=course→课程库；post→自习室；request→我的分享）。 */
function hrefFor(n: NotifItem): string {
  switch (n.refType) {
    case "course":
      return n.refId ? `/courses/${n.refId}` : "/courses";
    case "post":
      return "/demands"; // 自习室广场（社区）入口
    case "request":
      return "/me/courses"; // 我的分享 / 学习申请管理
    default:
      return "/me";
  }
}

/**
 * NotifBell — Topbar 铃铛（G3 通知 UI 读取端）。
 * 未读红点角标（--red，信号色）；点击弹下拉面板列出最近通知。
 * 每条：type 图标 + title + body + 相对时间，未读高亮；「全部已读」一键清角标。
 * 数据来自 /api/notifications（GET 列表 + 未读数；PATCH 标记已读）。
 */
export function NotifBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotifItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 拉列表 + 未读数
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { ok: boolean; data?: { items: NotifItem[]; unread: number } };
      if (json.ok && json.data) {
        setItems(json.data.items);
        setUnread(json.data.unread);
      }
    } catch {
      /* 通知非关键路径，失败静默 */
    } finally {
      setLoaded(true);
    }
  }, []);

  // 首帧拉未读数；此后每 60s 轮询角标
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  // 点击外部关闭面板
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      track("notif_open", { unread });
      void load(); // 打开时刷新一次，拿到最新
    }
  };

  const markAll = async () => {
    // 乐观更新：先清角标，再落库
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
    } catch {
      /* 失败静默；下次轮询会纠正 */
    }
    track("notif_read_all", {});
  };

  const markOne = async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnread((u) => Math.max(0, u - 1));
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {
      /* 失败静默 */
    }
  };

  return (
    <div ref={rootRef} className="relative">
      {/* 铃铛按钮 + 未读红点角标 */}
      <button
        onClick={toggle}
        className="relative grid h-[38px] w-[38px] place-items-center rounded-[12px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink2)] transition-colors hover:text-[var(--ink)] focus:border-[var(--ink3)] focus:outline-none"
        title={unread > 0 ? `通知（${unread} 条未读）` : "通知"}
        aria-label={unread > 0 ? `通知（${unread} 条未读）` : "通知"}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <Bell size={18} weight={unread > 0 ? "fill" : "regular"} />
        {unread > 0 && (
          <span
            className="mono absolute -right-1 -top-1 grid h-[17px] min-w-[17px] place-items-center rounded-full px-1 text-[10px] font-semibold leading-none text-white"
            style={{ background: "var(--red)" }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {/* 下拉面板 */}
      {open && (
        <div
          className="studio-rise absolute right-0 top-[calc(100%+8px)] z-30 w-[340px] overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--lift)]"
          role="menu"
        >
          {/* 头部 */}
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
            <span className="text-[14px] font-semibold text-[var(--ink)]">通知</span>
            {unread > 0 && (
              <button
                onClick={markAll}
                className="flex items-center gap-1 text-[12px] text-[var(--ink3)] transition-colors hover:text-[var(--ink)]"
              >
                <Check size={13} />
                全部已读
              </button>
            )}
          </div>

          {/* 列表 */}
          <div className="max-h-[380px] overflow-y-auto">
            {!loaded ? (
              <div className="px-4 py-8 text-center text-[13px] text-[var(--ink4)]">加载中…</div>
            ) : items.length === 0 ? (
              <div className="px-4 py-10 text-center text-[13px] text-[var(--ink4)]">暂无通知</div>
            ) : (
              items.map((n) => {
                const Icon = ICON_FOR[n.type] ?? Info;
                return (
                  <Link
                    key={n.id}
                    href={hrefFor(n)}
                    onClick={() => {
                      if (!n.read) void markOne(n.id);
                      setOpen(false);
                      track("notif_click", { type: n.type, refType: n.refType });
                    }}
                    className="flex gap-3 border-b border-[var(--border)] px-4 py-3 transition-colors last:border-b-0 hover:bg-[var(--surface2)]"
                    style={n.read ? undefined : { background: "var(--red-soft)" }}
                    role="menuitem"
                  >
                    <span
                      className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[var(--surface-inset)] text-[var(--ink2)]"
                      aria-hidden
                    >
                      <Icon size={16} weight={n.read ? "regular" : "fill"} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start gap-2">
                        <span
                          className={`flex-1 text-[13px] leading-snug ${
                            n.read ? "text-[var(--ink2)]" : "font-semibold text-[var(--ink)]"
                          }`}
                        >
                          {n.title}
                        </span>
                        {!n.read && (
                          <span
                            className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ background: "var(--red)" }}
                            aria-hidden
                          />
                        )}
                      </span>
                      {n.body && (
                        <span className="mt-0.5 block truncate text-[12px] text-[var(--ink3)]">{n.body}</span>
                      )}
                      <span className="mono mt-1 block text-[11px] text-[var(--ink4)]">{formatWhen(n.createdAt)}</span>
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
