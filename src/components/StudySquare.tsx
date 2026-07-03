"use client";

import { useEffect, useState, useCallback } from "react";
import { Lightbulb, CheckCircle, Question, Heart } from "@phosphor-icons/react";
import { PostComposer } from "./PostComposer";
import { useToast } from "./Toast";
import { track } from "@/lib/analytics-client";

// 帖子视图（与 /api/posts GET 返回对齐）
interface PostView {
  id: string;
  type: string;
  content: string;
  likeCount: number;
  createdAt: string;
  author: { nickname: string; avatarUrl: string | null };
  likedByMe: boolean;
}

// 三类帖子的展示元数据
const TYPE_META: Record<string, { label: string; icon: typeof Lightbulb }> = {
  insight: { label: "学习心得", icon: Lightbulb },
  checkin: { label: "打卡", icon: CheckCircle },
  question: { label: "求助", icon: Question },
};

const FILTERS: { key: string | null; label: string }[] = [
  { key: null, label: "全部" },
  { key: "insight", label: "心得" },
  { key: "checkin", label: "打卡" },
  { key: "question", label: "求助" },
];

/**
 * StudySquare —— 自习室广场（轻社区）。
 * 展示 approved 帖子列表，类型筛选，点赞（幂等）。
 * 顶部发帖入口仅 canPost（登录+订阅）用户可见。游客/免费用户看只读列表。
 */
export function StudySquare({ canPost, isLoggedIn }: { canPost: boolean; isLoggedIn: boolean }) {
  const { toast } = useToast();
  const [posts, setPosts] = useState<PostView[]>([]);
  const [filter, setFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = filter ? `/api/posts?type=${filter}` : "/api/posts";
      const res = await fetch(url);
      const json = (await res.json()) as { ok: true; data: { posts: PostView[] } } | { ok: false };
      if (json.ok) setPosts(json.data.posts);
    } catch {
      /* 静默：列表加载失败保持空态 */
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function like(id: string) {
    if (!isLoggedIn) {
      toast("登录后可点赞", { tone: "info" });
      return;
    }
    // 乐观更新
    setPosts((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, likedByMe: !p.likedByMe, likeCount: p.likeCount + (p.likedByMe ? -1 : 1) } : p,
      ),
    );
    try {
      const res = await fetch(`/api/posts/${id}/like`, { method: "POST", headers: { "content-type": "application/json" } });
      const json = (await res.json()) as { ok: true; data: { liked: boolean; likeCount: number } } | { ok: false; error: string };
      if (json.ok) {
        setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, likedByMe: json.data.liked, likeCount: json.data.likeCount } : p)));
        if (json.data.liked) track("post_like", { post_id: id });
      } else {
        // 回滚
        setPosts((prev) =>
          prev.map((p) =>
            p.id === id ? { ...p, likedByMe: !p.likedByMe, likeCount: p.likeCount + (p.likedByMe ? -1 : 1) } : p,
          ),
        );
        toast(json.error, { tone: "warn" });
      }
    } catch {
      setPosts((prev) =>
        prev.map((p) =>
          p.id === id ? { ...p, likedByMe: !p.likedByMe, likeCount: p.likeCount + (p.likedByMe ? -1 : 1) } : p,
        ),
      );
      toast("网络异常，请重试", { tone: "warn" });
    }
  }

  return (
    <div className="space-y-4">
      {/* 发帖入口（仅订阅用户） */}
      {canPost ? (
        <PostComposer onPosted={load} />
      ) : (
        <div className="rounded-[12px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-4 py-3 text-[13px] text-[var(--red)]">
          自习室广场发帖为订阅会员权益。
          <a href="/pricing" className="ml-1 font-semibold underline">订阅后即可发帖</a>
        </div>
      )}

      {/* 类型筛选 */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.label}
              onClick={() => setFilter(f.key)}
              className={`mono rounded-full px-3.5 py-1.5 text-[12px] transition-colors ${
                active
                  ? "bg-[var(--ink)] text-[var(--surface)]"
                  : "border border-[var(--border)] bg-[var(--surface)] text-[var(--ink3)] hover:text-[var(--ink)]"
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-[16px] border border-[var(--border)] bg-[var(--surface-inset)]" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[16px] border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-16 text-center">
          <p className="font-semibold text-[var(--ink)]">广场还很安静</p>
          <p className="mt-1.5 text-[13px] text-[var(--ink3)]">
            {canPost ? "发第一条学习心得，点亮自习室" : "订阅后可发帖，和大家一起打卡学习"}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {posts.map((p) => {
            const meta = TYPE_META[p.type] ?? { label: p.type, icon: Lightbulb };
            const Icon = meta.icon;
            const initial = p.author.nickname?.slice(0, 1) || "学";
            return (
              <div
                key={p.id}
                className="studio-lift rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]"
              >
                <div className="flex items-center gap-2.5">
                  {/* 头像 */}
                  {p.author.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.author.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-inset)] text-[13px] font-bold text-[var(--ink3)]">
                      {initial}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-semibold text-[var(--ink)]">{p.author.nickname}</div>
                    <div className="mono text-[11px] text-[var(--ink4)]">{formatWhen(p.createdAt)}</div>
                  </div>
                  {/* 类型标签 */}
                  <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface-inset)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--ink3)]">
                    <Icon size={12} weight="fill" className="text-[var(--red)]" />
                    {meta.label}
                  </span>
                </div>

                {/* 内容 */}
                <p className="mt-3 whitespace-pre-wrap text-[14px] leading-[1.7] text-[var(--ink2)]">{p.content}</p>

                {/* 点赞 */}
                <div className="mt-3 flex items-center">
                  <button
                    onClick={() => like(p.id)}
                    className={`studio-press inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                      p.likedByMe
                        ? "border-[var(--red-soft-border)] bg-[var(--red-soft)] text-[var(--red)]"
                        : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink3)] hover:text-[var(--ink)]"
                    }`}
                    aria-pressed={p.likedByMe}
                    aria-label="点赞"
                  >
                    <Heart size={14} weight={p.likedByMe ? "fill" : "regular"} />
                    <span className="mono">{p.likeCount}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 相对时间文案（分钟/小时/天，超 7 天回落到日期）。 */
function formatWhen(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
}
