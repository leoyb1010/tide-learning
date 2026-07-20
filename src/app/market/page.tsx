import Link from "next/link";
import {
  Storefront,
  Sparkle,
  SignIn,
  TrendUp,
  Package,
  Confetti,
  ArrowRight,
} from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/session";
import { buildMarketStalls } from "@/lib/market-data";
import { getAuthorEarnings } from "@/lib/credit-trade";
import { trackLabel, TRACK_MAP } from "@/lib/tracks";
import { MarketStallCard } from "@/components/market/MarketStallCard";
import { MarketSortTabs } from "@/components/market/MarketSortTabs";
import { MarketCategoryTabs } from "@/components/market/MarketCategoryTabs";
import { SellerEarningsCard } from "@/components/market/SellerEarningsCard";
import {
  normalizeSort,
  sortStalls,
  abbrevCount,
  tradeVolume,
  type MarketStall,
} from "@/lib/market-view";

export const metadata = { title: "课程集市" };
export const dynamic = "force-dynamic";

/** 今日 0 点（本地）毫秒，用于"今日上新"统计。 */
function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * /market —— 课程集市「交易市场」（server, S4 交易市场重设计 §问题⑪）。
 *
 * 定位：线上精品市集——橱窗式陈列，每卡是可交易的「商品」（价签/成交/评分/店主），
 *   点卡进商品详情页（/market/[slug]）看评价/大纲/店铺，确认购买/拿走后才进学习。
 *
 * 结构：交易氛围条（今日上新/最热/累计成交）+ 我的收益入口（有在架课时）+ 排序（热销/最新/口碑/价格）
 *   + 橱窗商品网格（stagger 进场）+ 空态引导。
 * 数据：sharedStatus="shared" 的用户造课；每课派生 拿走数/销量/摊主/价格。
 *   排序 ?sort=hot|new|rated|price 由 URL 驱动，server 端重排。
 * 越权：登录用户预取「我拿走过哪些课」（where userId=我）决定 CTA 初始态；自己的课标「你的摊位」；
 *   收益入口用 getAuthorEarnings(where userId=我)。
 * 铁律：本 server 组件只查库 + 组装视图模型，交互（购买/拿走/排序）全在 client 子组件。
 */
