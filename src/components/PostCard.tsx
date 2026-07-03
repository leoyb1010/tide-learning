"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  Lightbulb,
  CheckCircle,
  Question,
  Heart,
  ChatCircle,
  ArrowsClockwise,
  PaperPlaneRight,
} from "@phosphor-icons/react";
import { useToast } from "./Toast";
import { Dialog } from "./Dialog";
import { track } from "@/lib/analytics-client";

// ---------- 视图类型（与 /api/posts GET 返回对齐）----------

export interface PostAuthor {
  id: string;
  nickname: string;
  avatarUrl: string | null;
}

export interface RepostOriginView {
  id: string;
  content: string;
  images: string[];
  topicTags: string[];
  author: PostAuthor;
  status: string; // approved / deleted
}

export interface PostView {
  id: string;
  type: string;
  content: string;
  images: string[];
  topicTags: string[];
  likeCount: number;
  commentCount: number;
  repostCount: number;
  createdAt: string;
  author: PostAuthor;
  likedByMe: boolean;
  repostOfId: string | null;
  repostOf: RepostOriginView | null;
}

interface CommentView {
  id: string;
  content: string;
  createdAt: string;
  author: PostAuthor;
}

// 三类帖子的展示元数据
const TYPE_META: Record<string, { label: string; icon: typeof Lightbulb }> = {
  insight: { label: "学习心得", icon: Lightbulb },
  checkin: { label: "打卡", icon: CheckCircle },
  question: { label: "求助", icon: Question },
};

/**
 * PostCard —— 微博式帖子卡。
 * 头像+昵称+时间 · 正文 · 图片网格(1-4) · 话题胶囊(#xx 红) · 互动条(赞/评/转)。
 * 评论内联展开（一级盖楼列表 + 输入框）；转发引用原帖卡。
 * 互动写操作乐观更新；点赞/评论/转发均需登录+订阅（后端会拦，前端给引导）。
 *
 * @param onMutate 通知父组件本卡计数变化（可选，父可据此局部同步）
 * @param canInteract 是否可评论/转发（登录+订阅）；否则点击给引导
 * @param isLoggedIn 是否登录（点赞门槛更低，仅需登录）
 */
