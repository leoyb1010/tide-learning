"use client";

import { motion, AnimatePresence, useMotionValue, useSpring, useTransform, type Variants } from "framer-motion";
import { useRef, useState, type ReactNode } from "react";

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
      transition={{ duration: 0.7, ease: EASE_TIDE, delay }}
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
  const mx = useMotionValue(-200);
  const my = useMotionValue(-200);
  const bg = useTransform(
    [mx, my],
    ([x, y]) => `radial-gradient(220px circle at ${x}px ${y}px, rgba(252,1,26,0.08), transparent 60%)`,
  );

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(pointer: coarse)").matches) return; // 触屏禁用高光
    const r = el.getBoundingClientRect();
    mx.set(e.clientX - r.left);
    my.set(e.clientY - r.top);
  }

  return (
    <div ref={ref} onMouseMove={onMove} className={`group relative ${className ?? ""}`}>
      <motion.div style={{ background: bg }} className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
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
  const amp = 2 + (1 - clamped) * 3; // 波幅：进度越高越平
  return (
    <div className={`relative overflow-hidden rounded-full bg-ink-100 ${className ?? ""}`} style={{ height }} role="progressbar" aria-valuenow={Math.round(clamped * 100)} aria-valuemin={0} aria-valuemax={100}>
      <motion.div
        className="absolute inset-y-0 left-0 bg-accent-600/85"
        initial={{ width: 0 }}
        animate={{ width: `${clamped * 100}%` }}
        transition={{ ...SPRING_GENTLE, type: "spring" }}
      >
        <svg className="absolute right-0 top-0 h-full" width="24" viewBox="0 0 24 24" preserveAspectRatio="none" aria-hidden>
          <path d={`M0,12 Q6,${12 - amp} 12,12 T24,12 V24 H0 Z`} fill="currentColor" className="text-accent-600/85">
            <animate attributeName="d" dur="2.2s" repeatCount="indefinite"
              values={`M0,12 Q6,${12 - amp} 12,12 T24,12 V24 H0 Z;M0,12 Q6,${12 + amp} 12,12 T24,12 V24 H0 Z;M0,12 Q6,${12 - amp} 12,12 T24,12 V24 H0 Z`} />
          </path>
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
            className="fixed inset-0 z-40 bg-ink-950/40"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.24 }}
            onClick={onClose}
          />
          <motion.div
            className={`fixed inset-x-0 bottom-0 z-50 rounded-t-3xl bg-paper-raised shadow-2xl ${className ?? ""}`}
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
        transition={{ duration: 0.42, ease: EASE_TIDE }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