export default async function MarketPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; category?: string }>;
}) {
  const [user, sp] = await Promise.all([getCurrentUser(), searchParams]);
  const sort = normalizeSort(sp.sort);
  // 分类筛选（问题⑨）：非法/缺省视为「全部」；只认真实存在的赛道 key，其余（含脏数据）当全部。
  const category = sp.category && TRACK_MAP[sp.category] ? sp.category : "all";

  // 摊位视图模型：与 GET /api/market 共用同一份组装逻辑（src/lib/market-data.ts），
  // 保证 Web 与 iOS 集市字段/语义完全一致（拿走数排除作者本人、越权铁律 where userId）。
  const stalls: MarketStall[] = await buildMarketStalls(user?.id ?? null);
  const sorted = sortStalls(stalls, sort);
  // 当前市集实际有货的赛道（问题⑨：只列非空分类，观感专业，不摆空赛道 Tab）。按 TRACKS 顺序稳定。
  const presentCategories = Object.keys(TRACK_MAP)
    .filter((key) => stalls.some((s) => s.category === key))
    .map((key) => ({ key, label: trackLabel(key) }));
  // 按分类筛选（保持排序后的相对顺序）。
  const visible = category === "all" ? sorted : sorted.filter((s) => s.category === category);
  // #13 轻量：从集市侧发起造课带上下文——选中某赛道时，造课 CTA 用该赛道中文名作 prompt 预填。
  const createHref = category === "all" ? "/create" : `/create?prompt=${encodeURIComponent(trackLabel(category))}`;

  // 我的集市收益（仅登录用户查一次；无在架课时不渲染入口）。越权铁律：where userId=我。
  const earnings = user ? await getAuthorEarnings(user.id) : null;
  const hasStalls = Boolean(earnings && earnings.courses.length > 0);

  // ——— 交易氛围数据 ———
  const todayStart = startOfTodayMs();
  const newTodayCount = stalls.filter((s) => s.createdAtMs >= todayStart).length;
  // 累计成交 = 全市成交热度之和（付费看销量、免费看拿走数，统一 tradeVolume 口径）。
  const totalTrades = stalls.reduce((sum, s) => sum + tradeVolume(s), 0);
  const hottest = stalls.reduce<MarketStall | null>(
    (best, s) => (!best || tradeVolume(s) > tradeVolume(best) ? s : best),
    null,
  );
  const hottestVolume = hottest ? tradeVolume(hottest) : 0;

  return (
    <div className="studio-rise mx-auto flex w-full max-w-[1280px] flex-col gap-6">
      {/* ——— 头部 ——— */}
      <header className="flex flex-col gap-2">
        <div className="mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink4)]">
          COURSE MARKET
        </div>
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-[12px] bg-[var(--red-soft)]">
            <Storefront size={18} weight="fill" className="text-[var(--red)]" />
          </span>
          <h1 className="text-[26px] font-extrabold tracking-tight text-[var(--ink)]">课程集市</h1>
        </div>
        <p className="text-[14px] text-[var(--ink2)]">
          同学们用 AI 摆出的课摊，逛一逛，看中就拿走或购买到你的书架。
        </p>
      </header>

      {/* ——— 交易氛围条 ——— */}
      {stalls.length > 0 && (
        <div className="stagger grid grid-cols-1 gap-3 sm:grid-cols-3">
          {/* 今日上新 */}
          <div
            style={{ "--i": 0 } as React.CSSProperties}
            className="elev-1 flex items-center gap-3 rounded-[14px] px-4 py-3"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[var(--ok-soft)]">
              <Confetti size={17} weight="fill" className="text-[var(--ok)]" />
            </span>
            <span className="min-w-0">
              <span className="mono block text-[10px] uppercase tracking-[0.1em] text-[var(--ink4)]">今日上新</span>
              <span className="block text-[14px] font-bold text-[var(--ink)]">
                {newTodayCount > 0 ? (
                  <>
                    <span className="mono">{newTodayCount}</span> 门新课摆摊
                  </>
                ) : (
                  <span className="text-[13px] font-semibold text-[var(--ink2)]">今日暂无上新，明天再逛</span>
                )}
              </span>
            </span>
          </div>

          {/* 最热门课 */}
          <div
            style={{ "--i": 1 } as React.CSSProperties}
            className="elev-1 flex items-center gap-3 rounded-[14px] px-4 py-3"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[var(--red-soft)]">
              <TrendUp size={17} weight="fill" className="text-[var(--red)]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="mono block text-[10px] uppercase tracking-[0.1em] text-[var(--ink4)]">最热门课</span>
              {hottest && hottestVolume > 0 ? (
                <Link
                  href={`/market/${hottest.slug}`}
                  className="block truncate text-[14px] font-bold text-[var(--ink)] transition-colors hover:text-[var(--red)]"
                  title={hottest.title}
                >
                  {hottest.title}
                </Link>
              ) : (
                <span className="block text-[13px] font-semibold text-[var(--ink2)]">还没有爆款，等你捧场</span>
              )}
            </span>
          </div>

          {/* 累计成交 */}
          <div
            style={{ "--i": 2 } as React.CSSProperties}
            className="elev-1 flex items-center gap-3 rounded-[14px] px-4 py-3"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[var(--info-soft)]">
              <Package size={17} weight="fill" className="text-[var(--info)]" />
            </span>
            <span className="min-w-0">
              <span className="mono block text-[10px] uppercase tracking-[0.1em] text-[var(--ink4)]">累计成交</span>
              <span className="block text-[14px] font-bold text-[var(--ink)]">
                <span className="mono">{abbrevCount(totalTrades)}</span> 次入手
              </span>
            </span>
          </div>
        </div>
      )}

      {/* ——— 我的集市收益（有在架课时）——— */}
      {hasStalls && earnings && (
        <SellerEarningsCard earnings={earnings} />
      )}

      {/* ——— 未登录引导 ——— */}
      {!user && stalls.length > 0 && (
        <div className="flex flex-col items-center justify-between gap-3 rounded-[14px] border border-[var(--border)] bg-[var(--surface-inset)] px-5 py-4 shadow-[var(--inner-hi)] sm:flex-row">
          <p className="text-[14px] text-[var(--ink2)]">登录后可把喜欢的课拿到你的书架，付费课用积分购买。</p>
          <Link
            href="/login?next=/market"
            className="cta-glow studio-press inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-[12px] bg-[var(--red)] px-4 py-2 text-[13px] font-bold text-white transition-all hover:brightness-105"
          >
            <SignIn size={15} weight="bold" />
            去登录
          </Link>
        </div>
      )}

      {stalls.length === 0 ? (
        // ——— 空态：集市无货，引导分享 ———
        <div className="flex flex-col items-center justify-center gap-4 rounded-[16px] border border-dashed border-[var(--border2)] bg-[var(--surface)] px-6 py-16 text-center shadow-[var(--inner-hi)]">
          <span className="grid h-14 w-14 place-items-center rounded-[16px] bg-[var(--red-soft)]">
            <Storefront size={26} weight="fill" className="text-[var(--red)]" />
          </span>
          <div>
            <p className="text-[16px] font-bold text-[var(--ink)]">集市还没开张</p>
            <p className="mt-1 text-[14px] leading-[1.6] text-[var(--ink2)]">
              还没有课摆上摊。去造一门课，第一个把它分享到集市，让同学们拿走。
            </p>
          </div>
          <Link
            href="/create"
            className="cta-glow studio-press inline-flex min-h-[44px] items-center gap-2 rounded-[12px] bg-[var(--red)] px-5 py-3 text-[14px] font-bold text-white transition-all hover:brightness-105"
          >
            <Sparkle size={16} weight="fill" />
            去造一门课分享
          </Link>
        </div>
      ) : (
        <>
          {/* ——— 分类筛选（问题⑨）+ 排序切换 ——— */}
          <div className="flex flex-col gap-3">
            {presentCategories.length > 0 && <MarketCategoryTabs categories={presentCategories} />}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] text-[var(--ink3)]">
                {category === "all" ? (
                  <>共 <span className="mono text-[var(--ink)]">{stalls.length}</span> 件商品在架</>
                ) : (
                  <>
                    <span className="font-semibold text-[var(--ink)]">{trackLabel(category)}</span>
                    {" · "}
                    <span className="mono text-[var(--ink)]">{visible.length}</span> 件在架
                  </>
                )}
              </p>
              <MarketSortTabs />
            </div>
          </div>

          {visible.length === 0 ? (
            // 分类命中空：把它变成造课机会（#13 轻量）——该赛道还没货，AI 帮你造一门（带 prompt 上下文）。
            <div className="flex flex-col items-center justify-center gap-4 rounded-[16px] border border-dashed border-[var(--border2)] bg-[var(--surface)] px-6 py-14 text-center shadow-[var(--inner-hi)]">
              <span className="grid h-12 w-12 place-items-center rounded-[14px] bg-[var(--red-soft)]">
                <Sparkle size={22} weight="fill" className="text-[var(--red)]" />
              </span>
              <div>
                <p className="text-[15px] font-bold text-[var(--ink)]">集市里还没有「{trackLabel(category)}」类课</p>
                <p className="mt-1 text-[13px] leading-[1.6] text-[var(--ink2)]">
                  你可以第一个把它造出来，摆到集市让同学们拿走。
                </p>
              </div>
              <Link
                href={createHref}
                className="cta-glow studio-press inline-flex min-h-[44px] items-center gap-2 rounded-[12px] bg-[var(--red)] px-5 py-3 text-[14px] font-bold text-white transition-all hover:brightness-105"
              >
                <Sparkle size={16} weight="fill" />
                AI 造一门「{trackLabel(category)}」课
              </Link>
            </div>
          ) : (
            /* ——— 橱窗商品网格：stagger 递延进场；items-stretch + 卡片 h-full 同行等高（问题③）——— */
            <div className="stagger grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visible.map((stall, idx) => (
                <div key={stall.id} className="h-full" style={{ "--i": idx } as React.CSSProperties}>
                  <MarketStallCard stall={stall} isLoggedIn={Boolean(user)} />
                </div>
              ))}
            </div>
          )}

          {/* ——— 底部引导：也来摆一摊（带当前分类上下文，#13 轻量）——— */}
          <Link
            href={createHref}
            className="group flex items-center justify-center gap-2 rounded-[14px] border border-dashed border-[var(--border2)] bg-[var(--surface)] px-5 py-4 text-[14px] font-semibold text-[var(--ink2)] shadow-[var(--inner-hi)] transition-colors hover:border-[var(--red)] hover:text-[var(--red)]"
          >
            <Sparkle size={16} weight="fill" className="text-[var(--red)]" />
            {category === "all" ? "造一门课，也来集市摆一摊" : `造一门「${trackLabel(category)}」课，也来摆一摊`}
            <ArrowRight size={15} weight="bold" className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        </>
      )}
    </div>
  );
}
