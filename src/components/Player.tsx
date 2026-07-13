"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NoteEditor, type NoteItem, type NoteEditorHandle } from "./NoteEditor";
import { Paywall } from "./Paywall";
import { Badge } from "./ui";
import { Tooltip } from "./Tooltip";
import { SheetDrag } from "./motion";
import { useToast } from "./Toast";
import { useMode } from "./ModeProvider";
import {
  Play, Pause, LockSimple, CaretLeft, CaretRight, Check,
  Camera, NotePencil, ArrowsOut, ArrowsIn, Moon, Sun, CornersOut, Sparkle,
  Timer, X, Target, Coffee, Cards, ListDashes,
} from "@phosphor-icons/react";
import { mmss } from "@/lib/format";
import { track } from "@/lib/analytics-client";
import { BlockRenderer } from "./BlockRenderer";
import { BlockSlideshow } from "./BlockSlideshow";
import { CompanionPanel } from "./CompanionPanel";
import { validateBlocks } from "@/lib/blocks";
import { coursewareThemeAttr } from "@/lib/ai/themes";
import { HtmlCourseware } from "./HtmlCourseware";
import { trapFocus } from "./focus-trap";
import { isPlayableVideoUrl } from "@/lib/media-url";

interface OutlineItem { id: string; title: string; isFree: boolean; durationSec: number; current: boolean }
interface SubtitleCue { startSec: number; endSec: number; text: string }
interface LessonData {
  id: string; title: string; summary: string | null; contentType: string;
  durationSec: number; isFree: boolean; videoUrl: string | null; articleMd: string | null;
  liveStartAt?: string | null; liveSeatLimit?: number | null;
  subtitles?: SubtitleCue[];
  blocksJson?: string | null; // ai_block 类型：结构化块课件 JSON 字符串
  htmlJson?: string | null; // v3.3 ai_html 类型：自包含 HTML 课件渲染契约 {html, hasScript, checksum, ...}
  videoGenStatus?: string | null; // v3.1 视频课件生成态：null / pending / generating / ready / failed
  videoDurationSec?: number | null; // v3.1 视频课件时长（秒）：与图文阅读语义的 durationSec 隔离，仅驱动「视频」Tab 的时间轴/续播
}

/**
 * Player 2.0，「学习台」。
 * 桌面：视频 + 笔记面板(360px) + 目录，可折叠 + 焦点模式；移动：视频吸顶 + 可拖拽笔记 Sheet。
 * 支持真实 <video>（有 videoUrl 时）与模拟兜底；捕捉条：截帧 / 快速批注 / 字幕划线剪藏。
 */
