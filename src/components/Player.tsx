"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NoteEditor, type NoteItem } from "./NoteEditor";
import { Paywall } from "./Paywall";
import { Badge } from "./ui";
import { mmss } from "@/lib/format";

interface OutlineItem { id: string; title: string; isFree: boolean; durationSec: number; current: boolean }
interface LessonData {
  id: string; title: string; summary: string | null; contentType: string;
  durationSec: number; isFree: boolean; videoUrl: string | null; articleMd: string | null;
  liveStartAt?: string | null; liveSeatLimit?: number | null;
}

/**
 * Player — §6.4 播放器 / 学习页。
 * 桌面：左视频 + 右笔记抽屉(380px)；移动：视频吸顶 + 底部 Tab。
 * MVP 用模拟播放器（可播放/暂停/拖动/倍速）驱动进度与时间戳，真实环境替换为 HLS 播放器。
 */
export function Player({
  courseId, courseSlug, courseTitle, lesson, access, canCreateNote,
  outline, prevLessonId, nextLessonId, remainingLessons, isLoggedIn, initialProgress, initialNotes,
}: {
  courseId: string; courseSlug: string; courseTitle: string;
  lesson: LessonData; access: boolean; canCreateNote: boolean;
  outline: OutlineItem[]; prevLessonId: string | null; nextLessonId: string | null;
  remainingLessons: number; isLoggedIn: boolean; initialProgress: number; initialNotes: NoteItem[];
}) {
  const router = useRouter();
  const [time, setTime] = useState(initialProgress);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [tab, setTab] = useState<"video" | "notes" | "outline">("video");
  const [showNotesDrawer, setShowNotesDrawer] = useState(true);
  const timeRef = useRef(time);
  timeRef.current = time;
  const savedRef = useRef(initialProgress);

  // 模拟播放推进
  useEffect(() => {
    if (!playing || !access) return;
    const id = setInterval(() => {
      setTime((t) => {
        const next = Math.min(t + rate, lesson.durationSec);
        if (next >= lesson.durationSec) setPlaying(false);
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [playing, rate, access, lesson.durationSec]);

  // 进度保存（每 10 秒或暂停时），切换章节不丢进度（§6.4 验收 1）
  const saveProgress = useCallback(async (completed = false) => {
    if (!isLoggedIn || !access) return;
    if (!completed && Math.abs(timeRef.current - savedRef.current) < 8) return;
    savedRef.current = timeRef.current;
    await fetch("/api/progress", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lessonId: lesson.id, progressSec: Math.floor(timeRef.current), completed }),
    }).catch(() => {});
  }, [isLoggedIn, access, lesson.id]);

  useEffect(() => {
    const id = setInterval(() => saveProgress(), 10000);
    const onLeave = () => saveProgress();
    window.addEventListener("beforeunload", onLeave);
    return () => { clearInterval(id); onLeave(); window.removeEventListener("beforeunload", onLeave); };
  }, [saveProgress]);

  useEffect(() => {
    if (time >= lesson.durationSec && lesson.durationSec > 0) saveProgress(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time]);

  const getCurrentTime = useCallback(() => timeRef.current, []);
  const seek = useCallback((sec: number) => { setTime(Math.min(sec, lesson.durationSec)); }, [lesson.durationSec]);

  const VideoArea = (
    <div className="overflow-hidden rounded-2xl border border-ink-100 bg-ink-950">
      {/* 模拟视频画面 */}
      <div className="relative flex aspect-video items-center justify-center" style={{ background: "linear-gradient(135deg,#0e3833,#1f7a70,#4d9d95)" }}>
        {!access ? (
          <div className="text-center text-white/90">
            <p className="text-4xl">🔒</p>
            <p className="mt-2 text-sm">该章节需要订阅后观看</p>
          </div>
        ) : (
          <button onClick={() => setPlaying((p) => !p)} className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 text-2xl text-tide-700 transition-transform hover:scale-105">
            {playing ? "⏸" : "▶"}
          </button>
        )}
        {lesson.isFree && <div className="absolute right-3 top-3"><Badge tone="dawn">免费试学</Badge></div>}
      </div>
      {/* 控制条 */}
      {access && (
        <div className="flex items-center gap-3 bg-ink-950 px-4 py-3 text-white">
          <button onClick={() => setPlaying((p) => !p)} className="text-sm">{playing ? "暂停" : "播放"}</button>
          <span className="text-xs tabular text-white/70">{mmss(Math.floor(time))} / {mmss(lesson.durationSec)}</span>
          <input
            type="range" min={0} max={lesson.durationSec} value={time}
            onChange={(e) => seek(Number(e.target.value))}
            className="flex-1 accent-dawn-400"
          />
          <select value={rate} onChange={(e) => setRate(Number(e.target.value))} className="rounded bg-white/10 px-1.5 py-1 text-xs">
            {[0.75, 1, 1.25, 1.5, 2].map((r) => <option key={r} value={r} className="text-ink-950">{r}x</option>)}
          </select>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <Link href={`/courses/${courseSlug}`} className="hover:text-tide-700">{courseTitle}</Link>
        <span>/</span>
        <span className="text-ink-950">{lesson.title}</span>
      </div>

      {!access ? (
        // 付费墙：试学有价值感之后出现（§4.1 验收 1）
        <div className="space-y-6">
          {VideoArea}
          <Paywall remainingLessons={remainingLessons} courseTitle={courseTitle} isLoggedIn={isLoggedIn} />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          {/* 左：视频/图文 */}
          <div>
            {lesson.contentType === "live" ? (
              <LiveBanner lesson={lesson} />
            ) : lesson.contentType === "article" && lesson.articleMd ? (
              <article className="prose-body rounded-2xl border border-ink-100 bg-paper-raised p-6">
                <h2 className="text-xl font-semibold text-ink-950">{lesson.title}</h2>
                <div className="mt-4 whitespace-pre-wrap text-ink-800">{lesson.articleMd}</div>
              </article>
            ) : VideoArea}

            <div className="mt-4 rounded-2xl border border-ink-100 bg-paper-raised p-4">
              <h1 className="text-lg font-semibold text-ink-950">{lesson.title}</h1>
              {lesson.summary && <p className="mt-1 text-sm text-ink-500">{lesson.summary}</p>}
            </div>

            {/* 上一讲/下一讲 */}
            <div className="mt-4 flex items-center justify-between">
              {prevLessonId ? (
                <Link href={`/courses/${courseSlug}/learn/${prevLessonId}`} onClick={() => saveProgress()} className="text-sm text-tide-700 hover:underline">← 上一讲</Link>
              ) : <span />}
              {nextLessonId ? (
                <Link href={`/courses/${courseSlug}/learn/${nextLessonId}`} onClick={() => saveProgress()} className="text-sm text-tide-700 hover:underline">下一讲 →</Link>
              ) : <span className="text-sm text-ink-400">已是最后一讲</span>}
            </div>

            {/* 移动端 Tab 切换目录 */}
            <div className="mt-4 lg:hidden">
              <div className="mb-3 flex gap-2">
                <TabBtn active={tab === "notes"} onClick={() => setTab("notes")}>笔记</TabBtn>
                <TabBtn active={tab === "outline"} onClick={() => setTab("outline")}>目录</TabBtn>
              </div>
              {tab === "notes" && (
                <div className="h-[420px] rounded-2xl border border-ink-100 bg-paper-raised">
                  <NoteEditor courseId={courseId} lessonId={lesson.id} getCurrentTime={getCurrentTime} onSeek={seek} initialNotes={initialNotes} canCreate={canCreateNote} />
                </div>
              )}
              {tab === "outline" && <Outline courseSlug={courseSlug} outline={outline} />}
            </div>
          </div>

          {/* 右：笔记抽屉（桌面，380px，可折叠，§6.4 布局）*/}
          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-4">
              <div className="flex items-center justify-between">
                <button onClick={() => setShowNotesDrawer((s) => !s)} className="text-sm text-ink-500 hover:text-ink-950">
                  {showNotesDrawer ? "收起笔记 ›" : "‹ 展开笔记"}
                </button>
              </div>
              {showNotesDrawer && (
                <div className="h-[520px] overflow-hidden rounded-2xl border border-ink-100 bg-paper-raised">
                  <NoteEditor courseId={courseId} lessonId={lesson.id} getCurrentTime={getCurrentTime} onSeek={seek} initialNotes={initialNotes} canCreate={canCreateNote} />
                </div>
              )}
              <Outline courseSlug={courseSlug} outline={outline} />
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={`rounded-lg px-4 py-1.5 text-sm ${active ? "bg-tide-600 text-white" : "bg-white border border-ink-200 text-ink-500"}`}>{children}</button>;
}

// 直播小班课（融合有道口语小班）
function LiveBanner({ lesson }: { lesson: LessonData }) {
  const [booked, setBooked] = useState(false);
  const start = lesson.liveStartAt ? new Date(lesson.liveStartAt) : null;
  const upcoming = start ? start.getTime() > Date.now() : false;
  return (
    <div className="overflow-hidden rounded-2xl border border-dawn-400/40 bg-paper-raised">
      <div className="flex items-center justify-center py-14" style={{ background: "linear-gradient(135deg,#185f57,#e2924a)" }}>
        <div className="text-center text-white">
          <div className="text-3xl">🔴 直播小班</div>
          <p className="mt-2 text-sm text-white/90">真人连麦纠音 · 限额 {lesson.liveSeatLimit ?? 20} 人</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="font-medium text-ink-950">{lesson.title}</p>
          <p className="text-sm text-ink-500">
            {start ? `开播时间：${start.toLocaleString("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : "开播时间待定"}
          </p>
        </div>
        <button
          onClick={() => setBooked(true)}
          disabled={booked}
          className="rounded-xl bg-tide-600 px-5 py-2.5 text-sm font-medium text-white disabled:bg-success"
        >
          {booked ? "✓ 已预约" : upcoming ? "预约席位" : "进入直播间"}
        </button>
      </div>
    </div>
  );
}

function Outline({ courseSlug, outline }: { courseSlug: string; outline: OutlineItem[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-ink-100 bg-paper-raised">
      <p className="border-b border-ink-100 px-4 py-3 text-sm font-medium text-ink-950">课程目录</p>
      <ul className="max-h-[300px] divide-y divide-ink-100 overflow-y-auto">
        {outline.map((o, i) => (
          <li key={o.id}>
            <Link href={`/courses/${courseSlug}/learn/${o.id}`} className={`flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-tide-50 ${o.current ? "bg-tide-50 font-medium text-tide-700" : "text-ink-800"}`}>
              <span className="w-5 text-center text-xs text-ink-400">{i + 1}</span>
              <span className="flex-1 truncate">{o.title}</span>
              {o.isFree && <span className="text-xs text-tide-700">免费</span>}
              {!o.isFree && <span className="text-ink-300">🔒</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
