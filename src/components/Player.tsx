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
  Camera, NotePencil, ArrowsOut, ArrowsIn, Moon, Sun, CornersOut, Sparkle,
  Timer, X, Target, Coffee,
} from "@phosphor-icons/react";
import { mmss } from "@/lib/format";
import { track } from "@/lib/analytics-client";
import { BlockRenderer } from "./BlockRenderer";
import { CompanionPanel } from "./CompanionPanel";
import { validateBlocks } from "@/lib/blocks";

interface OutlineItem { id: string; title: string; isFree: boolean; durationSec: number; current: boolean }
interface SubtitleCue { startSec: number; endSec: number; text: string }
interface LessonData {
  id: string; title: string; summary: string | null; contentType: string;
  durationSec: number; isFree: boolean; videoUrl: string | null; articleMd: string | null;
  liveStartAt?: string | null; liveSeatLimit?: number | null;
  subtitles?: SubtitleCue[];
  blocksJson?: string | null; // ai_block 类型：结构化块课件 JSON 字符串
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
  const [panelTab, setPanelTab] = useState<"notes" | "companion">("notes"); // 侧栏：笔记 / AI 伴侣
  const [sheetOpen, setSheetOpen] = useState(false);
  const [focus, setFocus] = useState(false);
  const [seekPulse, setSeekPulse] = useState<number | null>(null);

  // —— §9 专注 2.0：入席仪式 + 番茄钟 + 会话记录 ——
  const [focusStage, setFocusStage] = useState<"idle" | "prep" | "active" | "review">("idle"); // 入席流程阶段
  const [focusGoal, setFocusGoal] = useState(""); // 本次目标
  const [pomodoroMin, setPomodoroMin] = useState(25); // 番茄钟时长（25/45/60）
  const [remainingSec, setRemainingSec] = useState(25 * 60); // 剩余秒数
  const [onBreak, setOnBreak] = useState(false); // 到点休息提示
  const [sessionId, setSessionId] = useState<string | null>(null); // FocusSession id
  const focusStartRef = useRef<number>(0); // 入席时刻（ms），用于算真实时长
  const [reviewData, setReviewData] = useState<{ minutes: number; noteCount: number; summary: string | null } | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
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

  // —— §9 专注 2.0 逻辑 ——
  // 打开入席准备面板（写目标 + 选番茄钟时长）
  const openFocusPrep = useCallback(() => {
    if (focusStage === "active") return; // 已在专注中
    setFocusStage("prep");
  }, [focusStage]);

