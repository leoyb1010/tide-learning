"use client";

import { useEffect, useState } from "react";
import { PaperPlaneRight, Megaphone, ChatCircle, Trash } from "@phosphor-icons/react/dist/ssr";
import { TidalReveal, Stagger, StaggerItem } from "./motion";
import { Button } from "./ui";
import { useToast } from "./Toast";
import { track } from "@/lib/analytics-client";
import { relativeTime } from "@/lib/format";

// 首帧稳定的绝对时间（Asia/Shanghai），SSR 与客户端首帧一致，避免 hydration 文案不符。
function absoluteTime(d: Date): string {
  return d.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric" });
}

/**
 * 相对时间：SSR 与客户端首帧都渲染稳定的绝对日期，挂载后再切换到基于 Date.now() 的相对文案。
 * 这样首帧 hydration 与 SSR 输出一致，规避日界处「今天/昨天」不一致的 hydration mismatch。
 */
function RelativeTime({ createdAt }: { createdAt: string }) {
  const date = new Date(createdAt);
  const [label, setLabel] = useState(() => absoluteTime(date));
  useEffect(() => {
    setLabel(relativeTime(date));
    // createdAt 唯一标识该条评论，变化时重算即可。
  }, [createdAt]); // eslint-disable-line react-hooks/exhaustive-deps
  return <span className="text-xs text-ink-400">{label}</span>;
}

/**
 * DemandComments — 共创讨论区（C2.1）。
 * 楼层 + 楼中楼；官方置顶；发帖框；本人/版主软删。
 * 服务端返回已渲染的 contentHtml（安全 Markdown）。
 */

export interface CommentView {
  id: string;
  contentMd: string;
  contentHtml: string;
  isOfficial: boolean;
  createdAt: string;
  author: { id: string; nickname: string; avatarUrl: string | null };
  replies: CommentView[];
}

