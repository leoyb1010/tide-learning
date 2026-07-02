"use client";

import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";

/** 轻量 tooltip：hover/focus 显示，用于图标按钮与快捷键提示。 */
export function Tooltip({ label, children, side = "top" }: { label: string; children: ReactNode; side?: "top" | "bottom" }) {
  const [show, setShow] = useState(false);
  const pos = side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5";
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      {children}
      <AnimatePresence>
        {show && (
          <motion.span
            role="tooltip"
            initial={{ opacity: 0, y: side === "top" ? 4 : -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className={`pointer-events-none absolute left-1/2 z-[90] -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink-950 px-2 py-1 text-xs text-paper-raised ${pos}`}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
