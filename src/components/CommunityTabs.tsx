"use client";

import { useState, type ReactNode } from "react";
import { StudySquare } from "./StudySquare";

/**
 * CommunityTabs —— §7 社区广场双 Tab 外壳。
 * [课程共创]（服务端渲染的投票排行榜，作为 leaderboard 传入原样保留） / [自习室广场]（客户端轻社区）。
 * Tab 状态在客户端；排行榜是 server component 产物，作为 ReactNode 注入避免重写。
 */
export function CommunityTabs({
  leaderboard,
  canPost,
  isLoggedIn,
}: {
  leaderboard: ReactNode;
  canPost: boolean;
  isLoggedIn: boolean;
}) {
  const [tab, setTab] = useState<"cocreate" | "square">("cocreate");

  return (
    <div className="space-y-5">
      {/* Tab 切换 */}
      <div className="inline-flex rounded-[12px] border border-[var(--border)] bg-[var(--surface2)] p-1 text-[13.5px] font-semibold">
        <button
          onClick={() => setTab("cocreate")}
          className={`whitespace-nowrap rounded-[9px] px-5 py-2 transition-colors ${
            tab === "cocreate"
              ? "bg-[var(--surface)] text-[var(--ink)] shadow-[var(--card)]"
              : "text-[var(--ink3)] hover:text-[var(--ink)]"
          }`}
        >
          课程共创
        </button>
        <button
          onClick={() => setTab("square")}
          className={`whitespace-nowrap rounded-[9px] px-5 py-2 transition-colors ${
            tab === "square"
              ? "bg-[var(--surface)] text-[var(--ink)] shadow-[var(--card)]"
              : "text-[var(--ink3)] hover:text-[var(--ink)]"
          }`}
        >
          自习室广场
        </button>
      </div>

      {/* 内容：课程共创原样保留；自习室广场客户端渲染 */}
      <div className={tab === "cocreate" ? "" : "hidden"}>{leaderboard}</div>
      {tab === "square" && <StudySquare canPost={canPost} isLoggedIn={isLoggedIn} />}
    </div>
  );
}