export function Player({
  courseId, courseSlug, courseTitle, lesson, access, canCreateNote,
  outline, prevLessonId, nextLessonId, remainingLessons, isLoggedIn, initialProgress, initialSlidePage, initialNotes,
  posterSrc, sceneBgSrc, courseTemplate, dueReviewCount = 0,
}: {
  courseId: string; courseSlug: string; courseTitle: string;
  lesson: LessonData; access: boolean; canCreateNote: boolean;
  outline: OutlineItem[]; prevLessonId: string | null; nextLessonId: string | null;
  remainingLessons: number; isLoggedIn: boolean; initialProgress: number;
  /** 翻页课件上次读到的页码(1-indexed)，0 表示无记录。用于恢复续读位置，与 initialProgress(秒)互不相关。 */
  initialSlidePage: number; initialNotes: NoteItem[];
  /** 按赛道映射的课程定格图（lesson still）路径，作视频区 poster / 模拟兜底底图，替代纯渐变。 */
  posterSrc?: string;
  /** 按赛道映射的 scene 块场景背景图路径（server 端按 course.category 解析）。透传给块渲染，作 SceneBlock 氛围底。 */
  sceneBgSrc?: string;
  /** 课件视觉主题（= course.template）。挂到块课件外层 data-ct-theme，驱动 globals.css 换肤；空则默认皮肤。 */
  courseTemplate?: string | null;
  /** 问题⑧：当前用户到期待复习卡数量（server 端 count）。>0 时在课末插入「顺手复习」触点，把复习带进学习流。 */
  dueReviewCount?: number;
}) {
  const { toast } = useToast();
  const { theme, toggleTheme } = useMode();
  // 课件视觉主题：course.template → data-ct-theme（未选模板的旧课为 undefined，回落默认皮肤）。
  const ctTheme = coursewareThemeAttr(courseTemplate);
  const router = useRouter();
  const [time, setTime] = useState(initialProgress);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [showNotesDrawer, setShowNotesDrawer] = useState(true);
  const [panelTab, setPanelTab] = useState<"notes" | "companion">("notes"); // 侧栏：笔记 / AI 伴侣
  const [sheetOpen, setSheetOpen] = useState(false);
  const [focus, setFocus] = useState(false);
  const [seekPulse, setSeekPulse] = useState<number | null>(null);
  // 图文课件的排布方式：翻页（黑板式单屏，默认，像 PPT）/ 滚动（长列表叙事）。
  // 与下方 blockView（图文 vs 视频课件切换）正交：blockView 选「看什么」，blockLayout 选图文「怎么排」。
  const [blockLayout, setBlockLayout] = useState<"slides" | "scroll">("slides");

  // 下一节卡：学完一节后弹出，3 秒倒计时自动跳（可手动/可关）
  const [showNextCard, setShowNextCard] = useState(false);
  const [nextCountdown, setNextCountdown] = useState(3);
  const nextDismissedRef = useRef(false); // 本节内已关过就不再弹
  const nextHref = nextLessonId ? `/courses/${courseSlug}/learn/${nextLessonId}` : null;
  const nextLessonTitle = nextLessonId ? outline.find((o) => o.id === nextLessonId)?.title ?? null : null;

  // §9 专注 2.0：入席仪式 + 番茄钟 + 会话记录
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
  const slideNoteRef = useRef<NoteEditorHandle>(null); // 翻页课件全屏笔记浮层专用（独立于侧栏/Sheet 的 noteRef）
  // prep / review 全屏面板的边界：Tab focus trap 用（两者同一时刻至多挂一个）。
  const focusPanelRef = useRef<HTMLDivElement>(null);
  // 受控私有流没有文件扩展名，但仍是真实媒体；必须交给 <video> 才会发出 Range 请求。
  // 非生产 mock asset 不匹配，继续走模拟播放器。
  const hasRealVideo = isPlayableVideoUrl(lesson.videoUrl);

  // v3.1：块课的「视频课件」有独立时长（videoDurationSec），与图文阅读语义的 durationSec 隔离。
  // 播放机（模拟推进 / seek / 时间轴 / 进度）用「有效播放时长」：块课视频视图取 videoDurationSec，
  // 其余（普通视频节、图文节的兜底视频区）取 durationSec。块课默认看图文，切到视频 Tab 才切换。
  const isBlockLessonEarly = lesson.contentType === "ai_block";
  const [blockView, setBlockView] = useState<"blocks" | "video">("blocks"); // blocks(图文) / video(视频课件)
  const showingVideoCourseware = isBlockLessonEarly && blockView === "video";
  const playbackDurationSec =
    showingVideoCourseware && (lesson.videoDurationSec ?? 0) > 0
      ? (lesson.videoDurationSec as number)
      : lesson.durationSec;

  // 模拟播放推进（无真实视频时）
  useEffect(() => {
    if (hasRealVideo || !playing || !access) return;
    const id = setInterval(() => {
      setTime((t) => {
        const next = Math.min(t + rate, playbackDurationSec);
        if (next >= playbackDurationSec) setPlaying(false);
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [hasRealVideo, playing, rate, access, playbackDurationSec]);

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
    if (time >= playbackDurationSec && playbackDurationSec > 0) saveProgress(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time]);

  // 学完本节（且有下一节、未手动关过、非块课）→ 弹出下一节卡并重置倒计时。
  // 重访已完成课节时 initialProgress 已 >= durationSec，若不排除会在挂载 3 秒后被动跳走——
  // 只有本次会话内「从未完成推进到完成」才触发。
  const initiallyCompletedRef = useRef(initialProgress >= lesson.durationSec && lesson.durationSec > 0);
  useEffect(() => {
    if (lesson.contentType === "ai_block" || !nextHref || nextDismissedRef.current || initiallyCompletedRef.current) return;
    if (time >= lesson.durationSec && lesson.durationSec > 0 && !showNextCard) {
      setNextCountdown(3);
      setShowNextCard(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time]);

  // 下一节卡倒计时：每秒递减，到 0 自动跳转
  useEffect(() => {
    if (!showNextCard || !nextHref) return;
    if (nextCountdown <= 0) {
      router.push(nextHref);
      return;
    }
    const id = setTimeout(() => setNextCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [showNextCard, nextCountdown, nextHref, router]);

  // 关闭下一节卡（本节内不再弹）
  const dismissNextCard = useCallback(() => {
    nextDismissedRef.current = true;
    setShowNextCard(false);
  }, []);

  const getCurrentTime = useCallback(() => timeRef.current, []);
  const seek = useCallback((sec: number) => {
    const clamped = Math.min(sec, playbackDurationSec);
    setTime(clamped);
    if (videoRef.current) videoRef.current.currentTime = clamped;
    setSeekPulse(clamped);
    setTimeout(() => setSeekPulse(null), 700);
  }, [playbackDurationSec]);

  function togglePlay() {
    if (hasRealVideo && videoRef.current) {
      if (videoRef.current.paused) videoRef.current.play(); else videoRef.current.pause();
    } else {
      setPlaying((p) => !p);
    }
  }

  // 捕捉：截帧当前画面
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

  // §9 专注 2.0 逻辑
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
    // Esc 关闭任一全屏浮层（prep/review/active），即使焦点在输入框内也生效
    if (e.key === "Escape" && (focusStage === "prep" || focusStage === "review")) { e.preventDefault(); setFocusStage("idle"); return; }
    // prep/review 模态开启时把 Tab 焦点困在面板内（须在 INPUT/TEXTAREA 早退之前处理，
    // 否则焦点落在目标输入框时 Tab 会逃出面板）。
    if (e.key === "Tab" && (focusStage === "prep" || focusStage === "review")) { trapFocus(e, focusPanelRef.current); return; }
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

  // prep / review 全屏模态：body 锁滚 + 进入时把焦点移入面板（关闭还原由 keydown/点击触发）。
  // active（专注舱）是点击穿透的沉浸层、非模态，不锁滚。
  const focusModalOpen = focusStage === "prep" || focusStage === "review";
  useEffect(() => {
    if (!focusModalOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const raf = requestAnimationFrame(() =>
      focusPanelRef.current?.querySelector<HTMLElement>("input,button,a[href]")?.focus(),
    );
    return () => {
      document.body.style.overflow = prevOverflow;
      cancelAnimationFrame(raf);
    };
  }, [focusModalOpen]);

  const activeCue = lesson.subtitles?.find((c) => time >= c.startSec && time < c.endSec);
  // 时间轴百分比用有效播放时长：块课视频视图取 videoDurationSec，其余取 durationSec。
  const progress = playbackDurationSec > 0 ? time / playbackDurationSec : 0;

  // v3.3 多样化 HTML 课件：只要本节有渲染契约 htmlJson 就用沙箱 iframe 渲染（HtmlCourseware）。
  // 关键：以「htmlJson 是否存在」为准而非 contentType——课仍保持 contentType=ai_block，
  // 于是 Web 渲染 HTML 课件、iOS 原生按 blocks 渲染（不认 htmlJson 字段），iOS 零破坏。
  // 门控随 access（付费节无权益时 htmlJson 为 null）；契约脏/无 html 时回落到块渲染。
  const htmlContract = safeParseJson(lesson.htmlJson) as { html?: string } | null;
  const isHtmlLesson = Boolean(htmlContract && typeof htmlContract.html === "string" && htmlContract.html);

  // ai_block 块课件：解析并校验块数组（validateBlocks 永不抛错，脏数据归空数组）。
  // 块课无视频时间轴，不做截帧 / 时间进度条；MVP 笔记走普通笔记（anchorRef 可空），先保证能记能显示。
  const isBlockLesson = isBlockLessonEarly;
  const blocks = isBlockLesson ? validateBlocks(safeParseJson(lesson.blocksJson)) : [];

  // v3.1 视频课件：块课可另有一版「视频课件」。ready 时给块课加「图文 / 视频」切换 Tab；
  // 生成中(pending/generating)显示占位；null 表示未生成视频课件。仅块课 + 有权益时相关。
  // blockView 状态在上方（播放时长派生处）已声明。
  const videoStatus = lesson.videoGenStatus ?? null;
  const hasVideoCourseware = isBlockLesson && access && videoStatus === "ready" && !!lesson.videoUrl;
  const videoGenerating = isBlockLesson && access && (videoStatus === "pending" || videoStatus === "generating");
  const showVideoView = isBlockLesson && blockView === "video" && (hasVideoCourseware || videoGenerating);

  // 翻页课件进度上报：块课无时间轴，用「当前页 / 总页」映射为进度。
  // 页进度落到独立的 lastSlideIndex（kind:"slide"），与视频/模拟播放的 progressSec 隔离，
  // 两个视图的续读锚点互不覆盖。completed 在末页触发，落库为完课。翻页去抖：仅在页码变化时上报。
  const blockPageRef = useRef(initialSlidePage);
  // 本节是否已上报过完课（翻页到末页 / 滚动读到末块）。翻页与滚动两模式共享此哨兵，
  // 保证同一节课的 completed 只 POST 一次，避免切换排布方式时重复上报完课。
  const blockCompletedRef = useRef(false);
  const reportBlockPage = useCallback((pageIndex: number, totalPages: number) => {
    if (!isLoggedIn || !access) return;
    const page = pageIndex + 1; // 1-indexed
    if (page === blockPageRef.current) return; // 同页重复上报去抖
    blockPageRef.current = page;
    const reachedEnd = page >= totalPages && totalPages > 0;
    // completed 仅在首次到末页时置真：已上报过则本次只更新页序、不再重复 POST completed。
    const completed = reachedEnd && !blockCompletedRef.current;
    if (reachedEnd) blockCompletedRef.current = true;
    fetch("/api/progress", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lessonId: lesson.id, progressSec: page, completed, kind: "slide" }),
    }).catch(() => {});
    track("lesson_slide_advance", { lesson_id: lesson.id, page, total: totalPages });
  }, [isLoggedIn, access, lesson.id]);

  // 翻页课件完课：抵达末页触发下一节卡（若有下一节且未手动关过）。与视频完课逻辑对齐但走页序而非时间轴。
  const onBlockComplete = useCallback(() => {
    if (!nextHref || nextDismissedRef.current) return;
    setNextCountdown(3);
    setShowNextCard(true);
  }, [nextHref]);

  // 滚动模式完课：滚动读到末块（BlockRenderer.onReachEnd）时上报一次完课并弹下一节卡，
  // 与翻页模式末页完课语义一致。与翻页共享 blockCompletedRef 去抖：本节已上报过完课
  // （翻页到末页 / 已滚到末块）则跳过，保证同节不重复 POST completed。
  // 走 kind:"slide" 落 completedAt 且不污染视频 progressSec；progressSec:1 仅作占位（末块无页序语义）。
  const reportScrollComplete = useCallback(() => {
    if (!isLoggedIn || !access) return;
    if (blockCompletedRef.current) return; // 本节已上报过完课，去抖
    blockCompletedRef.current = true;
    fetch("/api/progress", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lessonId: lesson.id, progressSec: 1, completed: true, kind: "slide" }),
    }).catch(() => {});
    onBlockComplete();
  }, [isLoggedIn, access, lesson.id, onBlockComplete]);

  // 工具按钮命中区扩展：透明 44x44 伪元素外扩，视觉尺寸不变（WCAG 2.5.5 目标尺寸）。
  const hit44 = "relative after:absolute after:left-1/2 after:top-1/2 after:h-[44px] after:w-[44px] after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']";
  const CaptureBar = access && (
    <div className="flex items-center gap-1.5">
      <Tooltip label="截取画面 (S)"><button onClick={captureFrame} className={`studio-press group inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-white/10 transition-colors hover:bg-white/20 ${hit44}`} aria-label="截取画面"><Camera size={16} className="icon-nudge text-white/75 group-hover:text-white" /></button></Tooltip>
      <Tooltip label="快速批注 (N)"><button onClick={quickNote} className={`studio-press group inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-white/10 transition-colors hover:bg-white/20 ${hit44}`} aria-label="快速批注"><NotePencil size={16} className="icon-nudge text-white/75 group-hover:text-white" /></button></Tooltip>
      {/* 进入专注：关键动作，用红柔光 CTA 引导（图标常亮 white，仅微动放大） */}
      <Tooltip label={focusStage === "active" ? "退出专注 (F)" : "进入专注 (F)"}><button onClick={() => (focusStage === "active" ? exitFocus(false) : openFocusPrep())} className={`studio-press group inline-flex h-9 w-9 items-center justify-center rounded-[10px] transition-colors ${focusStage === "active" ? "bg-white/10 hover:bg-white/20" : "bg-[var(--red)] cta-glow"} ${hit44}`} aria-label="专注模式">{focusStage === "active" ? <ArrowsIn size={16} className="icon-nudge text-white/75 group-hover:text-white" /> : <ArrowsOut size={16} className="icon-nudge text-white" />}</button></Tooltip>
    </div>
  );

  const VideoArea = (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] shadow-[var(--card)]" style={{ background: "var(--video-bg)" }}>
      <div className="relative aspect-video">
        {hasRealVideo ? (
          <video
            ref={videoRef}
            src={lesson.videoUrl ?? undefined}
            poster={posterSrc}
            className="h-full w-full"
            style={{ background: "var(--video-bg)" }}
            playsInline
            crossOrigin="anonymous"
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => saveProgress(true)}
          />
        ) : (
          <div className="flex h-full items-center justify-center" style={{ background: "var(--video-grad)" }}>
            {/* 赛道定格图铺底（真实图，替代纯渐变）；渐变仍作加载前/无图兜底底色。
                DOM 顺序在下方纹理/柔光/播放圆之前 → 天然叠在最底层。 */}
            {posterSrc && (
              <img
                src={posterSrc}
                alt=""
                aria-hidden
                loading="lazy"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover opacity-90"
              />
            )}
            {/* 定格图上压一层深色渐变，保证白色播放圆与免费标可读 */}
            {posterSrc && (
              <div aria-hidden className="absolute inset-0" style={{ background: "linear-gradient(160deg, rgba(20,26,36,.55), rgba(10,12,16,.68))" }} />
            )}
            {/* 细点纹理，增加深色区材质，避免死黑平面 */}
            <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.7) 1px, transparent 0)", backgroundSize: "22px 22px" }} aria-hidden />
            {/* 顶部柔光晕，营造展示区聚光感 */}
            <div className="absolute inset-x-0 top-0 h-1/2 opacity-60" style={{ background: "radial-gradient(60% 90% at 50% 0%, rgba(255,255,255,.08), transparent 70%)" }} aria-hidden />
            {access && (
              <button onClick={togglePlay} className="studio-press group relative flex h-[68px] w-[68px] items-center justify-center rounded-full bg-white/95 text-[var(--red)] shadow-[0_8px_28px_-6px_rgba(0,0,0,.5)] ring-1 ring-white/40 transition-transform duration-200 hover:scale-[1.08]" title={playing ? "暂停" : "播放"} aria-label={playing ? "暂停" : "播放"}>
                {/* 播放待机时的呼吸光环，暗示可点击 */}
                {!playing && <span className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white/50 motion-safe:animate-ping" aria-hidden />}
                {playing ? <Pause size={26} weight="fill" /> : <Play size={26} weight="fill" className="ml-0.5" />}
              </button>
            )}
          </div>
        )}

        {!access && (
          <div className="absolute inset-0 flex items-center justify-center text-center text-white/90 backdrop-blur-[2px]" style={{ background: "linear-gradient(160deg, rgba(20,26,36,.72), rgba(10,12,16,.82))" }}>
            <div className="px-6">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-white/10 ring-1 ring-white/15">
                <LockSimple size={26} weight="light" />
              </div>
              <p className="mt-3 text-sm font-medium text-white">该章节需要订阅后观看</p>
              <p className="mt-1 text-[12px] text-white/60">订阅后解锁完整视频与笔记</p>
            </div>
          </div>
        )}
        {lesson.isFree && <div className="absolute right-3 top-3"><Badge tone="accent">免费试学</Badge></div>}

        {/* 字幕行（可划线剪藏） */}
        {access && activeCue && (
          <div onMouseUp={clipSelection} className="absolute inset-x-0 bottom-3 flex justify-center px-6">
            <p className="max-w-2xl select-text rounded-[10px] bg-black/55 px-3.5 py-2 text-center text-sm leading-relaxed text-white/95 shadow-[0_2px_10px_-4px_rgba(0,0,0,.6)] backdrop-blur-md">
              {activeCue.text}
            </p>
          </div>
        )}
      </div>

      {/* 控制条 */}
      {access && (
        <div className="space-y-2.5 px-4 py-3 text-white" style={{ background: "var(--video-grad)" }}>
          {/* 水位进度条 + seek 波纹：已播段红色水位发光，右侧待播冷灰。装饰轨仅示意，真实交互在其上的原生 range。 */}
          <div className="group relative h-4">
            {/* 视觉水位轨道（装饰层） */}
            <div className="pointer-events-none absolute inset-x-0 top-1/2 h-[6px] -translate-y-1/2 overflow-hidden rounded-full bg-white/12" aria-hidden>
              <div className="h-full rounded-full bg-[var(--red)] transition-[width] duration-150 ease-out" style={{ width: `${Math.min(100, progress * 100)}%`, boxShadow: "0 0 10px -1px rgba(252,1,26,.55)" }} />
              {/* 水位顶端高光点，像波峰 */}
              <div className="absolute top-1/2 h-[6px] w-[6px] -translate-y-1/2 rounded-full bg-white/85" style={{ left: `calc(${Math.min(100, progress * 100)}% - 3px)`, opacity: progress > 0.01 ? 1 : 0 }} aria-hidden />
            </div>
            {/* 原生 range 置顶捕获拖拽，自身近乎透明只保留可拖拽热区 */}
            <input
              type="range" min={0} max={playbackDurationSec} value={time} step={0.1}
              onChange={(e) => seek(Number(e.target.value))}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]"
              aria-label="播放进度"
            />
            {seekPulse != null && playbackDurationSec > 0 && (
              <span
                className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-[var(--red)]/70"
                style={{ left: `${(seekPulse / playbackDurationSec) * 100}%`, animation: "ripple 0.6s var(--ease-out-expo) forwards" }}
              />
            )}
          </div>
          {/* P1-3：flex-wrap 让超窄屏(≤360)控件换行而非被卡片 overflow-hidden 裁掉倍速选择器；≥375 仍单行。 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <button onClick={togglePlay} className={`studio-press grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-white/90 transition-colors hover:bg-white/20 hover:text-white ${hit44}`} title={playing ? "暂停" : "播放"} aria-label={playing ? "暂停" : "播放"}>{playing ? <Pause size={17} weight="fill" /> : <Play size={17} weight="fill" className="ml-0.5" />}</button>
            <span className="mono shrink-0 text-xs tabular-nums text-white/70"><span className="text-white/90">{mmss(Math.floor(time))}</span> / {mmss(playbackDurationSec)}</span>
            <div className="ml-auto" />
            {CaptureBar}
            <Tooltip label={theme === "deep" ? "浅色" : "深海模式"}>
              <button onClick={toggleTheme} className={`studio-press group inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-white/10 transition-colors hover:bg-white/20 ${hit44}`} aria-label="切换主题">
                {theme === "deep" ? <Sun size={16} className="icon-nudge text-white/75 group-hover:text-white" /> : <Moon size={16} className="icon-nudge text-white/75 group-hover:text-white" />}
              </button>
            </Tooltip>
            {/* 倍速：与其它工具按钮统一 h-9 命中区 + hover 描边，不再是裸 white/10 方块 */}
            <select value={rate} onChange={(e) => { setRate(Number(e.target.value)); track("lesson_speed_change", { rate: e.target.value }); }} className="mono h-9 cursor-pointer rounded-[10px] border border-transparent bg-white/10 px-2.5 text-xs tabular-nums text-white outline-none transition-colors hover:border-white/25 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" aria-label="播放速度">
              {[0.75, 1, 1.25, 1.5, 2].map((r) => <option key={r} value={r} className="text-[var(--ink)]">{r}x</option>)}
            </select>
          </div>
        </div>
      )}
    </div>
  );

  const noteEditor = (
    <NoteEditor ref={noteRef} courseId={courseId} lessonId={lesson.id} getCurrentTime={getCurrentTime} onSeek={seek} initialNotes={initialNotes} canCreate={canCreateNote} />
  );

  // 翻页课件「全屏调笔记」用的独立笔记编辑器：走独立 ref（slideNoteRef），
  // 不与桌面侧栏 / 移动 Sheet 的 noteEditor 争抢同一个 noteRef（同一 ref 被多实例挂载会互相覆盖）。
  // 块课无视频时间轴，getCurrentTime 恒为 0（无时间戳锚定语义），采集能力（文本笔记）原样复用。
  const slideNoteEditor = (
    <NoteEditor ref={slideNoteRef} courseId={courseId} lessonId={lesson.id} getCurrentTime={getCurrentTime} onSeek={seek} initialNotes={initialNotes} canCreate={canCreateNote} />
  );

  // 番茄钟进度（已过 / 总时长）
  const pomodoroTotal = pomodoroMin * 60;
  const pomodoroPct = pomodoroTotal > 0 ? ((pomodoroTotal - remainingSec) / pomodoroTotal) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* §9 入席准备面板：写目标 + 选番茄钟时长 */}
      {focusStage === "prep" && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" style={{ zIndex: "var(--z-focus)" }} onClick={() => setFocusStage("idle")}>
          <div
            ref={focusPanelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="focus-prep-title"
            className="studio-rise elev-3 w-full max-w-[420px] rounded-[var(--radius-card)] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 text-[var(--red)]">
              <Target size={18} weight="fill" />
              <span className="mono text-[11px] uppercase tracking-[0.14em]">FOCUS · 专注入席</span>
            </div>
            <h3 id="focus-prep-title" className="mt-2 text-[18px] font-bold text-[var(--ink)]">准备好进入专注了吗</h3>
            <p className="mt-1 text-[13px] leading-[1.6] text-[var(--ink3)]">写下这次的目标，选一个番茄钟时长，全屏沉浸开始学习。</p>

            {/* 本次目标 */}
            <label className="mt-4 block text-[12px] font-semibold text-[var(--ink2)]">本次目标（可选）</label>
            <input
              value={focusGoal}
              onChange={(e) => setFocusGoal(e.target.value)}
              maxLength={200}
              placeholder="例如：看完本节并整理 3 条笔记"
              className="mt-1.5 w-full rounded-[12px] border border-[var(--border)] bg-[var(--surface-inset)] px-3.5 py-2.5 text-[14px] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink4)] focus:border-[var(--ink3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red-soft)]"
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
              <button onClick={enterFocus} className="studio-press cta-glow inline-flex items-center gap-1.5 rounded-[12px] bg-[var(--red)] px-5 py-2.5 text-[14px] font-bold text-white transition-colors hover:bg-[var(--red-hover)]">
                <Timer size={15} weight="fill" /> 进入专注
              </button>
            </div>
          </div>
        </div>
      )}

      {/* §9 专注全屏沉浸：顶部番茄钟计时条 + 四周暗角 + 离席控制 */}
      {focusStage === "active" && (
        <>
          {/* 四周暗角（vignette）：入席时 400-500ms 缓缓合拢，营造「灯光暗下来」的沉浸转场。点击穿透不挡内容 */}
          <div
            className="focus-vignette-in pointer-events-none fixed inset-0"
            style={{ zIndex: "var(--z-overlay-scrim)", boxShadow: "inset 0 0 200px 60px rgba(0,0,0,0.55)", background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.28) 100%)" }}
            aria-hidden
          />
          {/* 顶部番茄钟条：从上方 slide-down 就位，像「进入专注舱」的顶栏落定。
              位于暗角(scrim)之上、专注舱层内，用 z-sticky+1 压过页面吸顶栏但不与业务弹窗争层 */}
          <div className="focus-bar-drop fixed inset-x-0 top-0" style={{ zIndex: "calc(var(--z-sticky) + 1)" }}>
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
        <div className="fixed inset-0 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" style={{ zIndex: "var(--z-focus)" }} onClick={() => setFocusStage("idle")}>
          <div
            ref={focusPanelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="focus-review-title"
            className="studio-rise elev-3 w-full max-w-[420px] rounded-[var(--radius-card)] p-6 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--ok-soft)] text-[var(--ok)] shadow-[var(--inner-hi)]">
              <Check size={24} weight="bold" />
            </div>
            <h3 id="focus-review-title" className="mt-3 text-[18px] font-bold text-[var(--ink)]">这次专注结束</h3>
            <p className="mt-1 text-[13px] text-[var(--ink3)]">辛苦了，看看这次的收获</p>
            <div className="mt-4 flex items-center justify-center gap-6">
              <div className="num-pop">
                <div className="mono text-[30px] font-extrabold leading-none text-[var(--red)]"><span className="tabular-nums">{reviewData.minutes}</span></div>
                <div className="mt-1.5 text-[12px] text-[var(--ink3)]">专注分钟</div>
              </div>
              <div className="h-10 w-px bg-[var(--border)]" />
              <div className="num-pop">
                <div className="mono text-[30px] font-extrabold leading-none text-[var(--ink)]"><span className="tabular-nums">{reviewData.noteCount}</span></div>
                <div className="mt-1.5 text-[12px] text-[var(--ink3)]">新增笔记</div>
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

      {/* 下一节卡：学完本节后右下角弹出，3 秒倒计时自动跳，可手动/可关。
          用 z-drawer（低于分享/弹窗），分享面板打开时不会被这张角卡遮住 */}
      {showNextCard && nextHref && (
        <div className="fixed bottom-5 right-5 w-full max-w-[320px] px-4 sm:px-0" style={{ zIndex: "var(--z-drawer)" }}>
          <div className="studio-rise elev-3 overflow-hidden rounded-[var(--radius-card)] p-4">
            <div className="flex items-start justify-between gap-2">
              {/* 完成信号用完课绿，红只留给下方 CTA */}
              <div className="mono inline-flex items-center gap-1.5 rounded-full bg-[var(--ok-soft)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ok)]">
                <Check size={12} weight="bold" /> 本节完成
              </div>
              <button
                onClick={dismissNextCard}
                className="studio-press -mr-1 -mt-1 grid h-6 w-6 place-items-center rounded-full text-[var(--ink4)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--ink2)]"
                title="关闭" aria-label="关闭"
              >
                <X size={14} weight="bold" />
              </button>
            </div>
            <p className="mt-2.5 text-[12px] text-[var(--ink3)]">即将进入下一节</p>
            <p className="mt-0.5 truncate text-[15px] font-bold text-[var(--ink)]" title={nextLessonTitle ?? undefined}>
              {nextLessonTitle ?? "下一节"}
            </p>
            <div className="mt-3.5 flex items-center gap-2">
              <Link
                href={nextHref}
                onClick={() => { saveProgress(); track("next_lesson_advance", { lesson_id: lesson.id, mode: "manual" }); }}
                className="studio-press cta-glow inline-flex flex-1 items-center justify-center gap-1.5 rounded-[12px] bg-[var(--red)] px-4 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-[var(--red-hover)]"
              >
                <Play size={13} weight="fill" /> 立即学下一节
                <span className="mono ml-0.5 tabular-nums opacity-80">{nextCountdown}s</span>
              </Link>
              <button
                onClick={dismissNextCard}
                className="studio-press rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-[13px] font-semibold text-[var(--ink3)] transition-colors hover:text-[var(--ink)]"
              >
                留在本节
              </button>
            </div>
            {/* 底部倒计时进度条，明确剩余自动跳转时间（状态反馈） */}
            <div className="mt-3 h-[3px] w-full overflow-hidden rounded-full bg-[var(--surface-inset)]" aria-hidden>
              <div className="h-full rounded-full bg-[var(--red)] transition-[width] duration-1000 ease-linear" style={{ width: `${(nextCountdown / 3) * 100}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* 面包屑。P1-3：min-w-0 让 truncate 生效，长标题不再撑宽窄屏。 */}
      <div className="focus-hide flex min-w-0 items-center gap-2 text-sm text-[var(--ink3)]">
        <Link href={`/courses/${courseSlug}`} className="min-w-0 shrink truncate transition-colors hover:text-[var(--red)]">{courseTitle}</Link>
        <span className="shrink-0 text-[var(--ink4)]">/</span>
        <span className="min-w-0 shrink truncate font-medium text-[var(--ink)]">{lesson.title}</span>
      </div>

      {!access ? (
        <div className="space-y-6">
          {VideoArea}
          <Paywall
            remainingLessons={remainingLessons}
            courseTitle={courseTitle}
            isLoggedIn={isLoggedIn}
            returnTo={`/courses/${courseSlug}/learn/${lesson.id}?t=${Math.floor(time)}`}
          />
        </div>
      ) : (
        <div className={`grid min-w-0 gap-4 xl:gap-5 ${focus ? "" : "lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]"}`}>
          {/* 左：视频/图文。P1-3：min-w-0 让窄屏单列可收缩到视口宽度，杜绝 390px 下 412 横向溢出。 */}
          <div className={focus ? "mx-auto w-full max-w-4xl" : "min-w-0"}>
            {isHtmlLesson ? (
              // v3.3 多样化 HTML 课件：沙箱 iframe 渲染 AI 生成的自包含高级课件（见 HtmlCourseware / 计划 §7）。
              <HtmlCourseware html={htmlContract!.html as string} />
            ) : isBlockLesson ? (
              // 块课件：左侧内容区渲染块。v3.1 若有视频课件（ready/生成中），先给出「图文 / 视频」切换 Tab。
              <div>
                {(hasVideoCourseware || videoGenerating) && (
                  <div className="mb-3 inline-flex gap-1 rounded-full border border-[var(--border)] bg-[var(--surface2)] p-1">
                    {[
                      { key: "blocks" as const, label: "图文课件", Icon: NotePencil },
                      { key: "video" as const, label: "视频课件", Icon: Play },
                    ].map((t) => {
                      const on = blockView === t.key;
                      return (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => setBlockView(t.key)}
                          className={`inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-semibold transition-colors duration-150 ${
                            on ? "bg-[var(--surface)] text-[var(--ink)] shadow-[var(--card)]" : "text-[var(--ink3)] hover:text-[var(--ink)]"
                          }`}
                        >
                          <t.Icon size={15} weight={on ? "fill" : "regular"} className={`shrink-0 ${t.key === "video" ? "text-[var(--red)]" : ""}`} />
                          <span className="whitespace-nowrap">{t.label}</span>
                          {t.key === "video" && videoGenerating && (
                            <span className="mono rounded-full bg-[var(--red-soft)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--red)]">生成中</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
                {showVideoView ? (
                  videoGenerating ? (
                    <VideoGeneratingPlaceholder />
                  ) : (
                    VideoArea
                  )
                ) : (
                  // 图文课件：翻页（黑板式单屏，默认）/ 滚动（长列表）二选一。
                  // data-ct-theme：按 course.template 给整套块课件换肤（见 globals.css .ct-theme 段）。
                  <div className="ct-theme" data-ct-theme={ctTheme}>
                    {/* 排布切换段控件：翻页 / 滚动。压缩上下留白，把纵向空间让给学习画面。 */}
                    <div className="mb-2 flex items-center justify-end">
                      <div className="inline-flex rounded-[12px] border border-[var(--border)] bg-[var(--surface2)] p-1 text-[13px] font-semibold">
                        <button
                          type="button"
                          onClick={() => setBlockLayout("slides")}
                          aria-pressed={blockLayout === "slides"}
                          className={`studio-press inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-[9px] px-3.5 transition-colors ${
                            blockLayout === "slides"
                              ? "bg-[var(--surface)] text-[var(--ink)] shadow-[var(--card)]"
                              : "text-[var(--ink3)] hover:text-[var(--ink)]"
                          }`}
                        >
                          <Cards size={15} weight={blockLayout === "slides" ? "fill" : "regular"} className="text-[var(--red)]" />
                          翻页
                        </button>
                        <button
                          type="button"
                          onClick={() => setBlockLayout("scroll")}
                          aria-pressed={blockLayout === "scroll"}
                          className={`studio-press inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-[9px] px-3.5 transition-colors ${
                            blockLayout === "scroll"
                              ? "bg-[var(--surface)] text-[var(--ink)] shadow-[var(--card)]"
                              : "text-[var(--ink3)] hover:text-[var(--ink)]"
                          }`}
                        >
                          <ListDashes size={15} />
                          滚动
                        </button>
                      </div>
                    </div>

                    {blockLayout === "slides" ? (
                      // 翻页课件：黑板式单屏，左右翻页 + 页序进度上报 + 末页完课。
                      // initialIndex 用上次读到的页码(1-indexed)-1 恢复续读位置；BlockSlideshow 内部再 clamp。
                      <BlockSlideshow
                        blocks={blocks}
                        courseId={courseId}
                        sceneBg={sceneBgSrc}
                        initialIndex={initialSlidePage > 0 ? initialSlidePage - 1 : 0}
                        onSlideChange={reportBlockPage}
                        onComplete={onBlockComplete}
                        notePanel={canCreateNote ? slideNoteEditor : undefined}
                      />
                    ) : (
                      // 滚动模式：保留原长列表叙事（Reveal 交错浮现）+ 末块进视口完课上报（与翻页完课语义一致）
                      <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card),var(--inner-hi)] sm:p-6">
                        <BlockRenderer blocks={blocks} courseId={courseId} sceneBg={sceneBgSrc} onReachEnd={reportScrollComplete} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : lesson.contentType === "live" ? (
              <LiveBanner lesson={lesson} />
            ) : lesson.contentType === "article" && lesson.articleMd ? (
              <article className="prose-body rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card),var(--inner-hi)] sm:p-8">
                <h2 className="text-2xl font-bold leading-snug tracking-tight text-[var(--ink)]">{lesson.title}</h2>
                <div className="mt-4 whitespace-pre-wrap text-[15px] leading-[1.85] text-[var(--ink2)]">{lesson.articleMd}</div>
              </article>
            ) : VideoArea}

            <div className="mt-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card),var(--inner-hi)]">
              <div className="flex items-center justify-between gap-3">
                <h1 className="text-[19px] font-bold leading-snug tracking-tight text-[var(--ink)]">{lesson.title}</h1>
                {/* 块课无时间轴，不显示基于播放时长的进度；完成度用语义色：满进度转为完课绿 */}
                {!isBlockLesson && (
                  <span
                    key={Math.round(progress * 100)}
                    className={`num-pop mono inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums ${
                      progress >= 0.999
                        ? "bg-[var(--ok-soft)] text-[var(--ok)]"
                        : "bg-[var(--surface-inset)] text-[var(--ink3)]"
                    }`}
                  >
                    {progress >= 0.999 && <Check size={12} weight="bold" />}
                    {progress >= 0.999 ? "已学完" : `已学 ${Math.round(progress * 100)}%`}
                  </span>
                )}
              </div>
              {lesson.summary && <p className="mt-1.5 text-sm leading-relaxed text-[var(--ink3)]">{lesson.summary}</p>}
              {/* 问题⑪：此处原有一条 WaveProgress 进度条，与视频画面内控制条水位进度用同一 progress 值、
                  语义重复。移除该条，保留上方「已学 N%」数字徽章（有信息量，进度条冗余）。 */}
            </div>

            {/* 课程目录（问题⑪备注）：从右栏移到视频/标题下方，便于用户在画面下方滑动选取想看的课节。
                桌面显示于此；移动端沿用下方已有的目录块（避免重复渲染两份）。 */}
            <div className="focus-hide mt-4 hidden lg:block">
              <Outline courseSlug={courseSlug} outline={outline} />
            </div>

            {/* 上一讲/下一讲 */}
            <div className="focus-hide mt-4 flex items-center justify-between gap-3">
              {prevLessonId ? (
                <Link href={`/courses/${courseSlug}/learn/${prevLessonId}`} onClick={() => saveProgress()} className="studio-press group inline-flex items-center gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium text-[var(--ink2)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)]"><CaretLeft size={15} className="transition-transform group-hover:-translate-x-0.5" /> 上一讲</Link>
              ) : <span />}
              {nextLessonId ? (
                <Link href={`/courses/${courseSlug}/learn/${nextLessonId}`} onClick={() => saveProgress()} className="studio-press group inline-flex items-center gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium text-[var(--ink2)] shadow-[var(--card)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)]">下一讲 <CaretRight size={15} className="transition-transform group-hover:translate-x-0.5" /></Link>
              ) : <span className="text-sm text-[var(--ink4)]">已是最后一讲</span>}
            </div>

            {/* 下课复习触点（问题⑧）：把「复习」从独立板块带进学习流——课末若有到期复习卡，
                在此顺手提示，一步进复习室。仅登录且有到期卡时出现，不打扰无卡用户。 */}
            {dueReviewCount > 0 && (
              <Link
                href="/review"
                className="focus-hide studio-press group mt-4 flex items-center gap-3 rounded-[var(--radius-card)] border border-[color-mix(in_srgb,var(--warn)_28%,transparent)] bg-[var(--warn-soft)] px-4 py-3 shadow-[var(--card)] transition-colors"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[color-mix(in_srgb,var(--warn)_18%,transparent)] text-[var(--warn)]">
                  <Cards size={18} weight="fill" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold text-[var(--ink)]">
                    顺手复习 {dueReviewCount} 张到期卡
                  </span>
                  <span className="block text-[12px] text-[var(--ink3)]">趁热复习，记得更牢</span>
                </span>
                <CaretRight size={16} weight="bold" className="shrink-0 text-[var(--ink4)] transition-transform group-hover:translate-x-0.5" />
              </Link>
            )}

            {/* 移动端：打开笔记 Sheet + 目录 */}
            <div className="focus-hide mt-4 lg:hidden">
              <button onClick={() => setSheetOpen(true)} className="studio-press mb-3 inline-flex w-full items-center justify-center gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium text-[var(--ink2)] shadow-[var(--card)] transition-colors hover:text-[var(--ink)]">
                <NotePencil size={15} className="text-[var(--red)]" /> 打开笔记面板
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
                    className={`whitespace-nowrap rounded-[9px] px-4 py-1.5 transition-colors ${panelTab === "notes" ? "bg-[var(--surface)] text-[var(--ink)] shadow-[var(--card)]" : "text-[var(--ink3)] hover:text-[var(--ink)]"}`}
                  >
                    <span className="whitespace-nowrap">笔记</span>
                  </button>
                  <button
                    onClick={() => setPanelTab("companion")}
                    className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[9px] px-4 py-1.5 transition-colors ${panelTab === "companion" ? "bg-[var(--surface)] text-[var(--ink)] shadow-[var(--card)]" : "text-[var(--ink3)] hover:text-[var(--ink)]"}`}
                  >
                    <Sparkle size={13} weight={panelTab === "companion" ? "fill" : "regular"} className="shrink-0 text-[var(--red)]" />
                    <span className="whitespace-nowrap">AI 伴侣</span>
                  </button>
                </div>
                {/* 问题⑪备注：目录已移到左栏视频下方，右栏只留笔记/AI 伴侣；面板高度由固定 540 拉长为
                    随视口自适应（min 520 保证矮屏可用，max 820 防超高屏过长），便于记笔记时有更大输入区。 */}
                <div className="h-[calc(100vh-8.5rem)] min-h-[520px] max-h-[820px] overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card),var(--inner-hi)]">
                  {panelTab === "notes" ? noteEditor : <CompanionPanel lessonId={lesson.id} courseId={courseId} />}
                </div>
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

/**
 * 视频课件生成中占位（v3.1）：块课已切到「视频」Tab 但视频尚未就绪时展示。
 * 深色展示区材质对齐 VideoArea；转圈用 motion-safe，reduce-motion 下 CSS 自动不转（不眩晕）。
 */
function VideoGeneratingPlaceholder() {
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] shadow-[var(--card)]" style={{ background: "var(--video-bg)" }}>
      <div className="relative flex aspect-video items-center justify-center" style={{ background: "var(--ai-grad)" }}>
        <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.7) 1px, transparent 0)", backgroundSize: "22px 22px" }} aria-hidden />
        <div className="relative flex flex-col items-center gap-3 text-center text-white">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-white/10 ring-1 ring-white/15">
            {/* motion-safe 才转；reduce-motion 下静止不眩晕 */}
            <span className="h-7 w-7 rounded-full border-2 border-white/30 border-t-white motion-safe:animate-spin" aria-hidden />
          </span>
          <div>
            <p className="text-[15px] font-semibold text-white">视频课件生成中</p>
            <p className="mt-1 text-[12.5px] text-white/60">AI 正在把这节课件转成带旁白的视频，稍后回来查看</p>
          </div>
        </div>
      </div>
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
  // 挂载后再计算，SSR 首帧统一按「未开始」渲染，避免 hydration mismatch。
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  // 两态语义（无真实直播间 URL 字段，不假装可跳转）：
  //  - upcoming（未到开播点，或时间待定）→ 可「预约席位」，点击后置「已预约席位」。
  //  - live（已到点/开播后）→ 直播进行中，作状态展示而非可点跳转，避免死链假装「进入直播间」。
  // 未挂载时统一按 upcoming 渲染（与 SSR 首帧一致）。
  const live = mounted && !!start && start.getTime() <= Date.now();
  const upcoming = !live;
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] shadow-[var(--card)]">
      {/* 深色直播展示区：渐变材质 + 细点纹理 + 红色 live 信号，非死黑平面 */}
      <div className="relative flex items-center justify-center py-10 sm:py-16" style={{ background: "var(--video-grad)" }}>
        <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.7) 1px, transparent 0)", backgroundSize: "22px 22px" }} aria-hidden />
        <div className="absolute inset-x-0 top-0 h-1/2 opacity-60" style={{ background: "radial-gradient(60% 90% at 50% 0%, rgba(255,255,255,.07), transparent 70%)" }} aria-hidden />
        <div className="relative text-center text-white">
          <span className="mono inline-flex items-center gap-1.5 rounded-full bg-[var(--red)]/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white ring-1 ring-[var(--red)]/30">
            <span className="live-dot h-2 w-2 rounded-full text-[var(--red)]"><span className="relative block h-2 w-2 rounded-full bg-[var(--red)]" /></span>
            LIVE
          </span>
          {/* 对齐内容区展示大标题档（与 article h2 同 24px 尺度），避免 19/24/26 三档标题打架 */}
          <div className="mt-3 text-[24px] font-bold leading-snug tracking-tight">直播小班</div>
          <p className="mono mt-1.5 text-sm text-[var(--ink-on-dark-2)]">真人连麦纠音 · 限额 <span className="tabular-nums text-[var(--ink-on-dark)]">{lesson.liveSeatLimit ?? 20}</span> 人</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--surface)] p-5">
        <div className="min-w-0">
          <p className="font-semibold text-[var(--ink)]">{lesson.title}</p>
          <p className="mt-0.5 text-sm text-[var(--ink3)]">
            {start ? `开播时间：${start.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : "开播时间待定"}
          </p>
        </div>
        {live ? (
          // 直播进行中：无真实直播间 URL 字段可跳转，作状态展示而非可点按钮，
          // 不用「进入直播间」制造死链，也不用「预约」——已开播不能预约。
          <span
            className="inline-flex items-center gap-1.5 rounded-[12px] bg-[var(--red)]/12 px-5 py-2.5 text-sm font-semibold text-[var(--red)] ring-1 ring-[var(--red)]/25"
            role="status"
          >
            <span className="live-dot h-2 w-2 rounded-full text-[var(--red)]"><span className="relative block h-2 w-2 rounded-full bg-[var(--red)]" /></span>
            直播进行中
          </span>
        ) : (
          <button
            onClick={() => { setBooked(true); track("live_class_book", { lesson_id: lesson.id }); }}
            disabled={booked}
            className={`studio-press inline-flex items-center gap-1.5 rounded-[12px] px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 ${
              booked ? "bg-[var(--ok)]" : "cta-glow bg-[var(--red)] hover:bg-[var(--red-hover)]"
            }`}
          >
            {booked ? <><Check size={15} weight="bold" /> 已预约席位</> : "预约席位"}
          </button>
        )}
      </div>
    </div>
  );
}

function Outline({ courseSlug, outline }: { courseSlug: string; outline: OutlineItem[] }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <p className="text-sm font-semibold text-[var(--ink)]">课程目录</p>
        <span className="mono text-[11px] tabular-nums text-[var(--ink4)]">{outline.length} 节</span>
      </div>
      {outline.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-10 text-center">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-[var(--surface-inset)] text-[var(--ink4)]">
            <CaretRight size={18} />
          </div>
          <p className="mt-3 text-sm font-medium text-[var(--ink2)]">目录整理中</p>
          <p className="mt-0.5 text-[12px] text-[var(--ink4)]">章节即将上线</p>
        </div>
      ) : (
        <ul className="stagger max-h-[300px] divide-y divide-[var(--border)] overflow-y-auto">
          {outline.map((o, i) => (
            <li key={o.id} style={{ "--i": Math.min(i, 8) } as React.CSSProperties /* stagger 递延进场 */}>
              <Link
                href={`/courses/${courseSlug}/learn/${o.id}`}
                aria-current={o.current ? "true" : undefined}
                className={`group relative flex min-w-0 items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                  o.current
                    ? "bg-[var(--red-soft)] font-semibold text-[var(--red-ink)]"
                    : "text-[var(--ink2)] hover:bg-[var(--surface2)]"
                }`}
              >
                {/* 当前节：左侧红色游标，明确定位 */}
                {o.current && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-[var(--red)]" aria-hidden />}
                <span className={`mono w-5 shrink-0 text-center text-xs tabular-nums ${o.current ? "text-[var(--red-ink)]" : "text-[var(--ink4)]"}`}>{i + 1}</span>
                {/* P1-3：min-w-0 让 flex-1 truncate 真正生效，长课节标题不撑宽目录/整列。 */}
                <span className="min-w-0 flex-1 truncate">{o.title}</span>
                {o.isFree ? (
                  <span className="mono rounded bg-[var(--ok-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ok)]">免费</span>
                ) : (
                  <LockSimple size={13} className="text-[var(--ink4)]" />
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
