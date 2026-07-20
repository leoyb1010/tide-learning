"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Brain,
  TreeStructure,
  PencilLine,
  BookBookmark,
  Article,
  Question,
  Cards,
  CheckCircle,
  Sparkle,
  Check,
  XCircle,
} from "@phosphor-icons/react";
import { GEN_STATIONS } from "@/lib/gen-stages";

/* ============================================================
   GenStage —— AI 生产线舞台（造课 / 导入「生成中」的酷炫可视化）
   ------------------------------------------------------------
   深色蓝图舞台（--ai-grad + 静态网格/辉光）上，一条四站生产线：
     理解 → 大纲 → 逐节写作 → 装订成册
   轨道随真实进度生长（写作段 = done/total 连续填充）；
   每节课是一张「生产位」卡：writing 激光扫描 + 标题打字机，
   done 瞬间弹出三枚产物徽标（讲义/测验/复习卡），failed 琥珀待重试；
   底部分节进度格，当前格流光。即时剧场（前端状态机）与恢复剧场
   （3s 轮询）共用本组件，数据源不同、舞台一致。
   性能：动画全部 transform/opacity（见 globals.css §GenStage），
   网格/辉光为静态背景零逐帧成本；reduce-motion 全量降级静态。
   ============================================================ */

export type GenStageLessonState = "pending" | "writing" | "done" | "failed";

export interface GenStageLesson {
  id: string;
  title: string;
  state: GenStageLessonState;
}

// 站名从共享单一事实源取（src/lib/gen-stages），避免与首页演示卡文案漂移。
const STATIONS_GENERATE = GEN_STATIONS.generate;
const STATIONS_IMPORT = GEN_STATIONS.import;
const STATION_ICONS = [Brain, TreeStructure, PencilLine, BookBookmark] as const;

/** 深色舞台上的行底/描边（统一常量，避免四处硬编码） */
const ROW_BG = "rgba(255,255,255,.045)";
const ROW_BORDER = "rgba(255,255,255,.09)";

