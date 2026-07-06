"use client";

import { useEffect, useReducer } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkle,
  MagicWand,
  CheckCircle,
  BookOpen,
  ArrowRight,
  Waveform,
  PlayCircle,
} from "@phosphor-icons/react/dist/ssr";
import { useStudyRoom } from "./StudyRoomContext";
import { GEN_DEMO_STEPS } from "@/lib/gen-stages";

/* ============================================================
   DeskDemo —— 第一幕「书桌上的屏幕」真实 UI 产品演示
   用产品真实 UI 元素拼装的精致演示循环（替代原视频）：
     ① 造课输入：一句话被「敲」进输入框（打字机）
     ② AI 生成进度：智能面板逐条点亮生成步骤 + 进度条流光
     ③ 课程卡浮现：真实 CourseCard 形态的成品卡从进度中「长出」
   纯 CSS/HTML + framer-motion，响应式各分辨率填满、主题跟随（--scene-*）。

   降级（!motionOk / reduce-motion）：不自动循环、不打字/不流光，
   直接定格在「成品卡浮现」终态（③），静态可读、无频闪，仍是完整产品画面。
   本组件纯 client，不引任何 server 链；数据为演示脚本常量（非真实查询，
   属「产品能力展示」，与全站真实数据分工：真实社会证明在文案区由 server 传入）。
   ============================================================ */

type Phase = "typing" | "generating" | "revealed";

// 演示脚本：一句话 → AI 生成 → 成品课。选 AI 赛道（紫），点题「一句话造课」。
// STEPS 从共享单一事实源取（src/lib/gen-stages 的 GEN_DEMO_STEPS），与真实引擎四站
// （understand→outline→lessons→done）绑定同一序列，改流程只动 gen-stages，杜绝再漂移。
const PROMPT = "帮我做一门给完全零基础的人用 AI 做短视频的课";
const STEPS = GEN_DEMO_STEPS;

interface DemoState {
  phase: Phase;
  typed: number; // 已打出的字符数（typing 阶段）
  step: number; // 已点亮的生成步骤数（generating 阶段）
  cycle: number; // 循环计数，用于 key 重挂动画
}

type Action =
  | { t: "tick-type" }
  | { t: "to-generating" }
  | { t: "tick-step" }
  | { t: "to-revealed" }
  | { t: "restart" };

function reducer(s: DemoState, a: Action): DemoState {
  switch (a.t) {
    case "tick-type":
      return { ...s, typed: Math.min(s.typed + 1, PROMPT.length) };
    case "to-generating":
      return { ...s, phase: "generating", typed: PROMPT.length, step: 0 };
    case "tick-step":
      return { ...s, step: Math.min(s.step + 1, STEPS.length) };
    case "to-revealed":
      return { ...s, phase: "revealed", step: STEPS.length };
    case "restart":
      return { phase: "typing", typed: 0, step: 0, cycle: s.cycle + 1 };
    default:
      return s;
  }
}

const REVEALED_STATE: DemoState = {
  phase: "revealed",
  typed: PROMPT.length,
  step: STEPS.length,
  cycle: 0,
};

