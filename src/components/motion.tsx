"use client";

import {
  motion,
  AnimatePresence,
  useMotionValue,
  useSpring,
  useTransform,
  useReducedMotion,
  useInView,
  type Variants,
} from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";

/* ============================================================
   Tide Motion System 2.0 — 涨潮进场 / 退潮离场 / 进度即水位
   全部隔离在 Client Component；仅动 transform/opacity/clip-path。
   动效必须引用 token（时长/缓动/弹簧），禁裸写数值。
   ============================================================ */

// —— Motion Tokens（与 globals.css @theme 对齐）——
export const EASE = [0.16, 1, 0.3, 1] as const;        // ease-out-expo
export const EASE_TIDE = [0.22, 1.2, 0.36, 1] as const; // 涨潮：轻微过冲
export const SPRING_FIRM = { stiffness: 380, damping: 30 } as const;
export const SPRING_TIDE = { stiffness: 170, damping: 22 } as const;
export const SPRING_GENTLE = { stiffness: 90, damping: 18 } as const;

/** 涨潮揭示：上浮 + 轻微放大 + 1% 过冲。全站进场统一用此。 */
export function TidalReveal({
  children,
  delay = 0,
  y = 24,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y, scale: 0.98 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

/** 向后兼容别名。 */
export const Reveal = TidalReveal;

/** 交错编排容器 + 子项（瀑布式揭示）。 */
const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
};

export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      variants={stagger}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-60px" }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={item} className={className}>
      {children}
    </motion.div>
  );
}

/** 指针跟随的高光边框卡片（spotlight）。 */
export function Spotlight({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = ref.current;
    const glow = glowRef.current;
    if (!el || !glow) return;
    if (window.matchMedia("(pointer: coarse)").matches) return; // 触屏禁用高光
    const r = el.getBoundingClientRect();
    // 只改 CSS 变量，避免每帧重算 gradient 字符串触发 paint
    glow.style.setProperty("--mx", `${e.clientX - r.left}px`);
    glow.style.setProperty("--my", `${e.clientY - r.top}px`);
  }

  return (
    <div ref={ref} onMouseMove={onMove} className={`group relative ${className ?? ""}`}>
      <div
        ref={glowRef}
        className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          // 初始 --mx/--my 置于视口外，避免首帧闪烁
          ["--mx" as string]: "-200px",
          ["--my" as string]: "-200px",
          background:
            "radial-gradient(220px circle at var(--mx) var(--my), rgba(252,1,26,0.08), transparent 60%)",
        }}
      />
      {children}
    </div>
  );
}

/** 数字滚动（进入视图时从 0 弹到目标）。 */
export function CountUp({ value, suffix = "", className }: { value: number; suffix?: string; className?: string }) {
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => Math.round(v).toLocaleString());
  return (
    <motion.span
      className={className}
      onViewportEnter={() => {
        const controls = { current: 0 };
        const start = performance.now();
        const dur = 1100;
        const tick = (t: number) => {
          const p = Math.min((t - start) / dur, 1);
          const eased = 1 - Math.pow(1 - p, 3);
          mv.set(value * eased);
          controls.current = eased;
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }}
      viewport={{ once: true }}
    >
      <motion.span>{rounded}</motion.span>
      {suffix}
    </motion.span>
  );
}

/* ============================================================
   Tide Motion 2.0 新原语
   ============================================================ */

/** 点击水波纹：在按压点扩散一圈。包裹任意可点击元素。 */
export function Ripple({ children, className, color = "rgba(252,1,26,0.35)" }: { children: ReactNode; className?: string; color?: string }) {
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const idRef = useRef(0);
  function onDown(e: React.PointerEvent<HTMLSpanElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const id = idRef.current++;
    setRipples((rs) => [...rs, { id, x: e.clientX - r.left, y: e.clientY - r.top }]);
    setTimeout(() => setRipples((rs) => rs.filter((x) => x.id !== id)), 520);
  }
  return (
    <span onPointerDown={onDown} className={`relative inline-flex overflow-hidden ${className ?? ""}`}>
      {children}
      {ripples.map((r) => (
        <span
          key={r.id}
          className="pointer-events-none absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: r.x, top: r.y, background: color, animation: "ripple 0.5s var(--ease-out-expo) forwards" }}
        />
      ))}
    </span>
  );
}

