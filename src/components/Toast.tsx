"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle, Info, Warning, X } from "@phosphor-icons/react";
import { SPRING_FIRM } from "./motion";

type ToastTone = "success" | "info" | "warn";
interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  action?: { label: string; onClick: () => void };
}

interface ToastApi {
  toast: (message: string, opts?: { tone?: ToastTone; action?: ToastItem["action"]; duration?: number }) => void;
}

const Ctx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) return { toast: () => {} }; // 容错：未挂 Provider 时静默
  return ctx;
}

const ICONS = { success: CheckCircle, info: Info, warn: Warning };
const TONE_CLS: Record<ToastTone, string> = {
  success: "text-success",
  info: "text-ink-600",
  warn: "text-warning",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  let idSeq = 0;

  const toast = useCallback<ToastApi["toast"]>((message, opts) => {
    const id = Date.now() + idSeq++;
    const tone = opts?.tone ?? "success";
    setItems((xs) => [...xs.slice(-2), { id, message, tone, action: opts?.action }]); // 最多堆叠 3
    const dur = opts?.duration ?? 4000;
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), dur);
  }, []);

  const dismiss = (id: number) => setItems((xs) => xs.filter((x) => x.id !== id));

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      {/* aria-live 容器：屏幕阅读器可听到 toast 反馈。success/info 走 polite(不打断)，
          warn 走 assertive(即时播报)。容器保持 pointer-events-none 不影响视觉与点击。 */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-6 flex flex-col items-center gap-2 px-4"
        style={{ zIndex: "var(--z-toast)" }}
      >
        <AnimatePresence>
          {items.map((t) => {
            const Icon = ICONS[t.tone];
            const isWarn = t.tone === "warn";
            return (
              <motion.div
                key={t.id}
                layout
                role={isWarn ? "alert" : "status"}
                aria-live={isWarn ? "assertive" : "polite"}
                initial={{ opacity: 0, y: 16, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                transition={{ ...SPRING_FIRM, type: "spring" }}
                className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-ink-100 bg-paper-raised px-4 py-3 shadow-[0_18px_40px_-20px_rgba(125,8,18,0.28)]"
              >
                <Icon size={18} weight="fill" aria-hidden className={TONE_CLS[t.tone]} />
                <span className="text-sm text-ink-800">{t.message}</span>
                {t.action && (
                  <button
                    onClick={() => { t.action!.onClick(); dismiss(t.id); }}
                    className="ml-1 text-sm font-medium text-accent-700 link-underline"
                  >
                    {t.action.label}
                  </button>
                )}
                <button onClick={() => dismiss(t.id)} className="ml-1 text-ink-400 transition-colors hover:text-ink-600" aria-label="关闭">
                  <X size={14} />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