  // 正式入席：调 /api/focus 建会话，进入全屏沉浸 + 启动番茄钟
  const enterFocus = useCallback(async () => {
    setRemainingSec(pomodoroMin * 60);
    setOnBreak(false);
    focusStartRef.current = Date.now();
    setFocus(true);
    setFocusStage("active");
    track("focus_mode_toggle", { on: true, pomodoro_min: pomodoroMin });
    if (isLoggedIn) {
      try {
        const res = await fetch("/api/focus", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ goal: focusGoal.trim() || undefined, lessonId: lesson.id, courseId }),
        });
        const json = (await res.json()) as { ok: true; data: { sessionId: string } } | { ok: false };
        if (json.ok) setSessionId(json.data.sessionId);
      } catch {
        /* 会话记录失败不阻断专注体验 */
      }
    }
  }, [pomodoroMin, focusGoal, isLoggedIn, lesson.id, courseId]);

  // 离席：调 /api/focus PATCH 结束会话（可选 AI 小结），进入小结卡
  const exitFocus = useCallback(async (withAiSummary: boolean) => {
    const elapsedMin = Math.max(0, Math.round((Date.now() - focusStartRef.current) / 60000));
    setFocus(false);
    setFocusStage("review");
    setReviewData({ minutes: elapsedMin, noteCount: 0, summary: null });
    if (withAiSummary) setSummaryLoading(true);
    if (isLoggedIn && sessionId) {
      try {
        const res = await fetch("/api/focus", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, minutes: elapsedMin, aiSummary: withAiSummary }),
        });
        const json = (await res.json()) as
          | { ok: true; data: { minutes: number; noteCount: number; summary: string | null } }
          | { ok: false };
        if (json.ok) {
          setReviewData({ minutes: json.data.minutes, noteCount: json.data.noteCount, summary: json.data.summary });
        }
      } catch {
        /* 结束失败：仍展示本地统计 */
      }
    }
    setSummaryLoading(false);
    setSessionId(null);
    track("focus_mode_toggle", { on: false, minutes: elapsedMin });
  }, [isLoggedIn, sessionId]);

  // 番茄钟倒计时：active 且未休息时每秒递减；到点切休息态并提示
  useEffect(() => {
    if (focusStage !== "active" || onBreak) return;
    if (remainingSec <= 0) {
      setOnBreak(true);
      toast("番茄钟完成，起身活动 5 分钟吧", { tone: "success" });
      return;
    }
    const id = setInterval(() => setRemainingSec((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [focusStage, onBreak, remainingSec, toast]);

  // 再来一颗番茄：重置计时
  const restartPomodoro = useCallback(() => {
    setRemainingSec(pomodoroMin * 60);
    setOnBreak(false);
  }, [pomodoroMin]);

  // 键盘快捷键：空格播放 / S 截帧 / N 批注 / F 焦点
  // 用 ref 持有最新处理逻辑，监听器只在 mount 时绑定一次，避免依赖数组不全导致的陈旧闭包
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  onKeyRef.current = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "TEXTAREA" || tag === "INPUT") return;
    if (e.key === " ") { e.preventDefault(); togglePlay(); }
    else if (e.key.toLowerCase() === "s") { e.preventDefault(); captureFrame(); }
    else if (e.key.toLowerCase() === "n") { e.preventDefault(); quickNote(); }
    else if (e.key.toLowerCase() === "f") { e.preventDefault(); if (focusStage === "active") exitFocus(false); else openFocusPrep(); }
    else if (e.key === "Escape" && focusStage === "active") { e.preventDefault(); exitFocus(false); }
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

  // ai_block 块课件：解析并校验块数组（validateBlocks 永不抛错，脏数据归空数组）。
  // 块课无视频时间轴——不做截帧 / 进度条；MVP 笔记走普通笔记（anchorRef 可空），先保证能记能显示。
  const isBlockLesson = lesson.contentType === "ai_block";
  const blocks = isBlockLesson ? validateBlocks(safeParseJson(lesson.blocksJson)) : [];

  const CaptureBar = access && (
    <div className="flex items-center gap-2">
      <Tooltip label="截取画面 (S)"><button onClick={captureFrame} className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20" aria-label="截取画面"><Camera size={16} /></button></Tooltip>
      <Tooltip label="快速批注 (N)"><button onClick={quickNote} className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20" aria-label="快速批注"><NotePencil size={16} /></button></Tooltip>
      <Tooltip label={focusStage === "active" ? "退出专注 (F)" : "进入专注 (F)"}><button onClick={() => (focusStage === "active" ? exitFocus(false) : openFocusPrep())} className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20" aria-label="专注模式">{focusStage === "active" ? <ArrowsIn size={16} /> : <ArrowsOut size={16} />}</button></Tooltip>
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

  // 番茄钟进度（已过 / 总时长）
  const pomodoroTotal = pomodoroMin * 60;
  const pomodoroPct = pomodoroTotal > 0 ? ((pomodoroTotal - remainingSec) / pomodoroTotal) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* §9 入席准备面板：写目标 + 选番茄钟时长 */}
      {focusStage === "prep" && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onClick={() => setFocusStage("idle")}>
          <div
            className="studio-rise w-full max-w-[420px] rounded-[20px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--lift)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 text-[var(--red)]">
              <Target size={18} weight="fill" />
              <span className="mono text-[11px] uppercase tracking-[0.14em]">FOCUS · 专注入席</span>
            </div>
            <h3 className="mt-2 text-[18px] font-bold text-[var(--ink)]">准备好进入专注了吗</h3>
            <p className="mt-1 text-[13px] leading-[1.6] text-[var(--ink3)]">写下这次的目标，选一个番茄钟时长，全屏沉浸开始学习。</p>

            {/* 本次目标 */}
            <label className="mt-4 block text-[12px] font-semibold text-[var(--ink2)]">本次目标（可选）</label>
            <input
              value={focusGoal}
              onChange={(e) => setFocusGoal(e.target.value)}
              maxLength={200}
              placeholder="例如：看完本节并整理 3 条笔记"
              className="mt-1.5 w-full rounded-[12px] border border-[var(--border)] bg-[var(--surface-inset)] px-3.5 py-2.5 text-[14px] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--ink3)]"
            />

            {/* 番茄钟时长 */}
            <label className="mt-4 block text-[12px] font-semibold text-[var(--ink2)]">番茄钟时长</label>
            <div className="mt-1.5 flex gap-2">
              {[25, 45, 60].map((m) => (
                <button
                  key={m}
                  onClick={() => setPomodoroMin(m)}
                  className={`mono flex-1 rounded-[12px] border px-3 py-2.5 text-[14px] font-semibold transition-colors ${
                    pomodoroMin === m
                      ? "border-[var(--red-soft-border)] bg-[var(--red-soft)] text-[var(--red)]"
                      : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink3)] hover:text-[var(--ink)]"
                  }`}
                >
                  {m} 分钟
                </button>
              ))}
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              <button onClick={() => setFocusStage("idle")} className="studio-press rounded-[11px] px-4 py-2.5 text-[13px] font-semibold text-[var(--ink3)] transition-colors hover:text-[var(--ink)]">
                取消
              </button>
              <button onClick={enterFocus} className="studio-press inline-flex items-center gap-1.5 rounded-[12px] bg-[var(--red)] px-5 py-2.5 text-[14px] font-bold text-white transition-all hover:brightness-105">
                <Timer size={15} weight="fill" /> 进入专注
              </button>
            </div>
          </div>
        </div>
      )}

      {/* §9 专注全屏沉浸：顶部番茄钟计时条 + 四周暗角 + 离席控制 */}
      {focusStage === "active" && (
        <>
          {/* 四周暗角（vignette），点击穿透不挡内容 */}
          <div
            className="pointer-events-none fixed inset-0 z-[60]"
            style={{ boxShadow: "inset 0 0 200px 60px rgba(0,0,0,0.55)", background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.28) 100%)" }}
            aria-hidden
          />
          {/* 顶部番茄钟条 */}
          <div className="fixed inset-x-0 top-0 z-[70]">
            <div className="h-1 w-full bg-black/30">
              <div className="h-full bg-[var(--red)] transition-all duration-1000 ease-linear" style={{ width: `${pomodoroPct}%` }} aria-hidden />
            </div>
            <div className="mx-auto flex max-w-[720px] items-center gap-3 px-4 py-2.5">
              <div className="inline-flex items-center gap-2 rounded-full bg-black/45 px-3 py-1.5 text-white backdrop-blur-sm">
                {onBreak ? <Coffee size={15} weight="fill" className="text-[var(--red)]" /> : <Timer size={15} weight="fill" className="text-[var(--red)]" />}
                <span className="mono text-[15px] font-bold tabular-nums">{mmss(remainingSec)}</span>
              </div>
              {focusGoal && (
                <div className="min-w-0 flex-1 truncate rounded-full bg-black/35 px-3 py-1.5 text-[12.5px] text-white/85 backdrop-blur-sm">
                  <Target size={12} weight="fill" className="mr-1 inline text-[var(--red)]" />
                  {focusGoal}
                </div>
              )}
              <div className="flex-1" />
              {onBreak && (
                <button onClick={restartPomodoro} className="studio-press inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-1.5 text-[12.5px] font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/25">
                  再来一颗
                </button>
              )}
              {isLoggedIn && sessionId && (
                <button onClick={() => exitFocus(true)} className="studio-press inline-flex items-center gap-1.5 rounded-full bg-[var(--red)] px-3.5 py-1.5 text-[12.5px] font-semibold text-white backdrop-blur-sm transition-all hover:brightness-105" aria-label="退出并生成AI小结">
                  <Sparkle size={13} weight="fill" /> 离席 · AI 小结
                </button>
              )}
              <button onClick={() => exitFocus(false)} className="studio-press inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-1.5 text-[12.5px] font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/25" aria-label="退出专注">
                <X size={13} weight="bold" /> 退出专注
              </button>
            </div>
          </div>
        </>
      )}

      {/* §9 离席小结卡：本次专注 X 分钟 / 记了 N 条笔记 / 可选 AI 小结 */}
      {focusStage === "review" && reviewData && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onClick={() => setFocusStage("idle")}>
          <div
            className="studio-rise w-full max-w-[420px] rounded-[20px] border border-[var(--border)] bg-[var(--surface)] p-6 text-center shadow-[var(--lift)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--red-soft)] text-[var(--red)]">
              <Check size={24} weight="bold" />
            </div>
            <h3 className="mt-3 text-[18px] font-bold text-[var(--ink)]">这次专注结束</h3>
            <div className="mt-4 flex items-center justify-center gap-6">
              <div>
                <div className="mono text-[28px] font-extrabold leading-none text-[var(--red)]">{reviewData.minutes}</div>
                <div className="mt-1 text-[12px] text-[var(--ink3)]">专注分钟</div>
              </div>
              <div className="h-10 w-px bg-[var(--border)]" />
              <div>
                <div className="mono text-[28px] font-extrabold leading-none text-[var(--ink)]">{reviewData.noteCount}</div>
                <div className="mt-1 text-[12px] text-[var(--ink3)]">新增笔记</div>
              </div>
            </div>

            {focusGoal && (
              <div className="mt-4 rounded-[12px] border border-[var(--border)] bg-[var(--surface-inset)] px-3.5 py-2.5 text-left text-[13px] text-[var(--ink2)]">
                <Target size={12} weight="fill" className="mr-1 inline text-[var(--red)]" />
                本次目标：{focusGoal}
              </div>
            )}

            {/* AI 小结（可选） */}
            {summaryLoading ? (
              <div className="mt-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface-inset)] px-3.5 py-3 text-[13px] text-[var(--ink3)]">
                <Sparkle size={13} weight="fill" className="mr-1 inline text-[var(--red)]" />
                AI 正在生成小结…
              </div>
            ) : reviewData.summary ? (
              <div className="mt-3 rounded-[12px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-3.5 py-3 text-left text-[13px] leading-[1.7] text-[var(--ink2)]">
                <div className="mono mb-1 flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-[var(--red)]">
                  <Sparkle size={11} weight="fill" /> AI 小结
                </div>
                {reviewData.summary}
              </div>
            ) : null}

            <button onClick={() => setFocusStage("idle")} className="studio-press mt-4 inline-flex w-full items-center justify-center rounded-[12px] bg-[var(--ink)] px-4 py-2.5 text-[14px] font-bold text-[var(--surface)]">
              完成
            </button>
          </div>
        </div>
      )}

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
            {isBlockLesson ? (
              // 块课件：左侧内容区渲染块，而非视频。无视频时间轴 → 无截帧 / 无播放控制条。
              <div className="rounded-2xl border border-ink-100 bg-paper-raised p-4 sm:p-6">
                <BlockRenderer blocks={blocks} courseId={courseId} />
              </div>
            ) : lesson.contentType === "live" ? (
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
                {/* 块课无时间轴，不显示基于播放时长的进度 */}
                {!isBlockLesson && <span className="num shrink-0 text-xs text-ink-400">已学 {Math.round(progress * 100)}%</span>}
              </div>
              {lesson.summary && <p className="mt-1 text-sm text-ink-500">{lesson.summary}</p>}
              {!isBlockLesson && <div className="mt-3"><WaveProgress value={progress} /></div>}
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

          {/* 右：笔记 / AI 伴侣 双 Tab 面板（桌面，360px）*/}
          {!focus && (
            <aside className="focus-hide hidden lg:block">
              <div className="sticky top-24 space-y-4">
                {/* Tab 切换 */}
                <div className="inline-flex rounded-[12px] border border-[var(--border)] bg-[var(--surface2)] p-1 text-[13px] font-semibold">
                  <button
                    onClick={() => setPanelTab("notes")}
                    className={`rounded-[9px] px-4 py-1.5 transition-colors ${panelTab === "notes" ? "bg-[var(--surface)] text-[var(--ink)] shadow-[var(--card)]" : "text-[var(--ink3)] hover:text-[var(--ink)]"}`}
                  >
                    笔记
                  </button>
                  <button
                    onClick={() => setPanelTab("companion")}
                    className={`inline-flex items-center gap-1.5 rounded-[9px] px-4 py-1.5 transition-colors ${panelTab === "companion" ? "bg-[var(--surface)] text-[var(--ink)] shadow-[var(--card)]" : "text-[var(--ink3)] hover:text-[var(--ink)]"}`}
                  >
                    <Sparkle size={13} weight={panelTab === "companion" ? "fill" : "regular"} className="text-[var(--red)]" />
                    AI 伴侣
                  </button>
                </div>
                <div className="h-[540px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
                  {panelTab === "notes" ? noteEditor : <CompanionPanel lessonId={lesson.id} courseId={courseId} />}
                </div>
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

/** 安全解析块课件 JSON 字符串：解析失败或空值返回 null，交给 validateBlocks 归空。 */
function safeParseJson(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
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