export function GenStage({
  source,
  stationIndex,
  lessons,
  writingLessonId,
  caption,
  headerRight,
}: {
  source: "generate" | "import";
  /** 当前站：1 理解 / 2 大纲 / 3 逐节写作 / 4 已装订（全部完成） */
  stationIndex: 1 | 2 | 3 | 4;
  /** 大纲未回来前传 []（渲染蓝图骨架 + 思考核） */
  lessons: GenStageLesson[];
  /** 正在生产的节 id（打字机 + 激光扫描定位） */
  writingLessonId: string | null;
  /** 舞台底部说明句（如「课已放入书架，关闭页面也会继续生成」） */
  caption?: ReactNode;
  /** 顶栏右侧插槽（如「转入后台」按钮） */
  headerRight?: ReactNode;
}) {
  const stations = source === "import" ? STATIONS_IMPORT : STATIONS_GENERATE;
  const total = lessons.length;
  const doneCount = lessons.filter((l) => l.state === "done").length;
  const failedCount = lessons.filter((l) => l.state === "failed").length;
  const settled = doneCount + failedCount;
  const lessonProgress = total > 0 ? settled / total : 0;

  return (
    <div
      className="gen-stage overflow-hidden rounded-[18px] border p-4 sm:p-5"
      style={{ borderColor: "var(--hairline-on-dark)" }}
    >
      {/* —— 顶栏：光核 + 生产线标语 + 右侧插槽 —— */}
      <div className="flex items-center gap-3">
        <span
          className="ai-core relative grid h-9 w-9 shrink-0 place-items-center rounded-full"
          style={{ background: "rgba(255,255,255,.06)", border: "1px solid var(--hairline-on-dark)" }}
          aria-hidden="true"
        >
          <Sparkle size={16} weight="fill" className="ai-core-spark text-white" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="mono text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: "rgba(255,255,255,.55)" }}>
            AI PRODUCTION LINE
          </p>
          <p className="truncate text-[14px] font-bold" style={{ color: "var(--ink-on-dark)" }}>
            {stationIndex >= 4
              ? "已装订成册"
              : source === "import"
              ? "你的资料正在生产线上升维"
              : "你的课正在生产线上成形"}
          </p>
        </div>
        {headerRight}
      </div>

      {/* —— 四站轨道：圆环站点 + 段间轨道线（写作段随真实进度连续生长） —— */}
      <div className="mt-4 flex items-start">
        {stations.map((label, i) => {
          const order = i + 1;
          const state: "done" | "active" | "todo" =
            stationIndex > order ? "done" : stationIndex === order ? "active" : "todo";
          const Icon = STATION_ICONS[i];
          // 段 i（本站 → 下一站）的填充：走过为 1；写作段（3→4）按已完节数连续生长。
          const segFill =
            order === 3
              ? stationIndex > 3
                ? 1
                : stationIndex === 3
                ? lessonProgress
                : 0
              : stationIndex > order
              ? 1
              : 0;
          return (
            <div key={label} className={`flex ${order < stations.length ? "flex-1" : ""} items-start`}>
              <div className="flex w-[52px] shrink-0 flex-col items-center gap-1.5 sm:w-[64px]">
                <span
                  className={`grid h-8 w-8 place-items-center rounded-full border-2 transition-colors duration-300 sm:h-9 sm:w-9 ${
                    state === "active" ? "gen-station-active" : ""
                  }`}
                  style={{
                    borderColor:
                      state === "todo" ? "rgba(255,255,255,.16)" : "var(--red)",
                    background: state === "done" ? "var(--red)" : "rgba(255,255,255,.04)",
                    color: state === "done" ? "#fff" : state === "active" ? "var(--red)" : "rgba(255,255,255,.35)",
                  }}
                >
                  {state === "done" ? <Check size={14} weight="bold" /> : <Icon size={15} weight="fill" />}
                </span>
                <span
                  className="mono text-center text-[9px] leading-tight tracking-[0.02em] sm:text-[10px]"
                  style={{ color: state === "todo" ? "rgba(255,255,255,.35)" : "var(--ink-on-dark-2)" }}
                >
                  {label}
                </span>
              </div>
              {order < stations.length && (
                <div className="relative mt-[15px] h-[2px] flex-1 overflow-hidden rounded-full sm:mt-[17px]" style={{ background: "rgba(255,255,255,.12)" }}>
                  <div
                    className="gen-rail-fill absolute inset-0 rounded-full"
                    style={{
                      background: "linear-gradient(90deg, var(--red), #7b5cf0)",
                      transform: `scaleX(${segFill})`,
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* —— 生产位：节卡列表 / 蓝图骨架 —— */}
      <div className="mt-4">
        {total === 0 ? (
          <BlueprintSkeleton source={source} stationIndex={stationIndex} />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {lessons.map((l, i) => (
              <LessonRow key={l.id} lesson={l} index={i} isWriting={l.id === writingLessonId && l.state === "writing"} />
            ))}
          </ul>
        )}
      </div>

      {/* —— 分节进度格 + 计数（有大纲后显示） —— */}
      {total > 0 && (
        <div className="mt-3.5">
          <div className="flex items-center gap-[3px]">
            {lessons.map((l) => (
              <span
                key={l.id}
                className={`gen-seg h-[5px] flex-1 rounded-full transition-colors duration-300 ${
                  l.state === "writing" ? "gen-seg-active" : ""
                }`}
                style={{
                  background:
                    l.state === "done"
                      ? "var(--red)"
                      : l.state === "failed"
                      ? "var(--warn)"
                      : l.state === "writing"
                      ? "rgba(252,1,26,.35)"
                      : "rgba(255,255,255,.12)",
                }}
              />
            ))}
            <span key={settled} className="num-pop mono ml-2 shrink-0 text-[11px] font-bold" style={{ color: "var(--ink-on-dark)" }}>
              {settled}
              <span style={{ color: "var(--ink-on-dark-3)" }}>/{total}</span>
            </span>
          </div>
          {caption && (
            <p className="mt-2.5 text-[12px]" style={{ color: "var(--ink-on-dark-3)" }}>
              {caption}
            </p>
          )}
        </div>
      )}
      {total === 0 && caption && (
        <p className="mt-3 text-[12px]" style={{ color: "var(--ink-on-dark-3)" }}>
          {caption}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------
   LessonRow —— 单个生产位
   writing：激光扫描 + 红标「生产中」+ 标题打字机；
   done：绿✓ + 三枚产物徽标（讲义/测验/复习卡）逐个弹入；
   failed：琥珀 ✗ + 待重试；pending：暗色序号位。
   ------------------------------------------------------------ */
function LessonRow({
  lesson,
  index,
  isWriting,
}: {
  lesson: GenStageLesson;
  index: number;
  isWriting: boolean;
}) {
  const { state } = lesson;
  return (
    <li
      className={`gen-row-in flex items-center gap-2.5 rounded-[12px] border px-3 py-2 ${
        isWriting ? "gen-writing-row" : ""
      }`}
      style={
        {
          "--i": Math.min(index, 8),
          borderColor: isWriting ? "rgba(252,1,26,.4)" : ROW_BORDER,
          background: isWriting ? "rgba(252,1,26,.07)" : ROW_BG,
        } as CSSProperties
      }
    >
      {state === "done" ? (
        <CheckCircle key="done" size={17} weight="fill" className="num-pop shrink-0" style={{ color: "var(--ok)" }} />
      ) : state === "failed" ? (
        <XCircle size={17} weight="fill" className="shrink-0" style={{ color: "var(--warn)" }} />
      ) : isWriting ? (
        <span
          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-t-transparent"
          style={{ borderColor: "var(--red)", borderTopColor: "transparent" }}
        />
      ) : (
        <span
          className="mono flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold"
          style={{ borderColor: "rgba(255,255,255,.2)", color: "rgba(255,255,255,.4)" }}
        >
          {index + 1}
        </span>
      )}

      <span className="min-w-0 flex-1 text-[13px]">
        {isWriting ? (
          <TypewriterText key={`tw-${lesson.id}`} text={lesson.title} className="font-semibold" style={{ color: "var(--ink-on-dark)" }} />
        ) : (
          <span
            className="block truncate"
            style={{
              color:
                state === "done"
                  ? "var(--ink-on-dark)"
                  : state === "failed"
                  ? "var(--ink-on-dark-2)"
                  : "rgba(255,255,255,.42)",
              fontWeight: state === "done" ? 500 : 400,
            }}
          >
            {lesson.title || `第 ${index + 1} 节`}
          </span>
        )}
      </span>

      {/* 产物徽标：done 瞬间逐个弹入 —— 这节的讲义/测验/复习卡已下线入库 */}
      {state === "done" && (
        <span className="flex shrink-0 items-center gap-1.5" aria-hidden="true">
          {[Article, Question, Cards].map((Icon, i) => (
            <span
              key={i}
              className="gen-artifact grid h-[19px] w-[19px] place-items-center rounded-[6px]"
              style={{ "--i": i, background: "rgba(255,255,255,.08)", color: "var(--ink-on-dark-2)" } as CSSProperties}
            >
              <Icon size={11} weight="fill" />
            </span>
          ))}
        </span>
      )}
      {state === "failed" && (
        <span
          className="mono shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
          style={{ borderColor: "rgba(216,162,74,.4)", background: "rgba(216,162,74,.12)", color: "var(--warn)" }}
        >
          待重试
        </span>
      )}
      {isWriting && (
        <span className="mono shrink-0 text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: "var(--red)" }}>
          生产中
        </span>
      )}
    </li>
  );
}

/* ------------------------------------------------------------
   BlueprintSkeleton —— 大纲未回来前的蓝图骨架
   思考文案 + 三点思考波 + 四条扫光占位（深色版），
   像生产线正在打印蓝图。
   ------------------------------------------------------------ */
function BlueprintSkeleton({ source, stationIndex }: { source: "generate" | "import"; stationIndex: number }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: "var(--ink-on-dark)" }}>
        {stationIndex === 1
          ? source === "import"
            ? "正在通读你的资料"
            : "正在读懂你的需求"
          : source === "import"
          ? "正在按主题拆分章节"
          : "正在设计课程大纲"}
        <span className="inline-flex items-end gap-[3px] pb-[2px]" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="ai-think-dot inline-block h-[3px] w-[3px] rounded-full"
              style={{ "--i": i, background: "var(--red)" } as CSSProperties}
            />
          ))}
        </span>
      </p>
      <ul className="mt-3 flex flex-col gap-1.5" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <li
            key={i}
            className="ai-scan flex items-center gap-2.5 rounded-[12px] border px-3 py-2.5"
            style={{ borderColor: ROW_BORDER, background: ROW_BG }}
          >
            <span className="h-[15px] w-[15px] shrink-0 rounded-full" style={{ background: "rgba(255,255,255,.1)" }} />
            <span className="h-2.5 rounded-full" style={{ width: `${72 - i * 12}%`, background: "rgba(255,255,255,.1)" }} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ============================================================
   TypewriterText —— 造课打字机（节标题逐字浮现 + 光标闪烁）
   从 CreateStudio 抽出共享：即时剧场 / 恢复剧场 / 生产位共用。
   text 变化（切到下一节）即从头重打；reduce-motion 直出全文。
   ============================================================ */
export function TypewriterText({
  text,
  speed = 45,
  className,
  style,
}: {
  text: string;
  speed?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const [shown, setShown] = useState("");
  const reduceRef = useRef(false);

  useEffect(() => {
    reduceRef.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceRef.current || !text) {
      setShown(text);
      return;
    }

    setShown("");
    let i = 0;
    // 以码点为单位推进，避免把中文/emoji 拆坏。
    const chars = Array.from(text);
    const timer = window.setInterval(() => {
      i += 1;
      setShown(chars.slice(0, i).join(""));
      if (i >= chars.length) window.clearInterval(timer);
    }, speed);
    return () => window.clearInterval(timer);
  }, [text, speed]);

  const typing = !reduceRef.current && shown.length < Array.from(text).length;

  return (
    <span className={className ?? "font-semibold text-[var(--ink)]"} style={style}>
      {shown}
      <span className="tw-caret" data-typing={typing} aria-hidden="true" />
    </span>
  );
}
