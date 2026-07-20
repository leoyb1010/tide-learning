import { notFound } from "next/navigation";
import Link from "next/link";
import {
  Storefront,
  Sparkle,
  ListChecks,
  BookmarkSimple,
  UsersThree,
  Gift,
  Handbag,
  SealCheck,
  Clock,
  LockSimple,
  Play,
  ArrowLeft,
  Coins,
  Package,
  ShieldCheck,
} from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { buildStallDetail } from "@/lib/market-data";
import { CoverBg } from "@/components/ui";
import { RatingStars } from "@/components/RatingStars";
import { MarketBuyPanel } from "@/components/market/MarketBuyPanel";
import { formatDurationSec } from "@/lib/format";
import { trackLabel, trackGradientVar } from "@/lib/tracks";
import { formatPrice, abbrevCount, sellerBadge } from "@/lib/market-view";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const detail = await buildStallDetail(slug, null);
  if (!detail) return { title: "商品不存在" };
  return { title: `${detail.stall.title} · 集市商品`, description: detail.description ?? "" };
}

/**
 * /market/[slug] —— 集市「商品详情页」（server, S4 §问题⑪·③）。
 *
 * 定位：点课卡先进「商品页」（不直接进学习台）——评分 / 大纲预览 / 作者店铺 / 价格 / 成交，
 *   确认购买或免费拿走后才进学习。区别于 /courses/[id]（订阅课详情），此页强调**商品化信息**：
 *   价签、成交热度、作者店铺（在架几门 / 累计成交 / 等级），塑造线上交易市场质感。
 *
 * 数据：buildStallDetail(slug, viewerId)——只暴露 sharedStatus="shared" 的在架课；
 *   collectedByMe / mine 严格 where userId（越权铁律）。评分为占位派生（评价系统 S5）。
 * 交易：购买/拿走交互全在 client 的 <MarketBuyPanel>（本 server 页只查库 + 组装视图）。
 */
