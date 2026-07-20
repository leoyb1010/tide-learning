import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  TrendUp,
  Coins,
  Package,
  Storefront,
  Gift,
  Star,
  ArrowRight,
  Sparkle,
  CaretRight,
  ClockCounterClockwise,
} from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/session";
import { getCreatorDashboard } from "@/lib/queries";
import { relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "创作者中心" };

/**
 * /me/creator —— 创作者中心（server，流2·U4-a）。
 *
 * 展示当前用户「作为作者」的收益看板：收入总览卡（累计收益/付费成交/在架课）+ 课程销售表
 *   （每门课的定价/成交/收益/评分）+ 近期成交流水。数据由 getCreatorDashboard(user.id) 组装
 *   （内部复用 getAuthorEarnings，越权铁律 where userId=本人）。
 *
 * 空态：还没发布付费课（totalIncome=0 且无在架课）时给友好引导，指向 /create 造课、/market 上架。
 * 未登录跳登录。布局/组件风格复用 /me 下页面（studio-* 卡、有道红点睛、mono 数字）。
 */
export default async function CreatorCenterPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/me/creator");

  const { totalIncome, totalSales, courses, recentSales } = await getCreatorDashboard(user.id);
  const hasCourses = courses.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 py-4">
      {/* 顶部返回 + 标题 */}
      <div>
        <Link
          href="/me"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--ink3)] transition-colors hover:text-[var(--ink)]"
        >
          <ArrowLeft size={14} weight="bold" /> 成长档案
        </Link>
        <header className="mt-3 flex items-end justify-between gap-4">
          <div>
            <div className="mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink4)]">CREATOR CENTER</div>
            <h1 className="mt-1 text-[26px] font-extrabold tracking-tight text-[var(--ink)]">创作者中心</h1>
            <p className="mt-1 text-[14px] text-[var(--ink2)]">你在集市摆摊卖课的收益与销售看板。</p>
          </div>
          <Link
            href="/create"
            className="hidden shrink-0 items-center gap-1.5 rounded-full bg-[var(--red)] px-4 py-2.5 text-[14px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(252,1,26,0.5)] transition-all duration-200 hover:brightness-105 active:translate-y-px sm:inline-flex"
          >
            <Sparkle size={15} weight="fill" />
            再造一门课
          </Link>
        </header>
      </div>

      {!hasCourses ? (
        /* ——— 空态：还没发布付费课 ——— */
        <div className="flex flex-col items-center justify-center gap-4 rounded-[18px] border border-dashed border-[var(--border2)] bg-[var(--surface)] px-6 py-16 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-[16px] bg-[var(--red-soft)]">
            <Storefront size={26} weight="fill" className="text-[var(--red)]" />
          </span>
          <div>
            <p className="text-[16px] font-bold text-[var(--ink)]">还没有在架的课</p>
            <p className="mt-1 max-w-[360px] text-[14px] leading-relaxed text-[var(--ink2)]">
              把你造的课分享到集市并定价，就能开始赚积分。别人买你的付费课，你可得售价的 70%。
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            <Link
              href="/create"
              className="inline-flex items-center gap-2 rounded-[12px] bg-[var(--red)] px-5 py-3 text-[14px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(252,1,26,0.5)] transition-all duration-200 hover:brightness-105 active:translate-y-px"
            >
              <Sparkle size={16} weight="fill" />
              去造一门课
            </Link>
            <Link
              href="/me/courses"
              className="studio-press inline-flex items-center gap-2 rounded-[12px] border border-[var(--border)] bg-[var(--surface2)] px-5 py-3 text-[14px] font-semibold text-[var(--ink)] transition-colors hover:border-[var(--border2)]"
            >
              管理我的课
              <ArrowRight size={15} weight="bold" />
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* ——— 收入总览卡 ——— */}
          <section className="studio-rise relative overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card),var(--inner-hi)]">
            <span className="absolute left-0 top-5 h-6 w-[3px] rounded-r bg-[var(--red)]" aria-hidden />
            <div className="flex items-center gap-2 text-[var(--ink3)]">
              <TrendUp size={16} weight="fill" className="text-[var(--red)]" />
              <span className="text-[13px] font-semibold tracking-[0.06em]">收入总览</span>
            </div>

            <div className="mt-4 grid grid-cols-3 divide-x divide-[var(--border)] overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-inset)]">
              <OverviewStat
                value={totalIncome}
                label="累计收益"
                icon={<Coins size={11} weight="fill" />}
                accent
              />
              <OverviewStat
                value={totalSales}
                label="付费成交"
                icon={<Package size={11} weight="fill" />}
              />
              <OverviewStat value={courses.length} label="在架课" />
            </div>

            <p className="mt-3 text-[12px] leading-relaxed text-[var(--ink3)]">
              付费课售出你可得售价的 70%；免费课被拿走也有小额创作激励。收益即时入账到你的积分。
            </p>
          </section>

          {/* ——— 课程销售表 ——— */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-[var(--red-soft)]">
                <Storefront size={16} weight="fill" className="text-[var(--red)]" />
              </span>
              <div>
                <h2 className="text-[18px] font-extrabold tracking-tight text-[var(--ink)]">课程销售</h2>
                <p className="text-[13px] text-[var(--ink3)]">每门在架课的定价、成交与累计收益。</p>
              </div>
            </div>

            <ul className="flex flex-col gap-2">
              {courses.map((c, i) => {
                const isFree = (c.priceCredits ?? 0) <= 0;
                return (
                  <li
                    key={c.id}
                    style={{ "--i": i } as React.CSSProperties}
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
                        {/* 定价 */}
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
                        {/* 成交 */}
                        <span className="inline-flex items-center gap-1">
                          <Package size={12} weight="fill" className="text-[var(--ink4)]" />
                          <span className="mono">{c.salesCount}</span> {isFree ? "拿走" : "成交"}
                        </span>
                        {/* 评分（有真实评价才显示，否则「暂无评分」，不派生占位） */}
                        {c.rating != null ? (
                          <span className="inline-flex items-center gap-1">
                            <Star size={12} weight="fill" className="text-[var(--warn)]" />
                            <span className="mono">{c.rating.toFixed(1)}</span>
                            <span className="text-[var(--ink4)]">· {c.reviewCount} 评价</span>
                          </span>
                        ) : (
                          <span className="text-[var(--ink4)]">暂无评分</span>
                        )}
                      </div>
                    </div>
                    {/* 该课收益（成就信号，绿色入账口径与集市收益卡一致） */}
                    <div className="flex shrink-0 items-center justify-between gap-2 sm:flex-col sm:items-end sm:gap-0.5">
                      <span className="mono text-[20px] font-extrabold leading-none text-[var(--ok)]">+{c.incomeCredits}</span>
                      <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--ink4)]">积分收益</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* ——— 近期成交流水 ——— */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-[var(--surface-inset)]">
                <ClockCounterClockwise size={16} weight="fill" className="text-[var(--ink3)]" />
              </span>
              <div>
                <h2 className="text-[18px] font-extrabold tracking-tight text-[var(--ink)]">近期成交</h2>
                <p className="text-[13px] text-[var(--ink3)]">最近的售课与免费拿走激励入账。</p>
              </div>
            </div>

            {recentSales.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-[16px] border border-dashed border-[var(--border2)] bg-[var(--surface)] px-6 py-10 text-center">
                <Package size={22} weight="regular" className="text-[var(--ink4)]" />
                <p className="text-[14px] font-semibold text-[var(--ink2)]">还没有成交记录</p>
                <p className="text-[13px] text-[var(--ink3)]">有人买你的付费课或拿走免费课后，这里会出现入账流水。</p>
              </div>
            ) : (
              <ul className="flex flex-col divide-y divide-[var(--border)] overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card)]">
                {recentSales.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-[14px] font-semibold text-[var(--ink)]">
                        {s.reason ?? (s.courseTitle ? `售出《${s.courseTitle}》` : "售课收益")}
                      </span>
                      <span className="mono text-[11px] text-[var(--ink4)]">{relativeTime(s.createdAt)}</span>
                    </div>
                    <span className="mono shrink-0 text-[14px] font-bold text-[var(--ok)]">+{s.incomeCredits}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 去管理我的课入口 */}
          <Link
            href="/me/courses"
            className="studio-lift flex items-center justify-between rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--card)]"
          >
            <div>
              <p className="text-[14px] font-bold text-[var(--ink)]">管理我的课</p>
              <p className="text-[12px] text-[var(--ink3)]">编辑、分享到集市、处理学习申请</p>
            </div>
            <CaretRight size={15} weight="bold" className="text-[var(--ink4)]" />
          </Link>
        </>
      )}
    </div>
  );
}

function OverviewStat({
  value,
  label,
  icon,
  accent = false,
}: {
  value: number;
  label: string;
  icon?: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1 px-2 py-4">
      <span className={`mono text-[26px] font-extrabold leading-none ${accent ? "text-[var(--red)]" : "text-[var(--ink)]"}`}>
        {value.toLocaleString()}
      </span>
      <span className="flex items-center gap-1 text-[11px] text-[var(--ink4)]">
        {icon}
        {label}
      </span>
    </div>
  );
}
