import Link from "next/link";
import type { ReactNode } from "react";

/* ============ Button（§13.3：默认/hover/pressed/disabled/loading）============ */
type ButtonProps = {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "cta";
  size?: "sm" | "md" | "lg";
  href?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  full?: boolean;
};

const VARIANTS: Record<string, string> = {
  primary: "bg-tide-600 text-white hover:bg-tide-700 active:bg-tide-900",
  secondary: "bg-white text-ink-950 border border-ink-200 hover:border-tide-400 hover:text-tide-700",
  ghost: "bg-transparent text-tide-700 hover:bg-tide-50",
  cta: "bg-dawn-400 text-ink-950 hover:bg-dawn-500 active:bg-dawn-500",
};
const SIZES: Record<string, string> = {
  sm: "text-sm px-3 py-1.5 rounded-lg",
  md: "text-[0.95rem] px-5 py-2.5 rounded-xl",
  lg: "text-base px-7 py-3.5 rounded-xl",
};

export function Button({
  children, variant = "primary", size = "md", href, onClick, type = "button",
  disabled, loading, className = "", full,
}: ButtonProps) {
  const cls = `btn inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${full ? "w-full" : ""} ${className}`;
  const content = (
    <>
      {loading && <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </>
  );
  if (href && !disabled) return <Link href={href} className={cls}>{content}</Link>;
  return <button type={type} onClick={onClick} disabled={disabled || loading} className={cls}>{content}</button>;
}

/* ============ Badge ============ */
const TONES: Record<string, string> = {
  tide: "bg-tide-50 text-tide-700",
  dawn: "bg-dawn-300/30 text-dawn-500",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  error: "bg-error/10 text-error",
  muted: "bg-ink-100 text-ink-500",
};
export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: string }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone] ?? TONES.muted}`}>{children}</span>;
}

/* ============ 状态：Empty / Error / Loading（§17：所有核心页面必须包含）============ */
export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-200 bg-paper-raised px-6 py-16 text-center">
      <div className="mb-3 text-3xl opacity-40">🌫️</div>
      <p className="text-ink-950 font-medium">{title}</p>
      {hint && <p className="mt-1.5 text-sm text-ink-500">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "出错了", hint, onRetry }: { title?: string; hint?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-error/20 bg-error/5 px-6 py-14 text-center">
      <div className="mb-3 text-3xl">⚠️</div>
      <p className="font-medium text-ink-950">{title}</p>
      {hint && <p className="mt-1.5 text-sm text-ink-500">{hint}</p>}
      {onRetry && <button onClick={onRetry} className="mt-5 text-sm font-medium text-tide-700 hover:underline">重试</button>}
    </div>
  );
}

export function LoadingSkeleton({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton h-4" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="rounded-2xl border border-ink-100 bg-paper-raised p-4">
      <div className="skeleton mb-4 h-32 w-full" />
      <div className="skeleton mb-2 h-4 w-3/4" />
      <div className="skeleton h-3 w-1/2" />
    </div>
  );
}

/* ============ 封面渐变（避免二进制资源，保持高级感）============ */
export const COVER_GRADIENTS: Record<string, string> = {
  tide: "linear-gradient(135deg, #1f7a70, #4d9d95 70%, #d4ece9)",
  dawn: "linear-gradient(135deg, #185f57, #e2924a 90%, #f6c99a)",
};
export function CoverBg({ color, className = "", children }: { color: string; className?: string; children?: ReactNode }) {
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: COVER_GRADIENTS[color] ?? COVER_GRADIENTS.tide }}>
      {children}
    </div>
  );
}