/** 水位波形进度：SVG 波浪填充，波幅随进度衰减（快完成时水面渐平）。 */
export function WaveProgress({ value, height = 8, className }: { value: number; height?: number; className?: string }) {
  const clamped = Math.max(0, Math.min(1, value));
  const amp = 2 + (1 - clamped) * 3; // 波幅：进度越高越平（静态波形，不再逐帧改 path）
  // 两段等宽波形拼接，配合 wave-x 关键帧 translateX(-50%) 实现无缝漂移
  const wavePath = `M0,12 Q6,${12 - amp} 12,12 T24,12 T36,12 T48,12 V24 H0 Z`;
  return (
    <div className={`relative overflow-hidden rounded-full bg-ink-100 ${className ?? ""}`} style={{ height }} role="progressbar" aria-valuenow={Math.round(clamped * 100)} aria-valuemin={0} aria-valuemax={100}>
      {/* 进度填充层：scaleX 走合成层，不触发重排。transformOrigin:left 从左生长 */}
      <motion.div
        className="absolute inset-y-0 left-0 w-full origin-left bg-accent-600/85"
        style={{ transformOrigin: "left", willChange: "transform" }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: clamped }}
        transition={{ ...SPRING_GENTLE, type: "spring" }}
      />
      {/* 波形层：与填充层分离，避免被 scaleX 横向拉伸。CSS translateX 漂移 */}
      <motion.div
        className="pointer-events-none absolute inset-y-0 left-0 w-full origin-left overflow-hidden"
        style={{ transformOrigin: "left" }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: clamped }}
        transition={{ ...SPRING_GENTLE, type: "spring" }}
      >
        <svg
          className="absolute right-0 top-0 h-full text-accent-600/85"
          width="48"
          viewBox="0 0 24 24"
          preserveAspectRatio="none"
          aria-hidden
          style={{ animation: "wave-x 2.2s linear infinite", willChange: "transform" }}
        >
          <path d={wavePath} fill="currentColor" />
        </svg>
      </motion.div>
    </div>
  );
}

