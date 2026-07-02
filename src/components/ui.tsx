import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, WarningCircle, Wind } from "@phosphor-icons/react/dist/ssr";

/* ============ Button — 触感反馈 (:active 下压) + 可选图标 ============ */
type ButtonProps = {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  href?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  full?: boolean;
  icon?: boolean; // 末尾追加箭头
};

const VARIANTS: Record<string, string> = {
  primary:
    "bg-accent-600 text-white hover:bg-accent-700 shadow-[0_1px_2px_rgba(13,51,45,0.18)]",
  secondary:
    "bg-paper-raised text-ink-950 ring-1 ring-inset ring-ink-200 hover:ring-accent-400 hover:text-accent-700",
  ghost: "bg-transparent text-accent-700 hover:bg-accent-50",
};
const SIZES: Record<string, string> = {
  sm: "text-[0.82rem] px-3.5 py-2 rounded-lg gap-1.5",
  md: "text-[0.9rem] px-5 py-2.5 rounded-xl gap-2",
  lg: "text-[0.95rem] px-7 py-3.5 rounded-xl gap-2",
};

export function Button({
  children, variant = "primary", size = "md", href, onClick, type = "button",
  disabled, loading, className = "", full, icon,
}: ButtonProps) {
  const cls = `btn group inline-flex items-center justify-center font-medium transition-all duration-200 [transition-timing-function:var(--ease-out-expo)] active:translate-y-px active:scale-[0.985] disabled:opacity-45 disabled:pointer-events-none ${VARIANTS[variant]} ${SIZES[size]} ${full ? "w-full" : ""} ${className}`;
  const content = (
    <>
      {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
      {icon && !loading && <ArrowRight weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" size={16} />}
    </>
  );
  if (href && !disabled) return <Link href={href} className={cls}>{content}</Link>;
  return <button type={type} onClick={onClick} disabled={disabled || loading} className={cls}>{content}</button>;
}

/* ============ Badge ============ */
const TONES: Record<string, string> = {
  accent: "bg-accent-50 text-accent-700 ring-accent-200",
  success: "bg-success/10 text-success ring-success/20",
  warning: "bg-warning/10 text-warning ring-warning/20",
  error: "bg-error/10 text-error ring-error/20",
  muted: "bg-ink-50 text-ink-500 ring-ink-200",
};
// 兼容旧 tone 名
const TONE_ALIAS: Record<string, string> = { tide: "accent", dawn: "warning" };
export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: string }) {
  const key = TONE_ALIAS[tone] ?? tone;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.72rem] font-medium ring-1 ring-inset ${TONES[key] ?? TONES.muted}`}>
      {children}
    </span>
  );
}

/* ============ 状态：Empty / Error / Loading ============ */
export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-ink-200 bg-paper-raised px-6 py-20 text-center">
      <Wind size={30} weight="light" className="text-ink-400" />
      <p className="mt-4 font-medium text-ink-950">{title}</p>
      {hint && <p className="mt-1.5 text-sm text-ink-500">{hint}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "出错了", hint, onRetry }: { title?: string; hint?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-error/20 bg-error/[0.04] px-6 py-16 text-center">
      <WarningCircle size={30} weight="light" className="text-error" />
      <p className="mt-4 font-medium text-ink-950">{title}</p>
      {hint && <p className="mt-1.5 text-sm text-ink-500">{hint}</p>}
      {onRetry && <button onClick={onRetry} className="mt-5 text-sm font-medium text-accent-700 hover:underline">重试</button>}
    </div>
  );
}

export function LoadingSkeleton({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton h-4" style={{ width: `${92 - i * 13}%` }} />
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="rounded-[var(--radius-card)] border border-ink-100 bg-paper-raised p-4">
      <div className="skeleton mb-4 aspect-[16/10] w-full" />
      <div className="skeleton mb-2 h-4 w-3/4" />
      <div className="skeleton h-3 w-1/2" />
    </div>
  );
}

/* ============ 封面渐变（染背景 + 细网格）============ */
export const COVER_GRADIENTS: Record<string, string> = {
  tide: "linear-gradient(145deg, #17564d 0%, #1f6b60 55%, #4f9488 100%)",
  dawn: "linear-gradient(145deg, #0d332d 0%, #1f6b60 60%, #7fb3a8 100%)",
};
export function CoverBg({ color, className = "", children }: { color: string; className?: string; children?: ReactNode }) {
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: COVER_GRADIENTS[color] ?? COVER_GRADIENTS.tide }}>
      <div
        className="absolute inset-0 opacity-[0.12]"
        style={{ backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.6) 1px, transparent 0)", backgroundSize: "16px 16px" }}
      />
      {children}
    </div>
  );
}
