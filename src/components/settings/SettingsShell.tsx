import Link from "next/link";
import { CaretRight } from "@phosphor-icons/react/dist/ssr";

/* ============================================================
 * 设置中心 · 服务端展示原语（跨子路由复用）
 * SectionCard / InfoRow / LinkRow —— 从旧单页 page.tsx 抽出。
 * elev-1 分区卡，Linear 密度；语义 tone 让分区一眼可辨。
 * ============================================================ */

/** 分区图标底色 tone：安全→info，订阅→red，其余中性。 */
const SECTION_ICON_TONE: Record<string, string> = {
  info: "bg-[var(--info-soft)] text-[var(--info)]",
  red: "bg-[var(--red-soft)] text-[var(--red)]",
  neutral: "bg-[var(--surface-inset)] text-[var(--ink2)]",
};

/** 分区卡：elev-1 材质卡，图标 + 标题 + 描述 + 内容。递延进场靠父容器 .stagger + --i。 */
export function SectionCard({
  id,
  icon,
  title,
  desc,
  index = 0,
  tone = "neutral",
  children,
}: {
  id?: string;
  icon: React.ReactNode;
  title: string;
  desc?: string;
  index?: number;
  tone?: "info" | "red" | "neutral";
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      style={{ "--i": index } as React.CSSProperties}
      className="scroll-mt-6 rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card),var(--inner-hi)] sm:p-6"
    >
      <div className="mb-4 flex items-center gap-3">
        <span className={`grid h-9 w-9 place-items-center rounded-[10px] ${SECTION_ICON_TONE[tone]}`}>
          {icon}
        </span>
        <div>
          <h2 className="text-[16px] font-bold text-[var(--ink)]">{title}</h2>
          {desc && <p className="text-[12px] text-[var(--ink3)]">{desc}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/** 信息行：左标签 + 右值（可带尾部动作）。 */
export function InfoRow({
  label,
  value,
  action,
}: {
  label: string;
  value: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-[13px] text-[var(--ink3)]">{label}</span>
      <span className="flex items-center gap-3">
        <span className="text-[14px] font-medium text-[var(--ink)]">{value}</span>
        {action}
      </span>
    </div>
  );
}

/** 跳转行：左标签 + 右提示（可带状态点）+ 右箭头。触达高 ≥44px。 */
export function LinkRow({
  href,
  label,
  hint,
  hintTone,
}: {
  href: string;
  label: string;
  hint?: string;
  hintTone?: "ok" | "warn" | "muted";
}) {
  // 状态点：订阅正常→--ok，需处理→--warn，其余中性
  const dot =
    hintTone === "ok"
      ? "bg-[var(--ok)]"
      : hintTone === "warn"
        ? "bg-[var(--warn)]"
        : null;
  return (
    <Link
      href={href}
      className="studio-lift flex items-center justify-between gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface2)] px-4 py-3.5"
    >
      <span className="shrink-0 text-[14px] font-semibold text-[var(--ink)]">{label}</span>
      <span className="flex min-w-0 items-center gap-2 text-[13px] text-[var(--ink3)]">
        {dot && <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />}
        <span className="truncate">{hint}</span>
        <CaretRight size={14} weight="bold" className="shrink-0 text-[var(--ink4)]" />
      </span>
    </Link>
  );
}