export function PostCard({
  post,
  isLoggedIn,
  canInteract,
  onReposted,
  onTag,
}: {
  post: PostView;
  isLoggedIn: boolean;
  canInteract: boolean;
  onReposted?: () => void;
  onTag?: (tag: string) => void;
}) {
  const { toast } = useToast();

  // 本卡局部状态（乐观更新，避免整列表重拉）
  const [liked, setLiked] = useState(post.likedByMe);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [commentCount, setCommentCount] = useState(post.commentCount);
  const [repostCount, setRepostCount] = useState(post.repostCount);

  // 评论展开
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<CommentView[] | null>(null);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [posting, setPosting] = useState(false);

  // 转发弹窗
  const [repostOpen, setRepostOpen] = useState(false);
  const [repostText, setRepostText] = useState("");
  const [reposting, setReposting] = useState(false);

  const meta = TYPE_META[post.type] ?? { label: post.type, icon: Lightbulb };
  const TypeIcon = meta.icon;
  const isRepost = Boolean(post.repostOfId);

  // ---------- 点赞（幂等 toggle）----------
  async function like() {
    if (!isLoggedIn) {
      toast("登录后可点赞", { tone: "info" });
      return;
    }
    const next = !liked;
    setLiked(next);
    setLikeCount((c) => Math.max(0, c + (next ? 1 : -1)));
    try {
      const res = await fetch(`/api/posts/${post.id}/like`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const json = (await res.json()) as
        | { ok: true; data: { liked: boolean; likeCount: number } }
        | { ok: false; error: string };
      if (json.ok) {
        setLiked(json.data.liked);
        setLikeCount(json.data.likeCount);
        if (json.data.liked) track("post_like", { post_id: post.id });
      } else {
        setLiked(!next);
        setLikeCount((c) => Math.max(0, c + (next ? -1 : 1)));
        toast(json.error, { tone: "warn" });
      }
    } catch {
      setLiked(!next);
      setLikeCount((c) => Math.max(0, c + (next ? -1 : 1)));
      toast("网络异常，请重试", { tone: "warn" });
    }
  }

  // ---------- 评论：展开时懒加载 ----------
  const loadComments = useCallback(async () => {
    setLoadingComments(true);
    try {
      const res = await fetch(`/api/posts/${post.id}/comment`);
      const json = (await res.json()) as
        | { ok: true; data: { comments: CommentView[] } }
        | { ok: false };
      if (json.ok) setComments(json.data.comments);
      else setComments([]);
    } catch {
      setComments([]);
    } finally {
      setLoadingComments(false);
    }
  }, [post.id]);

  function toggleComments() {
    const next = !showComments;
    setShowComments(next);
    if (next && comments === null) void loadComments();
  }

  async function submitComment() {
    if (!canInteract) {
      toast("评论为订阅会员权益", { tone: "info" });
      return;
    }
    const text = commentText.trim();
    if (text.length < 1) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/posts/${post.id}/comment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      const json = (await res.json()) as
        | { ok: true; data: { status: string; message?: string; comment?: CommentView } }
        | { ok: false; error: string };
      if (!json.ok) {
        toast(json.error, { tone: "warn" });
        return;
      }
      if (json.data.status === "approved" && json.data.comment) {
        setComments((prev) => [...(prev ?? []), json.data.comment as CommentView]);
        setCommentCount((c) => c + 1);
        setCommentText("");
        track("post_comment", { post_id: post.id });
      } else {
        // pending / rejected：不入列表，给提示
        toast(json.data.message ?? "评论审核中", { tone: json.data.status === "pending" ? "info" : "warn" });
        if (json.data.status === "rejected") setCommentText("");
      }
    } catch {
      toast("网络异常，请重试", { tone: "warn" });
    } finally {
      setPosting(false);
    }
  }

  // ---------- 转发 ----------
  async function submitRepost() {
    if (!canInteract) {
      toast("转发为订阅会员权益", { tone: "info" });
      return;
    }
    setReposting(true);
    try {
      const res = await fetch(`/api/posts/${post.id}/repost`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: repostText.trim() }),
      });
      const json = (await res.json()) as
        | { ok: true; data: { status: string; message?: string } }
        | { ok: false; error: string };
      if (!json.ok) {
        toast(json.error, { tone: "warn" });
        return;
      }
      if (json.data.status === "approved") {
        setRepostCount((c) => c + 1);
        setRepostText("");
        setRepostOpen(false);
        toast("已转发到广场", { tone: "success" });
        track("post_repost", { origin_id: post.id });
        onReposted?.();
      } else {
        toast(json.data.message ?? "转发审核中", { tone: json.data.status === "pending" ? "info" : "warn" });
        if (json.data.status === "rejected") setRepostText("");
      }
    } catch {
      toast("网络异常，请重试", { tone: "warn" });
    } finally {
      setReposting(false);
    }
  }

  const initial = post.author.nickname?.slice(0, 1) || "学";

  return (
    <article className="studio-lift studio-rise rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]">
      {/* 头部：头像 + 昵称 + 时间 + 类型标签 */}
      <header className="flex items-center gap-2.5">
        <Avatar id={post.author.id} nickname={post.author.nickname} avatarUrl={post.author.avatarUrl} initial={initial} />
        <div className="min-w-0 flex-1">
          <Link
            href={`/u/${post.author.id}`}
            className="truncate text-[13.5px] font-semibold text-[var(--ink)] transition-colors hover:text-[var(--red)]"
          >
            {post.author.nickname}
          </Link>
          <div className="mono text-[11px] text-[var(--ink4)]">{formatWhen(post.createdAt)}</div>
        </div>
        {!isRepost && (
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface-inset)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--ink3)]">
            <TypeIcon size={12} weight="fill" className="text-[var(--red)]" />
            {meta.label}
          </span>
        )}
      </header>

      {/* 正文（转发帖：这里是转发语，可能为空） */}
      {post.content && (
        <p className="mt-3 whitespace-pre-wrap text-[14px] leading-[1.7] text-[var(--ink2)]">{post.content}</p>
      )}
      {isRepost && !post.content && (
        <p className="mono mt-3 text-[12.5px] text-[var(--ink4)]">转发了这条帖子</p>
      )}

      {/* 图片网格（原创帖自身图片；1-4 张自适应网格） */}
      {!isRepost && post.images.length > 0 && <ImageGrid images={post.images} />}

      {/* 话题标签 */}
      {!isRepost && post.topicTags.length > 0 && <TopicTags tags={post.topicTags} onTag={onTag} />}

      {/* 转发引用卡 */}
      {isRepost && post.repostOf && <QuotedPost origin={post.repostOf} />}

      {/* 互动条 */}
      <footer className="mt-3 flex items-center gap-1 border-t border-[var(--border)] pt-2.5">
        {/* 点赞 */}
        <ActionButton
          active={liked}
          activeTone="red"
          onClick={like}
          ariaLabel="点赞"
          icon={<Heart size={16} weight={liked ? "fill" : "regular"} />}
          count={likeCount}
        />
        {/* 评论 */}
        <ActionButton
          active={showComments}
          onClick={toggleComments}
          ariaLabel="评论"
          icon={<ChatCircle size={16} weight={showComments ? "fill" : "regular"} />}
          count={commentCount}
        />
        {/* 转发（转发帖不可再转，引导转原帖） */}
        <ActionButton
          active={false}
          disabled={isRepost}
          onClick={() => {
            if (isRepost) {
              toast("转发帖请转发原帖", { tone: "info" });
              return;
            }
            if (!canInteract) {
              toast("转发为订阅会员权益", { tone: "info" });
              return;
            }
            setRepostOpen(true);
          }}
          ariaLabel="转发"
          icon={<ArrowsClockwise size={16} />}
          count={repostCount}
        />
      </footer>

      {/* 评论展开区（一级盖楼 + 输入框） */}
      {showComments && (
        <div className="studio-rise mt-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface-inset)] p-3">
          {/* 输入框（仅订阅可评） */}
          {canInteract ? (
            <div className="flex items-end gap-2">
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                maxLength={300}
                rows={1}
                placeholder="友善评论，一起进步…"
                className="min-h-[38px] flex-1 resize-none rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] leading-[1.5] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--ink3)]"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submitComment();
                }}
              />
              <button
                onClick={submitComment}
                disabled={posting || commentText.trim().length < 1}
                className="studio-press inline-flex h-[38px] items-center gap-1.5 rounded-[10px] bg-[var(--red)] px-3.5 text-[13px] font-bold text-white transition-all hover:brightness-105 disabled:opacity-50"
              >
                <PaperPlaneRight size={13} weight="fill" />
                {posting ? "审核中" : "发送"}
              </button>
            </div>
          ) : (
            <p className="text-[12.5px] text-[var(--ink3)]">
              评论为订阅会员权益。
              <Link href="/pricing" className="ml-1 font-semibold text-[var(--red)] underline">
                订阅后参与讨论
              </Link>
            </p>
          )}

          {/* 评论列表 */}
          <div className="mt-3 flex flex-col gap-2.5">
            {loadingComments ? (
              <div className="mono py-2 text-center text-[12px] text-[var(--ink4)]">加载评论…</div>
            ) : comments && comments.length > 0 ? (
              comments.map((c) => <CommentRow key={c.id} comment={c} />)
            ) : (
              <div className="mono py-2 text-center text-[12px] text-[var(--ink4)]">还没有评论，来占个沙发</div>
            )}
          </div>
        </div>
      )}

      {/* 转发弹窗 */}
      <Dialog open={repostOpen} onClose={() => setRepostOpen(false)} title="转发到广场">
        <div className="space-y-3">
          <textarea
            value={repostText}
            onChange={(e) => setRepostText(e.target.value)}
            maxLength={300}
            rows={3}
            data-autofocus
            placeholder="说点什么…（可留空，纯转发）"
            className="w-full resize-none rounded-[12px] border border-[var(--border)] bg-[var(--surface-inset)] px-3.5 py-3 text-[14px] leading-[1.6] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--ink3)]"
          />
          {/* 被转发原帖预览 */}
          <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface-inset)] p-3">
            <div className="mono text-[11px] text-[var(--ink4)]">@{post.author.nickname}</div>
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[13px] leading-[1.6] text-[var(--ink3)]">
              {post.content || "（图片/无正文）"}
            </p>
          </div>
          <div className="flex items-center justify-between">
            <span className="mono text-[11px] text-[var(--ink4)]">{repostText.length}/300 · 附言会经过审核</span>
            <button
              onClick={submitRepost}
              disabled={reposting}
              className="studio-press inline-flex items-center gap-1.5 rounded-[11px] bg-[var(--red)] px-4 py-2 text-[13px] font-bold text-white transition-all hover:brightness-105 disabled:opacity-50"
            >
              <ArrowsClockwise size={14} />
              {reposting ? "转发中…" : "转发"}
            </button>
          </div>
        </div>
      </Dialog>
    </article>
  );
}