/** 数字翻牌：值变化时旧数字上移退出、新数字下方涌入。 */
export function FlipCounter({ value, className }: { value: number; className?: string }) {
  return (
    <span className={`relative inline-flex overflow-hidden ${className ?? ""}`} style={{ minWidth: "1ch" }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={{ y: "0.9em", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "-0.9em", opacity: 0 }}
          transition={{ ...SPRING_FIRM, type: "spring" }}
          className="num"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** 磁吸按钮：向光标轻微牵引（触屏禁用）。 */
export function Magnetic({ children, strength = 0.3, className }: { children: ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { ...SPRING_TIDE, mass: 0.4 });
  const sy = useSpring(y, { ...SPRING_TIDE, mass: 0.4 });

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(pointer: coarse)").matches) return; // 触屏禁用
    const r = el.getBoundingClientRect();
    // 超大屏减弱牵引
    const s = window.innerWidth >= 1920 ? strength * 0.5 : strength;
    x.set((e.clientX - (r.left + r.width / 2)) * s);
    y.set((e.clientY - (r.top + r.height / 2)) * s);
  }
  function reset() { x.set(0); y.set(0); }

  return (
    <motion.div ref={ref} onMouseMove={onMove} onMouseLeave={reset} style={{ x: sx, y: sy }} className={`hover-only ${className ?? ""}`}>
      {children}
    </motion.div>
  );
}

/** 可拖拽 bottom sheet（移动端笔记面板 / Paywall），三档 snap + 甩出关闭。 */
export function SheetDrag({
  children, open, onClose, className,
}: { children: ReactNode; open: boolean; onClose: () => void; className?: string }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 bg-ink-950/40"
            style={{ zIndex: "var(--z-overlay-scrim)" }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.24 }}
            onClick={onClose}
          />
          <motion.div
            className={`fixed inset-x-0 bottom-0 rounded-t-3xl bg-paper-raised shadow-2xl ${className ?? ""}`}
            style={{ zIndex: "var(--z-drawer)" }}
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
            transition={{ ...SPRING_TIDE, type: "spring" }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.05, bottom: 0.6 }}
            onDragEnd={(_, info) => { if (info.offset.y > 120 || info.velocity.y > 500) onClose(); }}
          >
            <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-ink-200" />
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/** 路由/内容转场包裹：涨潮进 / 退潮出。 */
export function PageTide({ children, keyId }: { children: ReactNode; keyId: string }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={keyId}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0.6, y: -8 }}
        transition={{ duration: 0.42, ease: EASE }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/* ============================================================
   §签名时刻 —— 全站「场景编排」的可复用原语
   自习室隐喻的动效化：从暗到亮的「点亮」是全站唯一记忆语言。
   三个原语覆盖 5 个签名时刻里「需要跨组件复用」的部分：
     · LightUp / useLightUp —— 「点亮」（第二幕物件 + 推门文案，moment 2/5 同族）
     · DoorOpen             —— 「推门进场」一次性开场序列（moment 5）
     · ArchiveStamp         —— 「结算归档」盖章入册（moment 3）
   全部 transform/opacity/filter 合成友好、一次性播放不常驻、reduce-motion 终态。
   ============================================================ */

/** 「点亮」曲线：从暗（.35 不透明 / 下沉）到亮落定。
    性能：只动 opacity/transform（合成层）。原版还动 filter:brightness，
    大面积卡片逐帧重绘是全局掉帧主因，已移除（视觉上由 opacity 承担明暗）。
    返回新数组（非 readonly），供 framer animate 目标可变类型消费。 */
function lightUpKeyframes() {
  return {
    opacity: [0.35, 1, 1],
    y: [10, 0, 0],
  };
}
export const LIGHTUP_TIMES = [0, 0.6, 1];

/**
 * useLightUp —— 「点亮」编排 hook。
 * 返回一个 ref 与 framer 的 animate 目标：元素进入视图（或 active=true）时，
 * 从暗到亮点亮一次。reduce-motion 直接返回终态（亮），不播放。
 *
 * 用法：
 *   const { ref, animate, initial, transition } = useLightUp();
 *   <motion.div ref={ref} initial={initial} animate={animate} transition={transition}>
 *
 * @param active 受控点亮（如滚动进度驱动）。传 undefined 则用视口进入自动触发。
 */
export function useLightUp(active?: boolean) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const lit = active ?? inView;

  const initial = reduce
    ? { opacity: 1, y: 0 }
    : { opacity: 0.35, y: 10 };

  const animate = reduce
    ? { opacity: 1, y: 0 }
    : lit
    ? lightUpKeyframes()
    : initial;

  const transition = reduce
    ? { duration: 0 }
    : { duration: 0.62, ease: EASE, times: [...LIGHTUP_TIMES] };

  return { ref, initial, animate, transition, lit, reduce };
}

/**
 * LightUp —— 「点亮」组件（声明式）。包裹任意内容，进入视图时从暗到亮点亮一次，
 * 顶角浮起一圈可选暖光晕（signature Light-Up 的「微光扩散」）。
 * 第二幕物件、书桌今日卡、推门文案共用此语言，强化设计一致性。
 *
 * @param glow    是否渲染点亮时的暖光晕扩散（默认 true）。
 * @param glowColor 光晕颜色（默认专注红的柔光；可传 --info/--warn 等赛道色）。
 * @param active  受控点亮；不传则视口进入自动触发。
 * @param delay   点亮延迟（编排多个物件依次点亮时用）。
 */
