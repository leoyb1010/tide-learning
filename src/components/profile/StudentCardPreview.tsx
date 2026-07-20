"use client";

import { GraduationCap, Quotes, SealCheck } from "@phosphor-icons/react";

/**
 * StudentCardPreview —— 学生证「实时预览」（client）。
 *
 * 与服务端 StudentCard（async server，含 QR 生成）视觉语言完全对齐，
 * 但接受可变 props（nickname / motto / avatarUrl）以便设置页改动即时刷新证件。
 * 二维码只依赖稳定的 userId，故由服务端预渲染成 SVG 串（qrSvg）透传进来，
 * 避免在客户端引入 qrcode 依赖，也无需重新生成。
 *
 * 静态字段（学号 / 入学 / 等级 / 累计 / 连续 / 会员态）由父页一次性算好传入。
 */

export interface StudentCardPreviewProps {
  nickname: string; // 实时
  motto?: string | null; // 实时（学生证联动核心）
  avatarUrl?: string | null; // 实时
  // ↓ 静态展示数据
  studentNo: string;
  joinedLabel: string; // 例 2026.07
  validLabel: string; // VALID FOREVER / VALID 2026.09 / 免费学员
  levelLabel: string; // Lv.7 深度专注者
  hoursLabel: string; // 累计小时（已格式化）
  streak: number;
  isSubscriber: boolean;
  qrSvg?: string; // 服务端预渲染的二维码 SVG（可空）
}

export function StudentCardPreview({
  nickname,
  motto,
  avatarUrl,
  studentNo,
  joinedLabel,
  validLabel,
  levelLabel,
  hoursLabel,
  streak,
  isSubscriber,
  qrSvg,
}: StudentCardPreviewProps) {
  const initial = nickname.slice(0, 1) || "学";
  const mottoText = motto?.trim();

  return (
    <div className="studio-rise relative flex flex-col overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card),var(--inner-hi)]">
      {/* ① 深色校徽抬头带 */}
      <div className="relative overflow-hidden px-6 pb-5 pt-5 sm:px-7" style={{ background: "var(--video-grad)" }}>
        <span
          className="pointer-events-none absolute -bottom-12 -right-10 h-32 w-32 rounded-full opacity-30 blur-2xl"
          style={{ background: "radial-gradient(circle, var(--red) 0%, transparent 70%)" }}
          aria-hidden
        />
        <div className="relative flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[var(--red)] text-white shadow-[var(--red-glow)]">
              <GraduationCap size={17} weight="fill" />
            </span>
            <div className="leading-tight">
              <p className="text-[14px] font-bold tracking-[0.04em] text-[var(--ink-on-dark)]">有道自习室</p>
              <p className="mono text-[9px] uppercase tracking-[0.24em] text-[var(--ink-on-dark-3)]">STUDENT ID</p>
            </div>
          </div>
          {isSubscriber ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--hairline-on-dark)] bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-[var(--ink-on-dark)]">
              <SealCheck size={12} weight="fill" className="text-[var(--red)]" /> 会员
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border border-[var(--hairline-on-dark)] px-2.5 py-1 text-[11px] font-medium text-[var(--ink-on-dark-2)]">
              免费学员
            </span>
          )}
        </div>
      </div>

      {/* ② 纸质主体 */}
      <div className="relative flex-1 px-6 pb-6 pt-5 sm:px-7">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.5]"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, var(--border) 1px, transparent 0)",
            backgroundSize: "24px 24px",
            maskImage: "linear-gradient(to bottom right, rgba(0,0,0,0.35), transparent 70%)",
            WebkitMaskImage: "linear-gradient(to bottom right, rgba(0,0,0,0.35), transparent 70%)",
          }}
          aria-hidden
        />

        <div className="relative flex items-center gap-3.5">
          {avatarUrl ? (

            <img
              src={avatarUrl}
              alt=""
              width={56}
              height={56}
              className="h-14 w-14 shrink-0 rounded-full object-cover ring-1 ring-[var(--border)]"
            />
          ) : (
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[var(--surface-inset)] text-[22px] font-bold text-[var(--ink2)]">
              {initial}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-[22px] font-bold leading-none text-[var(--ink)]">{nickname || "你的昵称"}</h2>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--red-ink)]">
                {levelLabel}
              </span>
            </div>
          </div>
        </div>

        <dl className="relative mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-[var(--border)] pt-4">
          <InfoRow label="学号" value={studentNo} mono />
          <InfoRow label="入学" value={`${joinedLabel} · ${validLabel}`} mono />
          <InfoRow label="累计学习" value={<><span className="mono">{hoursLabel}</span> 小时</>} />
          <InfoRow label="连续" value={<><span className="mono">{streak}</span> 天</>} />
        </dl>

        {/* ③ 卡脚：格言（实时联动）+ 二维码 */}
        <div className="relative mt-5 flex items-end justify-between gap-4 border-t border-[var(--border)] pt-4">
          <div className="min-w-0">
            {mottoText ? (
              <div className="flex gap-2">
                <Quotes size={16} weight="fill" className="mt-0.5 shrink-0 text-[var(--ink4)]" aria-hidden />
                <p className="line-clamp-2 text-[14px] leading-[1.6] text-[var(--ink2)]">{mottoText}</p>
              </div>
            ) : (
              <p className="text-[13px] leading-[1.6] text-[var(--ink4)]">写一句座右铭，给这张证一点温度。</p>
            )}
          </div>
          {qrSvg && (
            <div
              className="h-[72px] w-[72px] shrink-0 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-1.5 opacity-90 [&>svg]:h-full [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
              aria-label="个人主页二维码"
            />
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink4)]">{label}</dt>
      <dd className={`mt-1 truncate text-[13px] font-semibold text-[var(--ink)] ${mono ? "mono tracking-[0.06em]" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

export default StudentCardPreview;
