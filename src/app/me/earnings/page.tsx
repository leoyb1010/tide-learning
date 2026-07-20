import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  TrendUp,
  Coins,
  Package,
  Storefront,
  Gift,
  Sparkle,
} from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/session";
import { getAuthorEarnings } from "@/lib/credit-trade";

export const dynamic = "force-dynamic";
export const metadata = { title: "我的收益" };

/**
 * /me/earnings —— 我的收益（server）。
 *
 * 顶部汇总（累计收益积分 / 累计销量 / 在架课数）+ 按课明细（课名链接课详情、价格、销量、收益）。
 * 数据服务端直接调 getAuthorEarnings(user.id)（越权铁律：内部 where authorUserId=本人）。
 * 空态引导去 /me/courses 上架第一门课。未登录跳登录。
 * 布局/组件风格对齐 /me 下子页（studio-* 卡、mono 数字、--ok 入账绿）。
 */
export default async function MyEarningsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/me/earnings");

  const { totalIncome, totalSales, courses } = await getAuthorEarnings(user.id);
  const hasCourses = courses.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 py-4">
      {/* 顶部返回 + 标题 */}
      <div>
        <Link
          href="/me/courses"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--ink3)] transition-colors hover:text-[var(--ink)]"
        >
          <ArrowLeft size={14} weight="bold" /> 我的课
        </Link>
        <header className="mt-3">
          <div className="mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink4)]">MY EARNINGS</div>
          <h1 className="mt-1 text-[26px] font-extrabold tracking-tight text-[var(--ink)]">我的收益</h1>
          <p className="mt-1 text-[14px] text-[var(--ink2)]">你在集市上架课程的收益与销量。</p>
        </header>
      </div>

      {!hasCourses ? (
        /* ——— 空态：还没有在架课 ——— */
        <div className="flex flex-col items-center justify-center gap-4 rounded-[18px] border border-dashed border-[var(--border2)] bg-[var(--surface)] px-6 py-16 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-[16px] bg-[var(--red-soft)]">
            <Storefront size={26} weight="fill" className="text-[var(--red)]" />
          </span>
          <div>
            <p className="text-[16px] font-bold text-[var(--ink)]">还没有收益</p>
            <p className="mt-1 max-w-[360px] text-[14px] leading-relaxed text-[var(--ink2)]">
              把你造的课上架到集市，别人购买后收益即时入账你的积分。
            </p>
          </div>
          <Link
            href="/me/courses"
            className="inline-flex items-center gap-2 rounded-[12px] bg-[var(--red)] px-5 py-3 text-[14px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(252,1,26,0.5)] transition-all duration-200 hover:brightness-105 active:translate-y-px"
          >
            <Sparkle size={16} weight="fill" />
            去上架你的第一门课
          </Link>
        </div>
      ) : (
        <>
          {/* ——— 顶部汇总 ——— */}
          <section className="studio-rise relative overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card),var(--inner-hi)]">
            <span className="absolute left-0 top-5 h-6 w-[3px] rounded-r bg-[var(--red)]" aria-hidden />
            <div className="flex items-center gap-2 text-[var(--ink3)]">
              <TrendUp size={16} weight="fill" className="text-[var(--red)]" />
              <span className="text-[13px] font-semibold tracking-[0.06em]">收益总览</span>
            </div>

            <div className="mt-4 grid grid-cols-3 divide-x divide-[var(--border)] overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-inset)]">
              <SummaryStat value={totalIncome} label="累计收益（积分）" accent />
              <SummaryStat value={totalSales} label="累计销量" />
              <SummaryStat value={courses.length} label="在架课" />
            </div>

            <p className="mt-3 text-[12px] leading-relaxed text-[var(--ink3)]">
              付费课售出你可得售价的 70%，收益即时入账到你的积分。
            </p>
          </section>

          {/* ——— 按课明细 ——— */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-[var(--red-soft)]">
                <Storefront size={16} weight="fill" className="text-[var(--red)]" />
              </span>
              <div>
                <h2 className="text-[18px] font-extrabold tracking-tight text-[var(--ink)]">按课明细</h2>
                <p className="text-[13px] text-[var(--ink3)]">每门在架课的定价、销量与累计收益。</p>
              </div>
            </div>

            <ul className="flex flex-col gap-2">
              {courses.map((c) => {
                const isFree = (c.priceCredits ?? 0) <= 0;
                return (
                  <li
                    key={c.courseId}
                    className="studio-lift flex flex-col gap-3 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5 shadow-[var(--card),var(--inner-hi)] sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <Link
                        href={`/market/${c.slug}`}
                        className="truncate text-[15px] font-bold text-[var(--ink)] transition-colors hover:text-[var(--red)]"
                        title={c.title}
                      >
                        {c.title}
                      </Link>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--ink3)]">
                        {/* 价格 */}
                        <span className="inline-flex items-center gap-1">
                          {isFree ? (
                            <>
                              <Gift size={12} weight="fill" className="text-[var(--ok)]" />
                              免费
                            </>
                          ) : (
                            <>
                              <Coins size={12} weight="fill" className="text-[var(--ink4)]" />
                              <span className="mono">{c.priceCredits}</span> 积分
                            </>
                          )}
                        </span>
                        {/* 销量 */}
                        <span className="inline-flex items-center gap-1">
                          <Package size={12} weight="fill" className="text-[var(--ink4)]" />
                          <span className="mono">{c.salesCount}</span> {isFree ? "拿走" : "成交"}
                        </span>
                      </div>
                    </div>
                    {/* 该课收益（入账绿，口径与创作者中心一致） */}
                    <div className="flex shrink-0 items-center justify-between gap-2 sm:flex-col sm:items-end sm:gap-0.5">
                      <span className="mono text-[20px] font-extrabold leading-none text-[var(--ok)]">+{c.income}</span>
                      <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--ink4)]">积分收益</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

/** 汇总格：mono 大数字 + 小标签（accent=入账绿）。 */
function SummaryStat({ value, label, accent = false }: { value: number; label: string; accent?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1 px-2 py-4">
      <span className={`mono text-[24px] font-extrabold leading-none ${accent ? "text-[var(--ok)]" : "text-[var(--ink)]"}`}>
        {accent ? `+${value}` : value}
      </span>
      <span className="text-[11px] text-[var(--ink4)]">{label}</span>
    </div>
  );
}