export function LightUp({
  children,
  className,
  glow = true,
  glowColor = "rgba(252,1,26,0.16)",
  active,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  glow?: boolean;
  glowColor?: string;
  active?: boolean;
  delay?: number;
}) {
  const { ref, initial, animate, transition, lit, reduce } = useLightUp(active);
  return (
    <motion.div
      ref={ref}
      className={`relative ${className ?? ""}`}
      initial={initial}
      animate={animate}
      transition={{ ...transition, delay: reduce ? 0 : delay }}
    >
      {glow && !reduce && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute -left-6 -top-8 h-28 w-32 rounded-full blur-2xl"
          style={{ background: `radial-gradient(circle, ${glowColor}, transparent 68%)` }}
          initial={{ opacity: 0 }}
          animate={{ opacity: lit ? [0, 1, 0.7] : 0 }}
          transition={{ duration: 0.7, ease: EASE, delay }}
        />
      )}
      {children}
    </motion.div>
  );
}

/**
 * DoorOpen —— 「推门进场」一次性开场编排（moment 5）。
 * 首屏挂载时播放一次：暗场（微缩 + 透明）→ 推开 → 亮场落定。
 * 性能：只动 opacity/transform；「从暗到亮」由整场 opacity 表达，不再动
 * filter:brightness（首屏整幕逐帧重绘会吃掉开场帧率）。
 * reduce-motion：直接终态（亮场、无位移），不播放开门。
 *
 * @param children 场景内容（第一幕整场）。
 */
export function DoorOpen({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={`relative ${className ?? ""}`}
      initial={reduce ? false : { opacity: 0, scale: 1.03 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={reduce ? { duration: 0 } : { duration: 1.0, ease: EASE }}
    >
      {/* 开门光缝：一道从中缝向两侧推开的暖光，只在开场播一次（reduce 不渲染） */}
      {!reduce && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[2]"
          style={{
            background:
              "linear-gradient(90deg, transparent 48%, rgba(255,214,150,0.28) 50%, transparent 52%)",
          }}
          initial={{ opacity: 0, scaleX: 0.2 }}
          animate={{ opacity: [0, 0.9, 0], scaleX: [0.2, 1, 1.2] }}
          transition={{ duration: 0.9, ease: EASE, delay: 0.1 }}
        />
      )}
      {children}
    </motion.div>
  );
}

/**
 * ArchiveStamp —— 「结算归档」盖章入册（moment 3）。
 * 完课/复习结算时，一枚印章从上方带旋转「盖」下、轻微回弹落定，像把这一轮归档入册。
 * 一次性播放（active 触发一次）；reduce-motion 直接显示终态印章（无位移、无旋转）。
 * 纯装饰包裹，不改任何结算逻辑。
 *
 * @param active 触发盖章（结算态挂载时置 true）。
 * @param label  印章文字（如「已归档」「本轮完成」）。
 */
export function ArchiveStamp({
  active,
  label,
  className,
}: {
  active: boolean;
  label: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (!active) return null;
  return (
    <motion.span
      className={`archive-stamp inline-flex select-none items-center gap-1 rounded-[8px] border-2 border-[var(--red)] px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-[var(--red)] ${className ?? ""}`}
      initial={
        reduce
          ? { opacity: 1, scale: 1, rotate: -8 }
          : { opacity: 0, scale: 1.8, rotate: -22, y: -16 }
      }
      animate={{ opacity: 1, scale: 1, rotate: -8, y: 0 }}
      transition={
        reduce
          ? { duration: 0 }
          : { type: "spring", stiffness: 520, damping: 16, mass: 0.7, delay: 0.15 }
      }
      style={{ willChange: reduce ? undefined : "transform, opacity", transformOrigin: "center" }}
      aria-hidden
    >
      {label}
    </motion.span>
  );
}