export default async function MarketProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const [user, { slug }] = await Promise.all([getCurrentUser(), params]);
  const detail = await buildStallDetail(slug, user?.id ?? null);
  if (!detail) notFound();

  const { stall, lessons, shop, rating, description } = detail;
  const price = formatPrice(stall.priceCredits);
  const badge = sellerBadge(shop.totalCollects);
  const isAi = stall.origin === "ai_generated";
  const sellerInitial = stall.seller.nickname.slice(0, 1) || "学";

  // 成交热度：付费看销量，免费看被拿走数（统一「N 人入手」信号）。
  const tradeCount = stall.isPaid ? stall.salesCount : stall.collectCount;
  const freeLessonCount = lessons.filter((l) => l.isFree).length;
  const totalDurationSec = lessons.reduce((s, l) => s + l.durationSec, 0);

  // 进学习：第 1 节 lesson（拿走后书架落地即在此节起始）。学习台路由与 S3 一致。
  const firstLesson = lessons[0];
  const learnHref = firstLesson ? `/courses/${stall.slug}/learn/${firstLesson.id}` : `/courses/${stall.slug}`;

  // 审计修复(2026-07-19)：试读入口与 preview 页同口径——免费节须有 htmlJson,否则按钮是 404 死链。
  const previewable =
    lessons.some((l) => l.isFree) &&
    (await prisma.lesson.count({
      where: { courseId: stall.id, isFree: true, status: "published", htmlJson: { not: null } },
    })) > 0;

  return (
    <div className="studio-rise mx-auto flex w-full max-w-[1120px] flex-col gap-6">
      {/* ——— 面包屑：返回集市 ——— */}
      <Link
        href="/market"
        className="group inline-flex w-fit items-center gap-1.5 text-[13px] font-medium text-[var(--ink3)] transition-colors hover:text-[var(--red)]"
      >
        <ArrowLeft size={15} weight="bold" className="transition-transform group-hover:-translate-x-0.5" />
        返回集市
      </Link>

      <div className="grid items-start gap-6 lg:grid-cols-[1.5fr_.95fr]">
        {/* ================= 左列：商品陈列 ================= */}
        <div className="flex flex-col gap-6">
          {/* ——— 封面橱窗 ——— */}
          <CoverBg
            color={stall.coverColor}
            imageSrc={stall.coverSrc}
            alt={stall.title}
            className="aspect-[16/9] w-full overflow-hidden rounded-[20px] shadow-[var(--lift)]"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-30 mix-blend-multiply"
              style={{ background: trackGradientVar(stall.category) }}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "linear-gradient(to bottom, rgba(15,17,21,.5) 0%, rgba(15,17,21,0) 34%, rgba(15,17,21,0) 58%, rgba(15,17,21,.6) 100%)",
              }}
            />
            {/* 来源徽标 */}
            <div className="absolute left-4 top-4 flex items-center gap-1 rounded-full bg-[var(--ink)]/40 px-3 py-1.5 text-[12px] font-semibold text-white backdrop-blur-sm">
              {isAi ? <Sparkle size={13} weight="fill" /> : <ListChecks size={13} weight="fill" />}
              {isAi ? "AI 造课" : "整理导入"}
            </div>
            {/* 价签（右上，交易市场核心） */}
            <div className="absolute right-4 top-4 flex items-center gap-1.5 rounded-full bg-white/95 px-3.5 py-1.5 text-[13px] font-extrabold shadow-[0_2px_8px_rgba(35,41,53,.25)] backdrop-blur-sm">
              {price.free ? (
                <span className="flex items-center gap-1 text-[var(--ok)]">
                  <Gift size={14} weight="fill" />
                  免费
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[var(--red)]">
                  <Coins size={14} weight="fill" />
                  <span className="mono">{price.amount}</span> 积分
                </span>
              )}
            </div>
            {/* 成交热度（左下） */}
            {tradeCount > 0 && (
              <div className="absolute bottom-4 left-4 flex items-center gap-1.5 rounded-full bg-[var(--ink)]/50 px-3 py-1.5 text-[12px] font-semibold text-white backdrop-blur-sm">
                <Package size={13} weight="fill" />
                已有 <span className="mono">{abbrevCount(tradeCount)}</span> 人{stall.isPaid ? "入手" : "拿走"}
              </div>
            )}
          </CoverBg>

          {/* ——— 商品标题区 ——— */}
          <header className="flex flex-col gap-3">
            <div className="mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink4)]">
              {trackLabel(stall.category)}
            </div>
            <h1 className="text-[clamp(24px,3.5vw,30px)] font-extrabold leading-[1.25] tracking-tight text-[var(--ink)]">
              {stall.title}
            </h1>
            {/* 评分 + 成交 */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <RatingStars score={rating.score} count={rating.count} placeholder={rating.isPlaceholder} size={15} />
              <span className="h-3.5 w-px bg-[var(--border)]" />
              <span className="flex items-center gap-1.5 text-[13px] text-[var(--ink2)]">
                <Package size={15} weight="fill" className="text-[var(--ink4)]" />
                <span className="mono font-semibold text-[var(--ink)]">{abbrevCount(tradeCount)}</span>
                人{stall.isPaid ? "入手" : "拿走"}
              </span>
            </div>
            {stall.subtitle && (
              <p className="text-[16px] leading-[1.6] text-[var(--ink)]">{stall.subtitle}</p>
            )}
            {description && description !== stall.subtitle && (
              <p className="text-[14px] leading-[1.78] text-[var(--ink2)]">{description}</p>
            )}
          </header>

          {/* ——— 指标带：节数 / 时长 / 在学 ——— */}
          <div className="grid grid-cols-3 divide-x divide-[var(--border)] overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card),var(--inner-hi)]">
            <ProductStat icon={<ListChecks size={16} weight="bold" />} value={`${lessons.length}`} unit="节" label="总课时" />
            <ProductStat icon={<Clock size={16} weight="bold" />} value={formatDurationSec(totalDurationSec)} label="总时长" />
            <ProductStat icon={<UsersThree size={16} weight="bold" />} value={abbrevCount(stall.learnersCount)} label="在学人数" />
          </div>

          {/* ——— 大纲预览 ——— */}
          <div>
            <div className="mb-3 flex items-baseline justify-between">
              <div className="flex items-baseline gap-2.5">
                <h2 className="text-[18px] font-bold text-[var(--ink)]">课程大纲</h2>
                <span className="text-[13px] text-[var(--ink3)]">买前先看学什么</span>
              </div>
              {freeLessonCount > 0 && (
                <span className="text-[12px] text-[var(--ink3)]">
                  <span className="mono font-semibold text-[var(--ink)]">{freeLessonCount}</span> 节免费试看
                </span>
              )}
            </div>
            <ul className="stagger overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card),var(--inner-hi)]">
              {lessons.map((l, i) => {
                // 商品页大纲预览：免费节标「试看」、其余在拿走/购买前视为锁定（不给直链）。
                const previewable = l.isFree;
                return (
                  <li
                    key={l.id}
                    style={{ "--i": i } as React.CSSProperties}
                    className="border-b border-[var(--border)] last:border-b-0"
                  >
                    <div className="flex items-center gap-3.5 px-[18px] py-3.5">
                      <span className="mono w-[26px] shrink-0 text-center text-[13px] text-[var(--ink4)]">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-[14px] font-medium text-[var(--ink)]">{l.title}</span>
                          {previewable && (
                            <span className="rounded-full bg-[var(--ok-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ok)]">
                              试看
                            </span>
                          )}
                        </div>
                        {l.summary && <p className="mt-0.5 truncate text-[12px] text-[var(--ink4)]">{l.summary}</p>}
                      </div>
                      <span className="mono shrink-0 text-[12px] text-[var(--ink4)]">{formatDurationSec(l.durationSec)}</span>
                      <span className="flex w-[22px] shrink-0 items-center justify-end">
                        {previewable ? (
                          <Play size={15} weight="fill" className="text-[var(--ink4)]" />
                        ) : (
                          <LockSimple size={15} className="text-[var(--ink4)]" />
                        )}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
            {/* 蓝图 D4 入口：集市商品页免登录试读首个免费课件——「先看货再决定拿走/购买」的转化钩子。 */}
            {previewable && (
              <Link
                href={`/courses/${stall.slug || stall.id}/preview`}
                className="studio-press mt-3 inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[13px] font-semibold text-[var(--ink)] shadow-[var(--card)]"
              >
                <Play size={14} weight="fill" className="text-[var(--red)]" /> 免登录试读课件
              </Link>
            )}
          </div>
        </div>

        {/* ================= 右列 sticky：交易卡 ================= */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
          {/* 交易卡 */}
          <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card),var(--inner-hi)]">
            {/* 价格 */}
            <div className="flex items-end justify-between">
              <div>
                <span className="mono block text-[11px] uppercase tracking-[0.1em] text-[var(--ink4)]">价格</span>
                {price.free ? (
                  <span className="mt-0.5 flex items-center gap-1.5 text-[26px] font-extrabold leading-none text-[var(--ok)]">
                    <Gift size={22} weight="fill" />
                    免费
                  </span>
                ) : (
                  <span className="mt-0.5 flex items-baseline gap-1 leading-none">
                    <span className="mono text-[32px] font-extrabold text-[var(--red)]">{price.amount}</span>
                    <span className="text-[14px] font-semibold text-[var(--ink3)]">积分</span>
                  </span>
                )}
              </div>
              {tradeCount > 0 && (
                <span className="rounded-full border border-[var(--border)] bg-[var(--surface-inset)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink3)]">
                  {abbrevCount(tradeCount)} 人已{stall.isPaid ? "入手" : "拿走"}
                </span>
              )}
            </div>

            {/* CTA：本人摊位 / 购买 / 拿走 */}
            <div className="mt-4">
              {stall.mine ? (
                <span className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-[14px] border border-[var(--border)] bg-[var(--surface-inset)] px-6 text-[14px] font-semibold text-[var(--ink3)]">
                  <Storefront size={16} weight="fill" className="text-[var(--red)]" />
                  这是你的摊位
                </span>
              ) : (
                <MarketBuyPanel
                  courseId={stall.id}
                  slug={stall.slug}
                  title={stall.title}
                  priceCredits={stall.priceCredits}
                  isLoggedIn={Boolean(user)}
                  initialCollected={stall.collectedByMe}
                  learnHref={learnHref}
                />
              )}
            </div>

            {/* 交易信任点 */}
            <ul className="mt-4 space-y-2 border-t border-[var(--border)] pt-4 text-[13px] leading-[1.5] text-[var(--ink2)]">
              <li className="flex items-start gap-2">
                <ShieldCheck size={14} weight="fill" className="mt-0.5 shrink-0 text-[var(--ok)]" />
                <span>{price.free ? "免费拿走，永久进入你的书架" : "购买后永久进入书架，随课更新持续获得新内容"}</span>
              </li>
              <li className="flex items-start gap-2">
                <BookmarkSimple size={14} weight="fill" className="mt-0.5 shrink-0 text-[var(--ok)]" />
                <span>边学边记，笔记与截帧永久保留</span>
              </li>
              {!price.free && (
                <li className="flex items-start gap-2">
                  <Coins size={14} weight="fill" className="mt-0.5 shrink-0 text-[var(--ok)]" />
                  <span>积分不足可随时充值，作者获得收益分成</span>
                </li>
              )}
            </ul>
          </div>

          {/* 作者店铺卡（店主代入感） */}
          <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card),var(--inner-hi)]">
            <span className="mono mb-3 block text-[11px] uppercase tracking-[0.1em] text-[var(--ink4)]">摊主 · 店铺</span>
            <div className="flex items-center gap-3">
              {stall.seller.avatarUrl ? (

                <img
                  src={stall.seller.avatarUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-[var(--border2)]"
                />
              ) : (
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--red-soft)] text-[15px] font-bold text-[var(--red-ink)] ring-1 ring-[var(--red-soft-border)]">
                  {sellerInitial}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[14px] font-bold text-[var(--ink)]">{stall.seller.nickname}</span>
                  {badge.tier >= 3 && <SealCheck size={14} weight="fill" className="shrink-0 text-[var(--red)]" />}
                </div>
                <span className="mt-0.5 inline-flex items-center rounded-full border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-2 py-[1px] text-[10px] font-semibold text-[var(--red-ink)]">
                  {badge.label}
                </span>
              </div>
            </div>
            {/* 店铺经营数据 */}
            <div className="mt-4 grid grid-cols-3 divide-x divide-[var(--border)] overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-inset)]">
              <ShopStat value={`${shop.stallCount}`} label="在架课" />
              <ShopStat value={abbrevCount(shop.totalCollects)} label="累计拿走" />
              <ShopStat value={abbrevCount(shop.totalSales)} label="付费成交" />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ============ 页面专属子组件 ============ */

/** 商品指标带单元：图标 + 数值(+单位) + 标签，居中，供三等分材质带用。 */
function ProductStat({ icon, value, unit, label }: { icon: React.ReactNode; value: string; unit?: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-2 py-3.5">
      <span className="text-[var(--ink3)]">{icon}</span>
      <div className="mono text-[18px] font-extrabold leading-none tracking-tight text-[var(--ink)]">
        {value}
        {unit && <span className="ml-0.5 text-[12px] font-semibold text-[var(--ink3)]">{unit}</span>}
      </div>
      <div className="text-[11px] text-[var(--ink4)]">{label}</div>
    </div>
  );
}

/** 店铺经营数字单元（三等分，紧凑）。 */
function ShopStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-2 py-3">
      <span className="mono text-[16px] font-extrabold leading-none text-[var(--ink)]">{value}</span>
      <span className="text-[11px] text-[var(--ink4)]">{label}</span>
    </div>
  );
}