export function DemandComments({
  demandId,
  initialComments,
  currentUserId,
  canModerate,
  canComment,
}: {
  demandId: string;
  initialComments: CommentView[];
  currentUserId: string | null;
  canModerate: boolean;
  canComment: boolean;
}) {
  const { toast } = useToast();
  const [comments, setComments] = useState<CommentView[]>(initialComments);
  // 根发帖框独立草稿；楼中楼回复框各自在 ReplyBox 内持有局部 state，互不串台。
  const [rootDraft, setRootDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const total = comments.reduce((s, c) => s + 1 + c.replies.length, 0);

  // 提交评论：内容由调用方传入（根框或某个回复框各自的草稿）。返回是否成功，供回复框决定是否清空。
  async function submit(parentId: string | null, rawContent: string): Promise<boolean> {
    const content = rawContent.trim();
    if (!content || sending) return false;
    setSending(true);
    try {
      const res = await fetch(`/api/demands/${demandId}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, parentId: parentId ?? undefined }),
      });
      const json = (await res.json()) as
        | { ok: true; data: { comment: CommentView } }
        | { ok: false; error: string };
      if (!json.ok) {
        toast(json.error, { tone: "warn" });
        return false;
      }
      const created = json.data.comment;
      setComments((prev) => {
        if (parentId) {
          return prev.map((c) =>
            c.id === parentId ? { ...c, replies: [...c.replies, created] } : c,
          );
        }
        // 新根楼：官方置顶排前，否则追加到末尾。
        return created.isOfficial ? [created, ...prev] : [...prev, created];
      });
      if (!parentId) setRootDraft(""); // 仅清空根框；回复框由自身清空。
      setReplyTo(null);
      track("demand_comment_add", { demand_id: demandId, is_reply: !!parentId });
      return true;
    } catch {
      toast("网络异常，请重试", { tone: "warn" });
      return false;
    } finally {
      setSending(false);
    }
  }

  async function remove(commentId: string) {
    try {
      const res = await fetch(`/api/demands/${demandId}/comments/${commentId}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        toast(json.error ?? "删除失败", { tone: "warn" });
        return;
      }
      // 软删：标记为已删除占位，保留楼层。
      const strip = (c: CommentView): CommentView =>
        c.id === commentId
          ? { ...c, contentHtml: '<p class="tide-md-p">该评论已删除</p>', author: { id: "", nickname: "已删除", avatarUrl: null } }
          : { ...c, replies: c.replies.map(strip) };
      setComments((prev) => prev.map(strip));
      toast("已删除", { tone: "success" });
    } catch {
      toast("网络异常，请重试", { tone: "warn" });
    }
  }

  const canDelete = (c: CommentView) =>
    !!currentUserId && (c.author.id === currentUserId || canModerate);

  // 楼中楼回复框：各自持有局部草稿 state，与根框及其它回复框互不干扰。
  function ReplyBox({ parentId }: { parentId: string }) {
    const [draft, setDraft] = useState("");
    return (
      <div className="ml-5 mt-2 flex gap-2 pl-4">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) =>
            e.key === "Enter" &&
            !e.shiftKey &&
            (e.preventDefault(), submit(parentId, draft).then((ok) => ok && setDraft("")))
          }
          placeholder="回复该楼层…"
          className="flex-1 rounded-lg border border-ink-200 bg-paper-raised px-3 py-2 text-sm outline-none focus:border-accent-400"
        />
        <Button
          size="sm"
          onClick={() => submit(parentId, draft).then((ok) => ok && setDraft(""))}
          disabled={sending || !draft.trim()}
        >
          发送
        </Button>
      </div>
    );
  }

  function CommentRow({ c, depth }: { c: CommentView; depth: number }) {
    return (
      <div className={depth > 0 ? "ml-5 border-l border-ink-100 pl-4" : ""}>
        <div
          className={`rounded-xl p-3 ${
            c.isOfficial ? "border border-accent-200 bg-accent-50" : "bg-paper"
          }`}
        >
          <div className="flex items-center gap-2">
            {/* 作者头像：有图显图，无则首字母圆底兜底 */}
            {c.author.avatarUrl ? (
              <img src={c.author.avatarUrl} alt="" width={24} height={24} loading="lazy" className="h-6 w-6 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-100 text-[0.7rem] font-medium text-accent-700" aria-hidden>
                {c.author.nickname.charAt(0) || "?"}
              </span>
            )}
            {c.isOfficial && (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-600 px-2 py-0.5 text-[0.65rem] font-medium text-white">
                <Megaphone size={11} weight="fill" /> 官方
              </span>
            )}
            <span className="text-sm font-medium text-ink-950">{c.author.nickname}</span>
            <RelativeTime createdAt={c.createdAt} />
            {canDelete(c) && (
              <button
                onClick={() => remove(c.id)}
                className="ml-auto inline-flex items-center gap-0.5 text-xs text-ink-400 transition-colors hover:text-warning"
              >
                <Trash size={13} /> 删除
              </button>
            )}
          </div>
          <div
            className="tide-md mt-1.5 text-sm text-ink-800"
            dangerouslySetInnerHTML={{ __html: c.contentHtml }}
          />
          {canComment && depth === 0 && (
            <button
              onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}
              className="mt-1.5 inline-flex items-center gap-1 text-xs text-accent-700 hover:underline"
            >
              <ChatCircle size={13} /> {replyTo === c.id ? "取消回复" : "回复"}
            </button>
          )}
        </div>

        {c.replies.length > 0 && (
          <div className="mt-2 space-y-2">
            {c.replies.map((r) => (
              <CommentRow key={r.id} c={r} depth={depth + 1} />
            ))}
          </div>
        )}

        {replyTo === c.id && canComment && <ReplyBox parentId={c.id} />}
      </div>
    );
  }

  return (
    <TidalReveal>
      <section>
        <h2 className="mb-4 text-lg font-semibold text-ink-950">
          共创讨论 <span className="num text-sm font-normal text-ink-400">{total}</span>
        </h2>

        {/* 发帖框（仅根楼；楼中楼在各楼内联） */}
        {canComment ? (
          replyTo === null && (
            <div className="mb-5 flex gap-2">
              <textarea
                value={rootDraft}
                onChange={(e) => setRootDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), submit(null, rootDraft))}
                rows={2}
                placeholder="说点什么，支持 Markdown…"
                className="flex-1 resize-none rounded-xl border border-ink-200 bg-paper-raised px-3 py-2 text-sm outline-none transition-colors focus:border-accent-400"
              />
              <Button onClick={() => submit(null, rootDraft)} disabled={sending || !rootDraft.trim()}>
                <PaperPlaneRight size={15} weight="bold" />
              </Button>
            </div>
          )
        ) : (
          <p className="mb-5 rounded-xl bg-paper px-4 py-3 text-sm text-ink-500">登录后即可参与讨论。</p>
        )}

        {comments.length === 0 ? (
          <p className="rounded-xl bg-paper px-4 py-6 text-center text-sm text-ink-400">
            还没有讨论，来抢首楼吧。
          </p>
        ) : (
          <Stagger className="space-y-3">
            {comments.map((c) => (
              <StaggerItem key={c.id}>
                <CommentRow c={c} depth={0} />
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </section>
    </TidalReveal>
  );
}
