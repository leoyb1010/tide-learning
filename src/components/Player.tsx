"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { NoteEditor, type NoteItem, type NoteEditorHandle } from "./NoteEditor";
import { Paywall } from "./Paywall";
import { Badge } from "./ui";
import { Tooltip } from "./Tooltip";
import { SheetDrag, WaveProgress } from "./motion";
import { useToast } from "./Toast";
import { useMode } from "./ModeProvider";
import {
  Play, Pause, LockSimple, CaretLeft, CaretRight, Check,
  Camera, NotePencil, ArrowsOut, ArrowsIn, Moon, Sun, CornersOut,
} from "@phosphor-icons/react";
import { mmss } from "@/lib/format";
import { track } from "@/lib/analytics-client";

interface OutlineItem { id: string; title: string; isFree: boolean; durationSec: number; current: boolean }
interface SubtitleCue { startSec: number; endSec: number; text: string }
interface LessonData {
  id: string; title: string; summary: string | null; contentType: string;
  durationSec: number; isFree: boolean; videoUrl: string | null; articleMd: string | null;
  liveStartAt?: string | null; liveSeatLimit?: number | null;
  subtitles?: SubtitleCue[];
}

/**
 * Player 2.0 —「学习工作台」。
 * 桌面：视频 + 笔记面板(360px) + 目录，可折叠 + 焦点模式；移动：视频吸顶 + 可拖拽笔记 Sheet。
 * 支持真实 <video>（有 videoUrl 时）与模拟兜底；捕捉条：截帧 / 快速批注 / 字幕划线剪藏。
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
  const { toast } = useToast();
  const { theme, toggleTheme } = useMode();
  const [time, setTime] = useState(initialProgress);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [showNotesDrawer, setShowNotesDrawer] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [focus, setFocus] = useState(false);
  const [seekPulse, setSeekPulse] = useState<number | null>(null);
  const timeRef = useRef(time);
  timeRef.current = time;
  const savedRef = useRef(initialProgress);
  const videoRef = useRef<HTMLVideoElement>(null);
  const noteRef = useRef<NoteEditorHandle>(null);
  // 仅当 videoUrl 指向真实媒体（.mp4/.m3u8/.webm）时用 <video>；
  // MVP 的受控 mock 流（/api/stream 返回占位 JSON）继续走模拟播放器，保留品牌渐变画面，截帧走兜底帧。
  const hasRealVideo = /\.(mp4|m3u8|webm)(\?|$)/i.test(lesson.videoUrl ?? "");

  // 模拟播放推进（无真实视频时）
  useEffect(() => {
    if (hasRealVideo || !playing || !access) return;
    const id = setInterval(() => {
      setTime((t) => {
        const next = Math.min(t + rate, lesson.durationSec);
        if (next >= lesson.durationSec) setPlaying(false);
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [hasRealVideo, playing, rate, access, lesson.durationSec]);

  // 真实视频：同步倍速与初始进度
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !hasRealVideo) return;
    v.playbackRate = rate;
  }, [rate, hasRealVideo]);

  useEffect(() => {
    const v = videoRef.current;
    if (v && hasRealVideo && initialProgress > 0) v.currentTime = initialProgress;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRealVideo]);

  // 进度保存（每 10 秒或暂停时），切章不丢进度
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

  // 用 ref 持有最新 saveProgress，供卸载/离开页面时读取，避免下方定时器 effect 因依赖变化重挂时误触发保存
  const saveProgressRef = useRef(saveProgress);
  saveProgressRef.current = saveProgress;

  // 定时保存（每 10 秒）+ 离开页面保存：cleanup 只清理资源，不在此主动保存进度，
  // 否则切章等导致 saveProgress 引用变化重挂时会多发一次 POST
  useEffect(() => {
    const id = setInterval(() => saveProgress(), 10000);
    const onLeave = () => saveProgress();
    window.addEventListener("beforeunload", onLeave);
    return () => { clearInterval(id); window.removeEventListener("beforeunload", onLeave); };
  }, [saveProgress]);

  // 仅在组件真正卸载时保存一次（空依赖），通过 ref 读取最新的 saveProgress
  useEffect(() => {
    return () => { saveProgressRef.current(); };
  }, []);

  useEffect(() => {
    if (time >= lesson.durationSec && lesson.durationSec > 0) saveProgress(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time]);

  const getCurrentTime = useCallback(() => timeRef.current, []);
  const seek = useCallback((sec: number) => {
    const clamped = Math.min(sec, lesson.durationSec);
    setTime(clamped);
    if (videoRef.current) videoRef.current.currentTime = clamped;
    setSeekPulse(clamped);
    setTimeout(() => setSeekPulse(null), 700);
  }, [lesson.durationSec]);

  function togglePlay() {
    if (hasRealVideo && videoRef.current) {
      if (videoRef.current.paused) videoRef.current.play(); else videoRef.current.pause();
    } else {
      setPlaying((p) => !p);
    }
  }

  // —— 捕捉：截帧当前画面 ——
  function captureFrame() {
    const v = videoRef.current;
    let dataUrl = "";
    if (hasRealVideo && v && v.videoWidth) {
      const canvas = document.createElement("canvas");
      canvas.width = v.videoWidth; canvas.height = v.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) { ctx.drawImage(v, 0, 0); try { dataUrl = canvas.toDataURL("image/jpeg", 0.72); } catch { dataUrl = ""; } }
    }
    if (!dataUrl) {
      // 模拟视频兜底：生成一张品牌色占位帧，带时间戳
      dataUrl = placeholderFrame(mmss(Math.floor(timeRef.current)), lesson.title);
    }
    noteRef.current?.addCapture(dataUrl, timeRef.current);
    if (!showNotesDrawer) setShowNotesDrawer(true);
    setSheetOpen(true);
    track("note_capture", { lesson_id: lesson.id });
  }

  function quickNote() {
    noteRef.current?.focusQuick();
    setShowNotesDrawer(true);
    setSheetOpen(true);
  }

  // 字幕划线剪藏
  function clipSelection() {
    const sel = window.getSelection()?.toString().trim();
    if (!sel) { toast("先选中一段字幕文本", { tone: "info" }); return; }
    noteRef.current?.addClip(sel, timeRef.current);
    setSheetOpen(true);
    track("note_clip", { lesson_id: lesson.id });
  }

  // 键盘快捷键：空格播放 / S 截帧 / N 批注 / F 焦点
  // 用 ref 持有最新处理逻辑，监听器只在 mount 时绑定一次，避免依赖数组不全导致的陈旧闭包
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  onKeyRef.current = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "TEXTAREA" || tag === "INPUT") return;
    if (e.key === " ") { e.preventDefault(); togglePlay(); }
    else if (e.key.toLowerCase() === "s") { e.preventDefault(); captureFrame(); }
    else if (e.key.toLowerCase() === "n") { e.preventDefault(); quickNote(); }
    else if (e.key.toLowerCase() === "f") { e.preventDefault(); setFocus((f) => !f); }
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.focus = focus ? "on" : "off";
    return () => { delete document.documentElement.dataset.focus; };
  }, [focus]);

  const activeCue = lesson.subtitles?.find((c) => time >= c.startSec && time < c.endSec);
  const progress = lesson.durationSec > 0 ? time / lesson.durationSec : 0;

  const CaptureBar = access && (
    <div className="flex items-center gap-2">
      <Tooltip label="截取画面 (S)"><button onClick={captureFrame} className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20" aria-label="截取画面"><Camera size={16} /></button></Tooltip>
      <Tooltip label="快速批注 (N)"><button onClick={quickNote} className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20" aria-label="快速批注"><NotePencil size={16} /></button></Tooltip>
      <Tooltip label={focus ? "退出焦点 (F)" : "焦点模式 (F)"}><button onClick={() => setFocus((f) => !f)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20" aria-label="焦点模式">{focus ? <ArrowsIn size={16} /> : <ArrowsOut size={16} />}</button></Tooltip>
    </div>
  );

  const VideoArea = (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-ink-100 bg-ink-950">
      <div className="relative aspect-video">
        {hasRealVideo ? (
          <video
            ref={videoRef}
            src={lesson.videoUrl ?? undefined}
            className="h-full w-full bg-black"
            playsInline
            crossOrigin="anonymous"
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => saveProgress(true)}
          />
        ) : (
          <div className="flex h-full items-center justify-center" style={{ background: "linear-gradient(140deg,#2a0a0d,#a30514,#fc011a)" }}>
            <div className="absolute inset-0 opacity-[0.1]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.6) 1px, transparent 0)", backgroundSize: "18px 18px" }} />
            {access && (
              <button onClick={togglePlay} className="relative flex h-16 w-16 items-center justify-center rounded-full bg-white/95 text-accent-700 shadow-lg transition-transform duration-200 hover:scale-110 active:scale-95">
                {playing ? <Pause size={26} weight="fill" /> : <Play size={26} weight="fill" className="ml-0.5" />}
              </button>
            )}
          </div>
        )}

        {!access && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink-950/60 text-center text-white/90">
            <div><LockSimple size={40} weight="light" className="mx-auto" /><p className="mt-2 text-sm">该章节需要订阅后观看</p></div>
          </div>
        )}
        {lesson.isFree && <div className="absolute right-3 top-3"><Badge tone="accent">免费试学</Badge></div>}

        {/* 字幕行（可划线剪藏） */}
        {access && activeCue && (
          <div onMouseUp={clipSelection} className="absolute inset-x-0 bottom-3 flex justify-center px-6">
            <p className="max-w-2xl select-text rounded-lg bg-ink-950/60 px-3 py-1.5 text-center text-sm text-white/95 backdrop-blur-sm">
              {activeCue.text}
            </p>
          </div>
        )}
      </div>

      {/* 控制条 */}
      {access && (
        <div className="space-y-2 bg-ink-950 px-4 py-3 text-white">
          {/* 水位进度条 + seek 波纹 */}
          <div className="relative">
            <input
              type="range" min={0} max={lesson.durationSec} value={time} step={0.1}
              onChange={(e) => seek(Number(e.target.value))}
              className="w-full accent-accent-400"
              aria-label="播放进度"
            />
            {seekPulse != null && (
              <span
                className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-accent-400/70"
                style={{ left: `${(seekPulse / lesson.durationSec) * 100}%`, animation: "ripple 0.6s var(--ease-out-expo) forwards" }}
              />
            )}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={togglePlay} className="text-white/90 transition-colors hover:text-white" aria-label={playing ? "暂停" : "播放"}>{playing ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}</button>
            <span className="num text-xs text-white/60">{mmss(Math.floor(time))} / {mmss(lesson.durationSec)}</span>
            <div className="flex-1" />
            {CaptureBar}
            <Tooltip label={theme === "deep" ? "浅色" : "深海模式"}>
              <button onClick={toggleTheme} className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20" aria-label="切换主题">
                {theme === "deep" ? <Sun size={16} /> : <Moon size={16} />}
              </button>
            </Tooltip>
            <select value={rate} onChange={(e) => { setRate(Number(e.target.value)); track("lesson_speed_change", { rate: e.target.value }); }} className="num rounded bg-white/10 px-1.5 py-1 text-xs" aria-label="播放速度">
              {[0.75, 1, 1.25, 1.5, 2].map((r) => <option key={r} value={r} className="text-ink-950">{r}x</option>)}
            </select>
          </div>
        </div>
      )}
    </div>
  );

  const noteEditor = (
    <NoteEditor ref={noteRef} courseId={courseId} lessonId={lesson.id} getCurrentTime={getCurrentTime} onSeek={seek} initialNotes={initialNotes} canCreate={canCreateNote} />
  );

  return (
    <div className="space-y-4">
      {/* 面包屑 */}
      <div className="focus-hide flex items-center gap-2 text-sm text-ink-500">
        <Link href={`/courses/${courseSlug}`} className="hover:text-accent-700">{courseTitle}</Link>
        <span>/</span>
        <span className="text-ink-950">{lesson.title}</span>
      </div>

      {!access ? (
        <div className="space-y-6">
          {VideoArea}
          <Paywall remainingLessons={remainingLessons} courseTitle={courseTitle} isLoggedIn={isLoggedIn} />
        </div>
      ) : (
        <div className={`grid gap-4 ${focus ? "" : "lg:grid-cols-[1fr_360px]"}`}>
          {/* 左：视频/图文 */}
          <div className={focus ? "mx-auto w-full max-w-4xl" : ""}>
            {lesson.contentType === "live" ? (
              <LiveBanner lesson={lesson} />
            ) : lesson.contentType === "article" && lesson.articleMd ? (
              <article className="prose-body rounded-2xl border border-ink-100 bg-paper-raised p-4 sm:p-6">
                <h2 className="text-xl font-semibold text-ink-950">{lesson.title}</h2>
                <div className="mt-4 whitespace-pre-wrap text-ink-800">{lesson.articleMd}</div>
              </article>
            ) : VideoArea}

            <div className="mt-4 rounded-2xl border border-ink-100 bg-paper-raised p-4">
              <div className="flex items-center justify-between gap-3">
                <h1 className="text-lg font-semibold text-ink-950">{lesson.title}</h1>
                <span className="num shrink-0 text-xs text-ink-400">已学 {Math.round(progress * 100)}%</span>
              </div>
              {lesson.summary && <p className="mt-1 text-sm text-ink-500">{lesson.summary}</p>}
              <div className="mt-3"><WaveProgress value={progress} /></div>
            </div>

            {/* 上一讲/下一讲 */}
            <div className="focus-hide mt-4 flex items-center justify-between">
              {prevLessonId ? (
                <Link href={`/courses/${courseSlug}/learn/${prevLessonId}`} onClick={() => saveProgress()} className="inline-flex items-center gap-1 text-sm text-accent-700 hover:underline"><CaretLeft size={14} /> 上一讲</Link>
              ) : <span />}
              {nextLessonId ? (
                <Link href={`/courses/${courseSlug}/learn/${nextLessonId}`} onClick={() => saveProgress()} className="inline-flex items-center gap-1 text-sm text-accent-700 hover:underline">下一讲 <CaretRight size={14} /></Link>
              ) : <span className="text-sm text-ink-400">已是最后一讲</span>}
            </div>

            {/* 移动端：打开笔记 Sheet + 目录 */}
            <div className="focus-hide mt-4 lg:hidden">
              <button onClick={() => setSheetOpen(true)} className="mb-3 inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-paper-raised px-4 py-2 text-sm text-ink-700">
                <CornersOut size={14} /> 打开笔记面板
              </button>
              <Outline courseSlug={courseSlug} outline={outline} />
            </div>
          </div>

          {/* 右：笔记面板（桌面，360px，可折叠）*/}
          {!focus && (
            <aside className="focus-hide hidden lg:block">
              <div className="sticky top-24 space-y-4">
                <div className="flex items-center justify-between">
                  <button onClick={() => setShowNotesDrawer((s) => !s)} className="text-sm text-ink-500 hover:text-ink-950">
                    {showNotesDrawer ? "收起笔记 ›" : "‹ 展开笔记"}
                  </button>
                </div>
                {showNotesDrawer && (
                  <div className="h-[540px] overflow-hidden rounded-2xl border border-ink-100 bg-paper-raised">
                    {noteEditor}
                  </div>
                )}
                <Outline courseSlug={courseSlug} outline={outline} />
              </div>
            </aside>
          )}
        </div>
      )}

      {/* 移动端：可拖拽笔记 Sheet */}
      <SheetDrag open={sheetOpen && access} onClose={() => setSheetOpen(false)} className="h-[72vh]">
        <div className="h-full pt-2">{noteEditor}</div>
      </SheetDrag>
    </div>
  );
}

