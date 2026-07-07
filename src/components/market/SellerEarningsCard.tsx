"use client";

import { useState } from "react";
import Link from "next/link";
import { Coins, TrendUp, CaretDown, Package, ArrowRight, Gift } from "@phosphor-icons/react";
import { abbrevCount } from "@/lib/market-view";

export interface SellerEarningsCourse {
  courseId: string;
  slug: string;
  title: string;
  priceCredits: number | null;
  salesCount: number;
  income: number;
}

export interface SellerEarnings {
  totalIncome: number;
  totalSales: number;
  courses: SellerEarningsCourse[];
}

/**
 * SellerEarningsCard —— 集市「我的收益」入口（client, S4 §问题⑪·④）。
 *
 * 展示：累计售课收益（积分）+ 累计付费成交笔数 + 在架课数；可展开看每门课的成交/收益明细。
 * 数据由 server 页（/market）用 getAuthorEarnings(where userId=我) 预算好透传，
 *   本组件零 fetch、纯展示 + 展开态（不引 server 链，越权在 server 侧已守）。
 * 视觉：收益数字红点睛（关键成就信号），克制不喧宾；仅在「我有在架课」时由父页渲染。
 */
export function SellerEarningsCard({ earnings }: { earnings: SellerEarnings }) {
  const [open, setOpen] = useState(false);
  const { totalIncome, totalSales, courses } = earnings;
  const stallCount = courses.length;

  return (
    <div className="studio-rise relative overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 shadow-[var(--card),var(--inner-hi)]">
      <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r bg-[var(--red)]" aria-hidden />

      {/* 单行条：标题 · 内联三指标 · 明细/再摆一摊 —— 压缩高度，不再抢集市首屏 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-1">
        <span className="flex items-center gap-1.5 text-[var(--ink3)]">
          <TrendUp size={15} weight="fill" className="text-[var(--red)]" />
          <span className="text-[12.5px] font-semibold tracking-[0.04em]">我的集市收益</span>
        </span>

        <span className="flex items-center gap-3.5 text-[12px] text-[var(--ink3)]">
          <span className="inline-flex items-center gap-1">
            <Coins size={12} weight="fill" className="text-[var(--red)]" />
            累计
            <b className="mono font-bold text-[var(--red)]">{abbrevCount(totalIncome)}</b>
          </span>
          <span className="inline-flex items-center gap-1">
            <Package size={12} weight="fill" className="text-[var(--ink4)]" />
            成交
            <b className="mono font-bold text-[var(--ink)]">{abbrevCount(totalSales)}</b>
          </span>
          <span className="inline-flex items-center gap-1">
            在架
            <b className="mono font-bold text-[var(--ink)]">{stallCount}</b>
          </span>
        </span>

        <span className="ml-auto flex items-center gap-3">
          {courses.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--ink3)] transition-colors hover:text-[var(--ink)]"
              aria-expanded={open}
            >
              明细
              <CaretDown size={12} weight="bold" className={`transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
          )}
          <Link
            href="/create"
            className="group inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--ink3)] transition-colors hover:text-[var(--red)]"
          >
            再摆一摊
            <ArrowRight size={13} weight="bold" className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        </span>
      </div>

      {/* 明细展开 */}
      {courses.length > 0 && (
        <>
          {open && (
            <ul className="stagger mt-1.5 space-y-1.5">
              {courses.map((c, i) => {
                const isFree = (c.priceCredits ?? 0) <= 0;
                return (
                  <li
                    key={c.courseId}
                    style={{ "--i": i } as React.CSSProperties}
                    className="flex items-center justify-between gap-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-2"
                  >
                    <Link
                      href={`/market/${c.slug}`}
                      className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--ink2)] transition-colors hover:text-[var(--red)]"
                      title={c.title}
                    >
                      {c.title}
                    </Link>
                    <span className="flex shrink-0 items-center gap-2.5">
                      <span className="inline-flex items-center gap-1 text-[11px] text-[var(--ink4)]">
                        {isFree ? (
                          <>
                            <Gift size={11} weight="fill" className="text-[var(--ok)]" />
                            免费
                          </>
                        ) : (
                          <>
                            <Package size={11} weight="fill" />
                            <span className="mono">{c.salesCount}</span> 成交
                          </>
                        )}
                      </span>
                      <span className="mono text-[13px] font-semibold text-[var(--ok)]">+{c.income}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
