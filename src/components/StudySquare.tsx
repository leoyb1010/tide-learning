"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { X } from "@phosphor-icons/react";
import { PostComposer } from "./PostComposer";
import { PostCard, type PostView } from "./PostCard";

// 类型筛选
const TYPE_FILTERS: { key: string | null; label: string }[] = [
  { key: null, label: "全部" },
  { key: "insight", label: "心得" },
  { key: "checkin", label: "打卡" },
  { key: "question", label: "求助" },
];

// 排序 Tab
const SORTS: { key: "recent" | "hot"; label: string }[] = [
  { key: "recent", label: "最新" },
  { key: "hot", label: "热门" },
];

/**
 * StudySquare —— 自习室广场（微内容流 / X·微博式）。
 * 顶部：最新/热门排序 Tab + 类型筛选 + 话题过滤条。
 * 列表：PostCard（图片/话题/赞评转/评论展开/转发引用）。
 * 发帖入口仅 canPost（登录+订阅）可见；游客/免费用户只读。
 */
export function StudySquare({ canPost, isLoggedIn }: { canPost: boolean; isLoggedIn: boolean }) {
  const [posts, setPosts] = useState<PostView[]>([]);
  const [type, setType] = useState<string | null>(null);
  const [sort, setSort] = useState<"recent" | "hot">("recent");
  const [tag, setTag] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false); // 加载失败三态：与「空态」区分，展示错误+重试

  // 请求序号守卫：切排序/筛选 Tab 时仅接受最新一次请求的结果，
  // 防止较慢的旧响应后返回覆盖较新筛选的列表（竞态）。
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(false); // 每次重新加载先清错误态
    try {
      const qs = new URLSearchParams();
      if (type) qs.set("type", type);
      if (sort === "hot") qs.set("sort", "hot");
      if (tag) qs.set("tag", tag);
      const url = qs.toString() ? `/api/posts?${qs.toString()}` : "/api/posts";
      const res = await fetch(url);
      const json = (await res.json()) as { ok: true; data: { posts: PostView[] } } | { ok: false };
      if (seq !== loadSeq.current) return; // 期间已有更新请求发出，丢弃过期结果
      if (json.ok) setPosts(json.data.posts);
      else setError(true); // 服务端返回 ok:false，进入错误态而非当作空列表
    } catch {
      // 网络/解析失败：进入错误态展示重试，不再静默当成空态误导用户
      if (seq === loadSeq.current) setError(true);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [type, sort, tag]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      {/* 发帖入口（仅订阅用户） */}
      {canPost ? (
        <PostComposer onPosted={load} />
      ) : (
        <div className="rounded-[12px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-4 py-3 text-[13px] text-[var(--red)]">
          自习室广场发帖为订阅会员权益。
          <a href="/pricing" className="ml-1 font-semibold underline">
            订阅后即可发帖
          </a>
        </div>
      )}

      {/* 排序 Tab（最新 / 热门） */}
      <div className="inline-flex rounded-[12px] border border-[var(--border)] bg-[var(--surface2)] p-1 text-[13px] font-semibold">
        {SORTS.map((s) => {
          const active = sort === s.key;
          return (
            <button
              key={s.key}
              onClick={() => setSort(s.key)}
              className={`whitespace-nowrap rounded-[8px] px-4 py-1.5 transition-colors ${
                active
                  ? "bg-[var(--surface)] text-[var(--ink)] shadow-[var(--card)]"
                  : "text-[var(--ink3)] hover:text-[var(--ink)]"
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* 类型筛选 */}
      <div className="flex flex-wrap items-center gap-2">
        {TYPE_FILTERS.map((f) => {
          const active = type === f.key;
          return (
            <button
              key={f.label}
              onClick={() => setType(f.key)}
              className={`mono whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12px] transition-colors ${
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

      {/* 话题过滤条（点击帖内话题后出现，可一键清除） */}
      {tag && (
        <div className="flex items-center gap-2">
          <span className="mono inline-flex items-center gap-1.5 rounded-full border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-3 py-1 text-[13px] font-medium text-[var(--red)]">
            #{tag}
            <button onClick={() => setTag(null)} title="清除话题筛选" aria-label="清除话题筛选" className="studio-press">
              <X size={12} weight="bold" />
            </button>
          </span>
          <span className="text-[12px] text-[var(--ink4)]">正在看这个话题</span>
        </div>
      )}

      {/* 列表 */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-[16px] border border-[var(--border)] bg-[var(--surface-inset)]"
            />
          ))}
        </div>
      ) : error ? (
        // 加载失败态：与「空态」区分——空态是「没有帖子」，此处是「没拿到数据」，
        // 展示错误提示 + 重试按钮，避免把失败误导成广场无内容。
        <div className="flex flex-col items-center justify-center rounded-[16px] border border-dashed border-[var(--red-soft-border)] bg-[var(--red-soft)] px-6 py-16 text-center">
          <p className="font-semibold text-[var(--red)]">内容加载失败</p>
          <p className="mt-1.5 text-[13px] text-[var(--ink3)]">网络似乎不太稳定，请稍后重试</p>
          <button
            onClick={() => void load()}
            className="studio-press mt-4 rounded-[10px] bg-[var(--red)] px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--red-hover)]"
          >
            重新加载
          </button>
        </div>
      ) : posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[16px] border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-16 text-center">
          <p className="font-semibold text-[var(--ink)]">{tag ? "这个话题还很安静" : "广场还很安静"}</p>
          <p className="mt-1.5 text-[13px] text-[var(--ink3)]">
            {canPost ? "发第一条学习心得，点亮自习室" : "订阅后可发帖，和大家一起打卡学习"}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {posts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              isLoggedIn={isLoggedIn}
              canInteract={canPost}
              onReposted={load}
              onTag={(t) => setTag(t)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