// ---------- 子组件 ----------

/** 头像（链接到个人主页）。 */
function Avatar({
  id,
  nickname,
  avatarUrl,
  initial,
  size = 8,
}: {
  id: string;
  nickname: string;
  avatarUrl: string | null;
  initial: string;
  size?: number;
}) {
  const dim = `${size * 0.25}rem`;
  return (
    <Link href={`/u/${id}`} aria-label={`${nickname} 的主页`} className="shrink-0">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" style={{ width: dim, height: dim }} className="rounded-full object-cover" />
      ) : (
        <span
          style={{ width: dim, height: dim }}
          className="flex items-center justify-center rounded-full bg-[var(--surface-inset)] text-[13px] font-bold text-[var(--ink3)]"
        >
          {initial}
        </span>
      )}
    </Link>
  );
}

/** 图片网格：1 张大图；2 张并排；3-4 张两列。统一 mock url，object-cover。 */
function ImageGrid({ images }: { images: string[] }) {
  const n = images.length;
  const cols = n === 1 ? "grid-cols-1" : "grid-cols-2";
  const aspect = n === 1 ? "aspect-[16/10]" : "aspect-square";
  return (
    <div className={`mt-3 grid gap-1.5 ${cols}`}>
      {images.slice(0, 4).map((src, i) => (
        <div
          key={i}
          className={`overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface-inset)] ${aspect}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
        </div>
      ))}
    </div>
  );
}

/** 话题标签胶囊：#xx 红色小胶囊。有 onTag 时点击就地筛选，否则纯展示。 */
function TopicTags({ tags, onTag }: { tags: string[]; onTag?: (tag: string) => void }) {
  const cls =
    "mono inline-flex items-center rounded-full border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-2.5 py-0.5 text-[11.5px] font-medium text-[var(--red)]";
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {tags.map((t) =>
        onTag ? (
          <button key={t} onClick={() => onTag(t)} className={`${cls} studio-press transition-opacity hover:opacity-80`}>
            #{t}
          </button>
        ) : (
          <span key={t} className={cls}>
            #{t}
          </span>
        ),
      )}
    </div>
  );
}

/** 转发引用的原帖卡（内嵌，弱化底色）。 */
function QuotedPost({ origin }: { origin: RepostOriginView }) {
  const deleted = origin.status !== "approved";
  return (
    <div className="mt-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface-inset)] p-3">
      {deleted ? (
        <p className="mono text-[12.5px] text-[var(--ink4)]">原帖已删除</p>
      ) : (
        <>
          <Link
            href={`/u/${origin.author.id}`}
            className="mono text-[12px] text-[var(--ink3)] transition-colors hover:text-[var(--red)]"
          >
            @{origin.author.nickname}
          </Link>
          {origin.content && (
            <p className="mt-1 whitespace-pre-wrap text-[13px] leading-[1.6] text-[var(--ink2)]">{origin.content}</p>
          )}
          {origin.images.length > 0 && <ImageGrid images={origin.images} />}
          {origin.topicTags.length > 0 && <TopicTags tags={origin.topicTags} />}
          {/* 引用卡内话题仅展示，不做筛选跳转（避免嵌套 onTag 混淆） */}
        </>
      )}
    </div>
  );
}

/** 一条评论行。 */
function CommentRow({ comment }: { comment: CommentView }) {
  const initial = comment.author.nickname?.slice(0, 1) || "学";
  return (
    <div className="flex items-start gap-2">
      <Avatar
        id={comment.author.id}
        nickname={comment.author.nickname}
        avatarUrl={comment.author.avatarUrl}
        initial={initial}
        size={7}
      />
      <div className="min-w-0 flex-1 rounded-[10px] bg-[var(--surface)] px-3 py-2">
        <div className="flex items-center gap-2">
          <Link
            href={`/u/${comment.author.id}`}
            className="text-[12.5px] font-semibold text-[var(--ink)] transition-colors hover:text-[var(--red)]"
          >
            {comment.author.nickname}
          </Link>
          <span className="mono text-[10px] text-[var(--ink4)]">{formatWhen(comment.createdAt)}</span>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-[1.55] text-[var(--ink2)]">{comment.content}</p>
      </div>
    </div>
  );
}

/** 互动条按钮（图标 + 计数）。 */
function ActionButton({
  active,
  activeTone = "ink",
  disabled = false,
  onClick,
  icon,
  count,
  ariaLabel,
}: {
  active: boolean;
  activeTone?: "red" | "ink";
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  count: number;
  ariaLabel: string;
}) {
  const activeCls =
    activeTone === "red" ? "text-[var(--red)]" : "text-[var(--ink)]";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={`studio-press inline-flex items-center gap-1.5 rounded-[9px] px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
        active ? activeCls : "text-[var(--ink3)]"
      } ${disabled ? "opacity-40" : "hover:bg-[var(--surface-inset)] hover:text-[var(--ink)]"}`}
    >
      {icon}
      <span className="mono">{count > 0 ? count : ""}</span>
    </button>
  );
}

/** 相对时间文案（分钟/小时/天，超 7 天回落到日期）。 */
export function formatWhen(iso: string): string {
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
