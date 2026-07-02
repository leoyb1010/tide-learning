"use client";

import { motion, useMotionValue, useSpring, useTransform, type Variants } from "framer-motion";
import { useRef, type ReactNode } from "react";

/* ============================================================
   Motion 原语 — taste-skill MOTION_INTENSITY 6
   全部隔离在 Client Component；仅动 transform/opacity。
   ============================================================ */

const EASE = [0.16, 1, 0.3, 1] as const;

/** 滚动进入时的上浮揭示（单元素）。 */
export function Reveal({
  children,
  delay = 0,
  y = 16,
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
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

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

/** 磁吸按钮：向光标轻微牵引（motion value，不触发 re-render）。 */
export function Magnetic({ children, strength = 0.35, className }: { children: ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 220, damping: 18, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 220, damping: 18, mass: 0.4 });

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  }
  function reset() {
    x.set(0);
    y.set(0);
  }

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={reset}
      style={{ x: sx, y: sy }}
      className={className}
    >
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
    ([x, y]) => `radial-gradient(220px circle at ${x}px ${y}px, rgba(31,107,96,0.10), transparent 60%)`,
  );

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
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
