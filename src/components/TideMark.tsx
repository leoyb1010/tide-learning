/** 潮汐 品牌标记 — 三道退潮波纹，替代 emoji logo。 */
export function TideMark({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" className={className} aria-hidden>
      <rect width="28" height="28" rx="8" fill="var(--color-accent-600)" />
      <path d="M5 17c1.8 0 1.8-2 3.6-2s1.8 2 3.6 2 1.8-2 3.6-2 1.8 2 3.6 2 1.8-2 3.6-2" stroke="white" strokeWidth="1.6" strokeLinecap="round" opacity="0.95" />
      <path d="M5 12.5c1.8 0 1.8-2 3.6-2s1.8 2 3.6 2 1.8-2 3.6-2 1.8 2 3.6 2 1.8-2 3.6-2" stroke="white" strokeWidth="1.6" strokeLinecap="round" opacity="0.6" />
      <path d="M5 21.5c1.8 0 1.8-2 3.6-2s1.8 2 3.6 2 1.8-2 3.6-2 1.8 2 3.6 2 1.8-2 3.6-2" stroke="white" strokeWidth="1.6" strokeLinecap="round" opacity="0.4" />
    </svg>
  );
}
