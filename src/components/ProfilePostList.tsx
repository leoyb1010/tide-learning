"use client";

import { PostCard, type PostView } from "./PostCard";

/**
 * ProfilePostList —— 个人主页帖子流（client）。
 * 服务端已查好该用户的 approved 帖子并映射为 PostView，这里只负责渲染 + 承接互动。
 * 话题不做就地筛选（个人主页无 tag 状态），点赞/评论/转发照常。
 */
export function ProfilePostList({
  posts,
  isLoggedIn,
  canInteract,
}: {
  posts: PostView[];
  isLoggedIn: boolean;
  canInteract: boolean;
}) {
  if (posts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[16px] border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-14 text-center">
        <p className="font-semibold text-[var(--ink)]">还没有发过帖子</p>
        <p className="mt-1.5 text-[13px] text-[var(--ink3)]">TA 的学习动态会显示在这里</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {posts.map((p) => (
        <PostCard key={p.id} post={p} isLoggedIn={isLoggedIn} canInteract={canInteract} />
      ))}
    </div>
  );
}
