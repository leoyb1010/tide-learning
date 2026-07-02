"use client";

import { motion } from "framer-motion";

/**
 * 潮汐主题空态插画库（B4）。纯 SVG，入场时波形 path 生长。
 * variant 对应不同空态场景。
 */
type Variant = "notes" | "courses" | "demands" | "search" | "offline" | "notfound";

const TITLES: Record<Variant, string> = {
  notes: "还没有笔记",
  courses: "还没有课程",
  demands: "还没有需求",
  search: "没有找到结果",
  offline: "网络离线了",
  notfound: "页面走丢了",
};

export function TideIllustration({ variant, size = 120 }: { variant: Variant; size?: number }) {
  return (
    <svg width={size} height={size * 0.8} viewBox="0 0 160 128" fill="none" role="img" aria-label={TITLES[variant]}>
      {/* 远景滩涂 */}
      <ellipse cx="80" cy="112" rx="66" ry="8" className="fill-ink-100" />
      {/* 潮汐水面：两道波形，path 生长入场 */}
      <motion.path
        d="M8 78 Q30 68 52 78 T96 78 T140 78"
        className="stroke-accent-200" strokeWidth="2.5" fill="none" strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
      />
      <motion.path
        d="M18 90 Q40 82 62 90 T106 90 T150 90"
        className="stroke-accent-400/60" strokeWidth="2" fill="none" strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.1, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
      />
      {/* 场景符号 */}
      <VariantGlyph variant={variant} />
    </svg>
  );
}

function VariantGlyph({ variant }: { variant: Variant }) {
  const common = "stroke-ink-300";
  switch (variant) {
    case "notes":
      return (
        <g className={common} strokeWidth="2.5" fill="none" strokeLinecap="round">
          <rect x="60" y="30" width="40" height="34" rx="6" />
          <path d="M68 42h24M68 50h16" />
        </g>
      );
    case "courses":
      return (
        <g className={common} strokeWidth="2.5" fill="none" strokeLinecap="round">
          <rect x="58" y="32" width="44" height="30" rx="5" />
          <path d="M76 40l12 7-12 7z" className="fill-accent-200 stroke-accent-200" />
        </g>
      );
    case "demands":
      return (
        <g className={common} strokeWidth="2.5" fill="none" strokeLinecap="round">
          <path d="M80 30l6 12 13 2-9 9 2 13-12-6-12 6 2-13-9-9 13-2z" className="stroke-accent-300" />
        </g>
      );
    case "search":
      return (
        <g className={common} strokeWidth="2.5" fill="none" strokeLinecap="round">
          <circle cx="76" cy="44" r="13" />
          <path d="M86 54l9 9" />
        </g>
      );
    case "offline":
      return (
        <g className={common} strokeWidth="2.5" fill="none" strokeLinecap="round">
          <path d="M62 46a26 26 0 0136 0M70 54a15 15 0 0120 0" />
          <circle cx="80" cy="62" r="1.5" className="fill-ink-300" />
          <path d="M58 30l44 40" className="stroke-accent-400" />
        </g>
      );
    case "notfound":
      return (
        <g className={common} strokeWidth="2.5" fill="none" strokeLinecap="round">
          <circle cx="80" cy="44" r="18" />
          <path d="M74 40a6 6 0 018 0c0 4-6 4-6 8M80 58v.5" />
        </g>
      );
  }
}

/** 完整空态卡片（插画 + 标题 + 描述 + 可选 CTA）。 */
export function EmptyTide({
  variant, description, action,
}: { variant: Variant; description?: string; action?: React.ReactNode }) {
  return (
    <motion.div
      className="flex flex-col items-center justify-center py-14 text-center"
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
    >
      <TideIllustration variant={variant} />
      <p className="mt-4 text-base font-medium text-ink-800">{TITLES[variant]}</p>
      {description && <p className="mt-1 max-w-xs text-sm text-ink-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}