export function DeskDemo() {
  const { motionOk } = useStudyRoom();
  // 降级态：直接定格终态，不启定时器。
  const [state, dispatch] = useReducer(reducer, motionOk ? { phase: "typing", typed: 0, step: 0, cycle: 0 } : REVEALED_STATE);

  // 演示循环时间线：仅 motionOk 时运行。用一串 setTimeout 串起分镜，
  // cycle 变化时重建（清理上一轮所有 timer，防泄漏/错帧）。
  useEffect(() => {
    if (!motionOk) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));

    // ① 打字：逐字（约 42ms/字），打完停顿再进入生成
    const perChar = 42;
    for (let i = 1; i <= PROMPT.length; i++) at(i * perChar, () => dispatch({ t: "tick-type" }));
    const typeDone = PROMPT.length * perChar;
    at(typeDone + 520, () => dispatch({ t: "to-generating" }));
    // ② 生成：三步依次点亮（每步 ~640ms）
    const genStart = typeDone + 520 + 260;
    STEPS.forEach((_, i) => at(genStart + i * 640, () => dispatch({ t: "tick-step" })));
    const genDone = genStart + STEPS.length * 640;
    // ③ 成品卡浮现，停留展示后重启
    at(genDone + 340, () => dispatch({ t: "to-revealed" }));
    at(genDone + 340 + 3600, () => dispatch({ t: "restart" }));

    return () => timers.forEach(clearTimeout);
  }, [state.cycle, motionOk]);

  const typedText = PROMPT.slice(0, state.typed);
  const showCaret = motionOk && state.phase === "typing";

  return (
    <div className="relative w-full" aria-hidden>
      {/* —— 显示器外框：立在桌上的一台亮屏。响应式圆角/边框，主题跟随。 —— */}
      <div
        className="relative aspect-[16/10] w-full overflow-hidden rounded-[16px] border lg:rounded-[20px]"
        style={{
          borderColor: "var(--scene-hairline)",
          background: "var(--scene-screen)",
          boxShadow: "var(--scene-card-shadow)",
        }}
      >
        {/* —— 屏内底纹：智性蓝图（细网格 + 中右柔光 + 淡连线），叠在 --scene-screen 之上、
            内容之下，低透明度当氛围底，让它更像一台真在跑 AI 的造课台。亮/暗两版随主题切。 —— */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/marketing/ai-forge-panel-bg.jpg"
          alt=""
          fetchPriority="low"
          decoding="async"
          className="scene-light-only pointer-events-none absolute inset-0 h-full w-full object-cover opacity-70"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/marketing/ai-forge-panel-bg-dark.jpg"
          alt=""
          loading="lazy"
          decoding="async"
          className="scene-dark-only pointer-events-none absolute inset-0 h-full w-full object-cover opacity-80"
        />

        {/* 屏内智能流光（AI 材质活感）；reduce-motion 静止 */}
        <div className="demo-ai-flow pointer-events-none absolute inset-0" />

        {/* 顶栏：像一个产品窗口的标题条（造课工作台） */}
        <div
          className="flex items-center gap-2 border-b px-3.5 py-2.5 lg:px-5 lg:py-3.5"
          style={{ borderColor: "var(--scene-hairline)" }}
        >
          <MagicWand size={15} weight="fill" style={{ color: "var(--red)" }} />
          <span
            className="text-[11px] font-semibold tracking-tight lg:text-[13px]"
            style={{ color: "var(--scene-ink)" }}
          >
            AI 造课工作台
          </span>
          <span className="ml-auto flex gap-1">
            {[0, 1, 2].map((n) => (
              <span
                key={n}
                className="h-1.5 w-1.5 rounded-full lg:h-2 lg:w-2"
                style={{ background: "var(--scene-hairline)" }}
              />
            ))}
          </span>
        </div>

        {/* 屏内工作区 */}
        <div className="relative flex h-[calc(100%-38px)] flex-col gap-2.5 p-3.5 lg:h-[calc(100%-52px)] lg:gap-4 lg:p-5">
          {/* —— ① 输入行：一句话被敲进来 —— */}
          <div
            className="flex items-center gap-2 rounded-[12px] px-3 py-2.5 lg:gap-2.5 lg:px-4 lg:py-3.5"
            style={{
              background: "var(--scene-card-2)",
              border: "1px solid var(--scene-hairline)",
            }}
          >
            <Sparkle
              size={16}
              weight="fill"
              className="shrink-0 lg:hidden"
              style={{ color: "var(--red)" }}
            />
            <Sparkle
              size={19}
              weight="fill"
              className="hidden shrink-0 lg:block"
              style={{ color: "var(--red)" }}
            />
            <p
              className="min-w-0 flex-1 truncate text-[12px] leading-none lg:text-[15px]"
              style={{ color: typedText ? "var(--scene-ink)" : "var(--scene-ink-3)" }}
            >
              {typedText || "说出想学的…"}
              {showCaret && <span className="demo-caret ml-0.5" />}
            </p>
            <span
              className="hidden shrink-0 items-center gap-1 rounded-[9px] px-2.5 py-1.5 text-[11px] font-bold text-white sm:inline-flex lg:px-3.5 lg:py-2 lg:text-[13px]"
              style={{ background: "var(--red)" }}
            >
              造课
              <ArrowRight size={12} weight="bold" />
            </span>
          </div>

          {/* —— ② 生成进度面板 / ③ 成品卡：同一舞台上切换 —— */}
          <div className="relative flex-1 overflow-hidden">
            <AnimatePresence mode="wait">
              {state.phase !== "revealed" ? (
                <motion.div
                  key="gen"
                  className="absolute inset-0 flex flex-col justify-center gap-2 lg:gap-3"
                  initial={motionOk ? { opacity: 0 } : false}
                  animate={{ opacity: 1 }}
                  exit={motionOk ? { opacity: 0, y: -10 } : undefined}
                  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                >
                  {/* 进度条 + 流光（scaleX 合成层动画，不触发布局/重绘） */}
                  <div
                    className="demo-progress-sheen relative h-1.5 w-full overflow-hidden rounded-full lg:h-2"
                    style={{ background: "var(--scene-hairline)" }}
                  >
                    <motion.div
                      className="h-full w-full origin-left rounded-full"
                      style={{ background: "var(--track-ai)" }}
                      initial={false}
                      animate={{
                        scaleX:
                          state.phase === "typing" ? 0.06 : 0.08 + (state.step / STEPS.length) * 0.88,
                      }}
                      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </div>
                  {/* 生成步骤：逐条点亮（√ / spinner） */}
                  <ul className="flex flex-col gap-1.5 lg:gap-2.5">
                    {STEPS.map((label, i) => {
                      const done = i < state.step;
                      const active = i === state.step && state.phase === "generating";
                      return (
                        <li key={label} className="flex items-center gap-2 lg:gap-2.5">
                          {done ? (
                            <CheckCircle
                              size={15}
                              weight="fill"
                              className="shrink-0 lg:hidden"
                              style={{ color: "var(--ok)" }}
                            />
                          ) : (
                            <span
                              className="h-3.5 w-3.5 shrink-0 rounded-full border-2 lg:hidden"
                              style={{
                                borderColor: active ? "var(--red)" : "var(--scene-hairline)",
                                borderTopColor: active ? "transparent" : undefined,
                                animation:
                                  active && motionOk ? "spin 0.7s linear infinite" : undefined,
                              }}
                            />
                          )}
                          {done ? (
                            <CheckCircle
                              size={18}
                              weight="fill"
                              className="hidden shrink-0 lg:block"
                              style={{ color: "var(--ok)" }}
                            />
                          ) : (
                            <span
                              className="hidden h-4 w-4 shrink-0 rounded-full border-2 lg:block"
                              style={{
                                borderColor: active ? "var(--red)" : "var(--scene-hairline)",
                                borderTopColor: active ? "transparent" : undefined,
                                animation:
                                  active && motionOk ? "spin 0.7s linear infinite" : undefined,
                              }}
                            />
                          )}
                          <span
                            className="text-[11px] leading-tight lg:text-[14px]"
                            style={{
                              color: done || active ? "var(--scene-ink-2)" : "var(--scene-ink-3)",
                            }}
                          >
                            {label}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </motion.div>
              ) : (
                /* —— ③ 成品课程卡浮现：真实 CourseCard 形态（封面渐变 + 元信息） —— */
                <motion.div
                  key="card"
                  className="absolute inset-0 flex items-center"
                  initial={motionOk ? { opacity: 0, y: 18, scale: 0.96 } : false}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                >
                  <div
                    className="flex w-full gap-3 overflow-hidden rounded-[14px] p-2.5 lg:gap-4 lg:p-3.5"
                    style={{
                      background: "var(--scene-card)",
                      boxShadow: "var(--scene-card-shadow-sm)",
                      border: "1px solid var(--scene-hairline)",
                    }}
                  >
                    {/* 封面：AI 赛道渐变 + 主题图标（真实课程封面语言） */}
                    <div
                      className="relative flex aspect-[4/3] w-[40%] shrink-0 items-center justify-center overflow-hidden rounded-[10px] lg:rounded-[12px]"
                      style={{ background: "var(--track-ai)" }}
                    >
                      <BookOpen size={26} weight="fill" color="rgba(255,255,255,.9)" className="lg:hidden" />
                      <BookOpen size={38} weight="fill" color="rgba(255,255,255,.9)" className="hidden lg:block" />
                      <span
                        className="absolute left-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white lg:left-2 lg:top-2 lg:text-[10px]"
                        style={{ background: "rgba(0,0,0,.28)" }}
                      >
                        AI 技能
                      </span>
                    </div>
                    {/* 卡信息 */}
                    <div className="flex min-w-0 flex-1 flex-col justify-center">
                      <h4
                        className="line-clamp-2 text-[12px] font-bold leading-snug lg:text-[16px]"
                        style={{ color: "var(--scene-ink)" }}
                      >
                        零基础用 AI 做短视频 · 8 节
                      </h4>
                      <p
                        className="mt-0.5 line-clamp-1 text-[10px] lg:mt-1 lg:text-[12px]"
                        style={{ color: "var(--scene-ink-3)" }}
                      >
                        从选题到成片，一步步跟着做
                      </p>
                      <div
                        className="mt-1.5 flex items-center gap-2.5 text-[9px] lg:mt-2.5 lg:gap-3.5 lg:text-[11px]"
                        style={{ color: "var(--scene-ink-3)" }}
                      >
                        <span className="inline-flex items-center gap-0.5">
                          <PlayCircle size={11} weight="fill" /> 8 节
                        </span>
                        <span className="inline-flex items-center gap-0.5">
                          <Waveform size={11} weight="fill" /> 约 96 分钟
                        </span>
                        <span
                          className="inline-flex items-center gap-0.5 font-semibold"
                          style={{ color: "var(--ok)" }}
                        >
                          <CheckCircle size={11} weight="fill" /> 已生成
                        </span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* 屏面反光高光，让它像「亮着的屏」而非贴图（浅场极淡、暗场更明显靠 scene 变量已足） */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "linear-gradient(160deg, rgba(255,255,255,0.12), transparent 42%)" }}
        />
      </div>

      {/* 屏下桌面：一条暖色台灯反光带，把屏「坐实」在桌面上 */}
      <div
        className="mx-auto mt-2 h-5 w-[86%] rounded-[50%] lg:h-7"
        style={{ background: "radial-gradient(ellipse, rgba(255,200,140,0.16), transparent 70%)" }}
      />
    </div>
  );
}
