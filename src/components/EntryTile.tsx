import Link from "next/link";
import { CaretRight } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";

/**
 * EntryTile —— 「图标方块 + 标题 + 副文 + CaretRight」的统一入口卡（成长档案 /me 等处 ×N 复用）。
 *
 * 此前该结构在 /me 页逐处手抄（图标框/圆角/海拔/hover 全一致），改动一处要同步多处。
 * 抽成单组件：视觉 token 单一真源，减少复制漂移。副文 desc 支持 ReactNode（可放 mono 数字强调）。
 */
export function EntryTile({
  href,
  icon,
  iconClassName = "bg-[var(--surface-inset)] text-[var(--ink3)]",
  title,
  desc,
  className = "",
}: {
  href: string;
  icon: ReactNode;
  /** 图标方块的底色/字色（默认中性；待办等状态可传 --warn-soft 等）。 */
  iconClassName?: string;
  title: string;
  desc: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`studio-lift hover-sheen flex min-h-[68px] items-center justify-between rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card),var(--inner-hi)] ${className}`}
    >
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] ${iconClassName}`}>{icon}</div>
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-[var(--ink)]">{title}</p>
          <p className="text-[12px] text-[var(--ink3)]">{desc}</p>
        </div>
      </div>
      <CaretRight size={15} weight="bold" className="shrink-0 text-[var(--ink4)]" />
    </Link>
  );
}
