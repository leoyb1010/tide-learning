import Link from "next/link";
import {
  Storefront,
  Sparkle,
  SignIn,
  TrendUp,
  BookmarkSimple,
  Confetti,
  ArrowRight,
} from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { resolveCoverSrc } from "@/lib/tracks";
import { MarketStallCard } from "@/components/market/MarketStallCard";
import { MarketSortTabs } from "@/components/market/MarketSortTabs";
import {
  normalizeSort,
  sortStalls,
  abbrevCount,
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
 * 收藏数占位（MVP 无课程收藏表）：用 courseId 稳定散列出一个与拿走量正相关的伪值，
 * 同课刷新不跳、热门课收藏更高，视觉上是"合理占位"。数据层补真值后，删此函数改读真实字段即可。
 */
function placeholderFavorites(courseId: string, collectCount: number): number {
  let h = 5381;
  for (let i = 0; i < courseId.length; i++) h = (h * 33) ^ courseId.charCodeAt(i);
  const noise = (h >>> 0) % 7; // 0-6 的稳定抖动
  return Math.round(collectCount * 0.6) + noise;
}

/**
 * /market —— 课程集市「交易市场」（server, v4.0 重设计）。
 *
 * 结构：今日集市氛围条 + 摊位卡网格（stagger 进场）+ 排序切换 + 空态引导。
 * 数据：sharedStatus="shared" 的用户造课；每课派生 拿走数(去重学习用户)/学习人数/摊主，
 *   收藏数为占位（无收藏表）。排序 ?sort=hot|new|loved 由 URL 驱动，server 端重排。
 * 越权：登录用户预取"我拿走过哪些课"（where userId=我）决定 CTA 初始态；自己的课标"你的摊位"。
 * 铁律：本 server 组件只查库 + 组装视图模型，交互(拿走/收藏/排序)全在 client 子组件。
 */
export default async function MarketPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const [user, sp] = await Promise.all([getCurrentUser(), searchParams]);
  const sort = normalizeSort(sp.sort);

  // 已上架课：作者归属 + 学习人数 + 上新时间。
  const courses = await prisma.course.findMany({
    where: { sharedStatus: "shared" },
    orderBy: { lastUpdatedAt: "desc" },
    take: 60,
    select: {
      id: true,
      slug: true,
      title: true,
      subtitle: true,
      description: true,
      category: true,
      coverColor: true,
      origin: true,
      authorUserId: true,
      learnersCount: true,
      createdAt: true,
    },
  });

  const courseIds = courses.map((c) => c.id);

  // 每门课「拿走数」= 有该课学习记录的去重用户数（collect 建起始 LearningProgress）。
  // 按 (courseId,userId) 分组去重后按课累加。
  const collectRows =
    courseIds.length > 0
      ? await prisma.learningProgress.groupBy({
          by: ["courseId", "userId"],
          where: { courseId: { in: courseIds } },
        })
      : [];
  const collectCountMap = new Map<string, number>();
  for (const r of collectRows) {
    collectCountMap.set(r.courseId, (collectCountMap.get(r.courseId) ?? 0) + 1);
  }

  // 我拿走过哪些课（越权铁律：where userId=我）——决定 CTA 初始态。
  const myCollectedSet = new Set<string>();
  if (user && courseIds.length > 0) {
    const mine = await prisma.learningProgress.groupBy({
      by: ["courseId"],
      where: { userId: user.id, courseId: { in: courseIds } },
    });
    for (const r of mine) myCollectedSet.add(r.courseId);
  }

  // 作者昵称 + 头像（一次查完）。
  const authorIds = Array.from(
    new Set(courses.map((c) => c.authorUserId).filter((x): x is string => Boolean(x))),
  );
  const authors =
    authorIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: authorIds } },
          select: { id: true, nickname: true, avatarUrl: true },
        })
      : [];
  const authorMap = new Map(authors.map((a) => [a.id, a]));

  // ——— 组装摊位视图模型 ———
  const stalls: MarketStall[] = courses.map((c) => {
    const collectCount = collectCountMap.get(c.id) ?? 0;
    const seller = c.authorUserId ? authorMap.get(c.authorUserId) : undefined;
    return {
      id: c.id,
      slug: c.slug,
      title: c.title,
      subtitle: c.subtitle ?? c.description ?? null,
      category: c.category,
      coverColor: c.coverColor,
      coverSrc: resolveCoverSrc(c.slug, c.category ?? "", c.id),
      origin: c.origin,
      collectCount,
      favoriteCount: placeholderFavorites(c.id, collectCount),
      learnersCount: c.learnersCount,
      collectedByMe: myCollectedSet.has(c.id),
      mine: Boolean(user && c.authorUserId === user.id),
      createdAtMs: c.createdAt.getTime(),
      seller: {
        id: c.authorUserId,
        nickname: seller?.nickname ?? "匿名同学",
        avatarUrl: seller?.avatarUrl ?? null,
      },
    };
  });

  const sorted = sortStalls(stalls, sort);

  // ——— 今日集市氛围数据 ———
  const todayStart = startOfTodayMs();
  const newTodayCount = stalls.filter((s) => s.createdAtMs >= todayStart).length;
  const totalCollects = stalls.reduce((sum, s) => sum + s.collectCount, 0);
  const hottest = stalls.reduce<MarketStall | null>(
    (best, s) => (!best || s.collectCount > best.collectCount ? s : best),
    null,
  );

  return (
    <div className="studio-rise mx-auto flex w-full max-w-[1280px] flex-col gap-6">
      {/* ——— 头部 ——— */}
      <header className="flex flex-col gap-2">
        <div className="mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink4)]">
          COURSE MARKET
        </div>
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-[var(--red-soft)]">
            <Storefront size={18} weight="fill" className="text-[var(--red)]" />
          </span>
          <h1 className="text-[26px] font-extrabold tracking-tight text-[var(--ink)]">课程集市</h1>
        </div>
        <p className="text-[14px] text-[var(--ink2)]">
          同学们用 AI 摆出的课摊，逛一逛，看中就免费拿走到自己的书架。
        </p>
      </header>

      {/* ——— 今日集市氛围条 ——— */}
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
              {hottest && hottest.collectCount > 0 ? (
                <Link
                  href={`/courses/${hottest.slug}`}
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

          {/* 累计被拿走 */}
          <div
            style={{ "--i": 2 } as React.CSSProperties}
            className="elev-1 flex items-center gap-3 rounded-[14px] px-4 py-3"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[var(--info-soft)]">
              <BookmarkSimple size={17} weight="fill" className="text-[var(--info)]" />
            </span>
            <span className="min-w-0">
              <span className="mono block text-[10px] uppercase tracking-[0.1em] text-[var(--ink4)]">累计被拿走</span>
              <span className="block text-[14px] font-bold text-[var(--ink)]">
                <span className="mono">{abbrevCount(totalCollects)}</span> 次
              </span>
            </span>
          </div>
        </div>
      )}

      {/* ——— 未登录引导 ——— */}
      {!user && stalls.length > 0 && (
        <div className="flex flex-col items-center justify-between gap-3 rounded-[14px] border border-[var(--border)] bg-[var(--surface-inset)] px-5 py-4 shadow-[var(--inner-hi)] sm:flex-row">
          <p className="text-[13.5px] text-[var(--ink2)]">登录后可把喜欢的课免费拿到你的书架。</p>
          <Link
            href="/login?next=/market"
            className="cta-glow studio-press inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-[11px] bg-[var(--red)] px-4 py-2 text-[13px] font-bold text-white transition-all hover:brightness-105"
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
            <p className="mt-1 text-[13.5px] leading-[1.6] text-[var(--ink2)]">
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
          {/* ——— 排序切换 ——— */}
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] text-[var(--ink3)]">
              共 <span className="mono text-[var(--ink)]">{stalls.length}</span> 个课摊
            </p>
            <MarketSortTabs />
          </div>

          {/* ——— 摊位卡网格：stagger 递延进场 ——— */}
          <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {sorted.map((stall, idx) => (
              <div key={stall.id} style={{ "--i": idx } as React.CSSProperties}>
                <MarketStallCard stall={stall} isLoggedIn={Boolean(user)} />
              </div>
            ))}
          </div>

          {/* ——— 底部引导：也来摆一摊 ——— */}
          <Link
            href="/create"
            className="group flex items-center justify-center gap-2 rounded-[14px] border border-dashed border-[var(--border2)] bg-[var(--surface)] px-5 py-4 text-[13.5px] font-semibold text-[var(--ink2)] shadow-[var(--inner-hi)] transition-colors hover:border-[var(--red)] hover:text-[var(--red)]"
          >
            <Sparkle size={16} weight="fill" className="text-[var(--red)]" />
            造一门课，也来集市摆一摊
            <ArrowRight size={15} weight="bold" className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        </>
      )}
    </div>
  );
}