/** 模拟视频截帧兜底：品牌色 + 时间戳 canvas 图。 */
function placeholderFrame(ts: string, title: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = 640; canvas.height = 360;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const g = ctx.createLinearGradient(0, 0, 640, 360);
  g.addColorStop(0, "#2a0a0d"); g.addColorStop(0.6, "#a30514"); g.addColorStop(1, "#fc011a");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 640, 360);
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = "600 40px sans-serif"; ctx.fillText(ts, 32, 320);
  ctx.font = "500 22px sans-serif"; ctx.fillText(title.slice(0, 22), 32, 56);
  return canvas.toDataURL("image/jpeg", 0.7);
}

// 直播小班课（融合有道口语小班）
function LiveBanner({ lesson }: { lesson: LessonData }) {
  const [booked, setBooked] = useState(false);
  const start = lesson.liveStartAt ? new Date(lesson.liveStartAt) : null;
  // upcoming 依赖 Date.now()，SSR 与首帧 hydration 各算一次会不一致；
  // 挂载后再计算，SSR 首帧统一按“进入直播间”渲染，避免 hydration mismatch
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const upcoming = mounted && start ? start.getTime() > Date.now() : false;
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised">
      <div className="relative flex items-center justify-center py-8 sm:py-16" style={{ background: "linear-gradient(140deg,#2a0a0d,#fc011a)" }}>
        <div className="absolute inset-0 opacity-[0.1]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.6) 1px, transparent 0)", backgroundSize: "18px 18px" }} />
        <div className="relative text-center text-white">
          <div className="inline-flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <span className="live-dot h-2.5 w-2.5 rounded-full text-error"><span className="relative block h-2.5 w-2.5 rounded-full bg-error" /></span>
            直播小班
          </div>
          <p className="num mt-2 text-sm text-white/80">真人连麦纠音 · 限额 {lesson.liveSeatLimit ?? 20} 人</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <p className="font-medium text-ink-950">{lesson.title}</p>
          <p className="text-sm text-ink-500">
            {start ? `开播时间：${start.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : "开播时间待定"}
          </p>
        </div>
        <button
          onClick={() => { setBooked(true); track("live_class_book", { lesson_id: lesson.id }); }}
          disabled={booked}
          className="inline-flex items-center gap-1.5 rounded-xl bg-accent-600 px-5 py-2.5 text-sm font-medium text-white transition-all duration-200 active:scale-[0.97] disabled:bg-success"
        >
          {booked ? <><Check size={15} weight="bold" /> 已预约</> : upcoming ? "预约席位" : "进入直播间"}
        </button>
      </div>
    </div>
  );
}

function Outline({ courseSlug, outline }: { courseSlug: string; outline: OutlineItem[] }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised">
      <p className="border-b border-ink-100 px-4 py-3 text-sm font-medium text-ink-950">课程目录</p>
      <ul className="max-h-[300px] divide-y divide-ink-100 overflow-y-auto">
        {outline.map((o, i) => (
          <li key={o.id}>
            <Link href={`/courses/${courseSlug}/learn/${o.id}`} className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-accent-50 ${o.current ? "bg-accent-50 font-medium text-accent-700" : "text-ink-800"}`}>
              <span className="num w-5 text-center text-xs text-ink-400">{i + 1}</span>
              <span className="flex-1 truncate">{o.title}</span>
              {o.isFree && <span className="text-xs text-accent-700">免费</span>}
              {!o.isFree && <LockSimple size={13} className="text-ink-300" />}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
