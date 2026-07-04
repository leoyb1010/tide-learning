"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Storefront,
  Sparkle,
  ListChecks,
  BookmarkSimple,
  Heart,
  UsersThree,
  ArrowRight,
  Gift,
  CheckCircle,
  SealCheck,
} from "@phosphor-icons/react";
import { CoverBg } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { track } from "@/lib/analytics-client";
import { trackLabel } from "@/lib/tracks";
import { abbrevCount, sellerBadge, type MarketStall } from "@/lib/market-view";

/** 摊主等级徽章配色（tier 1-4，越高越暖，克制不喧宾夺主）。 */
const BADGE_TONE: Record<1 | 2 | 3 | 4, { fg: string; bg: string; bd: string }> = {
  1: { fg: "var(--ink3)", bg: "var(--surface-inset)", bd: "var(--border)" },
  2: { fg: "var(--info)", bg: "var(--info-soft)", bd: "transparent" },
  3: { fg: "var(--warn)", bg: "var(--warn-soft)", bd: "transparent" },
  4: { fg: "var(--red-ink)", bg: "var(--red-soft)", bd: "var(--red-soft-border)" },
};

/**
 * MarketStallCard —— 集市「摊位卡」（client，v4.0 交易市场重设计）。
 *
 * 摊位隐喻：卖家(摊主)立在卡上，交易气息数字(N 人拿走 / N 收藏)，价签(免费拿走)，
 * 封面赛道渐变 + 材质精致，hover 抬升 + hover-sheen。
 *
 * 互动：
 *  - 「拿走」→ POST /api/market/collect → 乐观更新(拿走数+1、CTA 变「去学习」)
 *    + 微动效(课本飞入袋) + Toast。已在书架/本人摊位不出「拿走」。
 *  - 收藏/点赞：本地乐观 toggle（MVP 无课程收藏表，纯前端心情态；样式复用互动语言，
 *    数字随手感 +1/-1，不落库，待数据层补 favorite 后接真值即可）。
 *  - 卡片主体点进课程详情看大纲。
 *
 * 铁律：本文件 "use client"，只 fetch API + 客户端埋点，不引 server 链。
 * 动效全部 transform/opacity；reduce-motion 下 useReducedMotion 关位移，飞书动效降级为即时切换。
 */
export function MarketStallCard({
  stall,
  isLoggedIn,
}: {
  stall: MarketStall;
  isLoggedIn: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const reduce = useReducedMotion();
  const inFlight = useRef(false);

  // 拿走态：已拿走则 CTA 直接是「去学习」。
  const [collected, setCollected] = useState(stall.collectedByMe);
  const [collectCount, setCollectCount] = useState(stall.collectCount);
  const [flying, setFlying] = useState(false); // 课本入袋动效开关

  // 收藏态（本地心情，占位互动）。
  const [loved, setLoved] = useState(false);
  const [favoriteCount, setFavoriteCount] = useState(stall.favoriteCount);

  const isAi = stall.origin === "ai_generated";
  const detailHref = `/courses/${stall.slug}`;

  const badge = useMemo(() => sellerBadge(stall.collectCount), [stall.collectCount]);
  const badgeTone = BADGE_TONE[badge.tier];
  const sellerInitial = stall.seller.nickname.slice(0, 1) || "学";

  // ---------- 拿走（免费 fork 到书架）----------
  async function collect(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (inFlight.current) return;
    if (!isLoggedIn) {
      toast("登录后可把课拿到书架", { tone: "info" });
      router.push("/login?next=/market");
      return;
    }
    inFlight.current = true;

    // 乐观：先播入袋动效 + 数字 +1 + CTA 切「去学习」。
    setFlying(true);
    setCollected(true);
    setCollectCount((c) => c + 1);

    try {
      const res = await fetch("/api/market/collect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseId: stall.id }),
      });
      const json = (await res.json()) as
        | { ok: true; data: { status: string; already: boolean; message: string } }
        | { ok: false; error: string };

      if (!json.ok) {
        // 回滚乐观态。
        setCollected(stall.collectedByMe);
        setCollectCount(stall.collectCount);
        toast(json.error, { tone: "warn" });
        return;
      }
      if (json.data.already) {
        // 服务端幂等命中：本就在书架。若之前不是"我拿走的"，说明本地曾误 +1，回落基线；
        // 否则数字维持乐观值。CTA 已切"去学习"，保持不变。
        if (!stall.collectedByMe) setCollectCount(stall.collectCount);
        toast(json.data.message, { tone: "info" });
      } else {
        toast(json.data.message, { tone: "success", action: { label: "去书架", onClick: () => router.push("/me/courses") } });
        track("market_collect", { course_id: stall.id });
      }
      router.refresh();
    } catch {
      setCollected(stall.collectedByMe);
      setCollectCount(stall.collectCount);
      toast("网络异常，请重试", { tone: "warn" });
    } finally {
      inFlight.current = false;
      // 动效收尾（reduce 下瞬时结束）。
      window.setTimeout(() => setFlying(false), reduce ? 0 : 720);
    }
  }

  // ---------- 收藏（本地占位 toggle）----------
  function toggleLove(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const next = !loved;
    setLoved(next);
    setFavoriteCount((c) => Math.max(0, c + (next ? 1 : -1)));
    if (next) track("market_favorite", { course_id: stall.id });
  }

  return (
    <Link
      href={detailHref}
      className="hover-sheen studio-lift group relative flex h-full flex-col overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card),var(--inner-hi)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] hover:border-[var(--border2)]"
      aria-label={`查看课程《${stall.title}》大纲`}
    >
      {/* ——— 封面：赛道渐变 + 封面池；徽标 + 价签 + 拿走热度 ——— */}
      <CoverBg
        color={stall.coverColor}
        imageSrc={stall.coverSrc}
        alt={stall.title}
        className="aspect-[16/9] w-full"
      >
        {/* 来源徽标 */}
        <div className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-[var(--ink)]/40 px-2.5 py-1 text-[0.68rem] font-semibold text-white backdrop-blur-sm">
          {isAi ? <Sparkle size={11} weight="fill" /> : <ListChecks size={11} weight="fill" />}
          {isAi ? "AI 造课" : "整理导入"}
        </div>

        {/* 价签：免费拿走（预留积分价样式；MVP 全免费） */}
        <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-white/92 px-2.5 py-1 text-[0.68rem] font-extrabold text-[var(--ok)] shadow-[0_1px_3px_rgba(35,41,53,.2)] backdrop-blur-sm">
          <Gift size={12} weight="fill" />
          免费拿走
        </div>

        {/* 拿走热度气泡（左下，交易气息） */}
        {collectCount > 0 && (
          <div className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-[var(--ink)]/50 px-2.5 py-1 text-[0.66rem] font-semibold text-white backdrop-blur-sm">
            <BookmarkSimple size={11} weight="fill" />
            <span className="mono">{abbrevCount(collectCount)}</span> 人拿走
          </div>
        )}

        {/* 课本入袋动效：一枚小书从封面飞向价签方向（入袋隐喻）。 */}
        <AnimatePresence>
          {flying && !reduce && (
            <motion.span
              key="fly"
              initial={{ opacity: 0, scale: 0.6, x: 0, y: 0 }}
              animate={{ opacity: [0, 1, 1, 0], scale: [0.6, 1.1, 0.9, 0.5], x: [0, 40, 90], y: [0, -18, 8] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.72, times: [0, 0.25, 0.6, 1], ease: "easeInOut" }}
              className="pointer-events-none absolute left-1/2 top-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[10px] bg-white text-[var(--red)] shadow-[var(--lift)]"
            >
              <BookmarkSimple size={18} weight="fill" />
            </motion.span>
          )}
        </AnimatePresence>
      </CoverBg>

      {/* ——— 卡身 ——— */}
      <div className="flex flex-1 flex-col p-4">
        <div className="mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink4)]">
          {trackLabel(stall.category)}
        </div>
        <h3 className="mt-1.5 line-clamp-2 text-[15px] font-bold leading-snug tracking-tight text-[var(--ink)]">
          {stall.title}
        </h3>
        {stall.subtitle && (
          <p className="mt-1 line-clamp-2 text-[13px] leading-[1.55] text-[var(--ink2)]">{stall.subtitle}</p>
        )}

        {/* 摊主：头像 + 昵称 + 等级徽章（摊主立在卡上） */}
        <div className="mt-3 flex items-center gap-2 rounded-[12px] bg-[var(--surface-inset)] px-2.5 py-2 shadow-[var(--inner-hi)]">
          {stall.seller.avatarUrl ? (
            <img
              src={stall.seller.avatarUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-[var(--border2)]"
            />
          ) : (
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--red-soft)] text-[11px] font-bold text-[var(--red-ink)] ring-1 ring-[var(--red-soft-border)]">
              {sellerInitial}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1">
              <span className="truncate text-[12.5px] font-semibold text-[var(--ink)]">{stall.seller.nickname}</span>
              {badge.tier >= 3 && <SealCheck size={12} weight="fill" className="shrink-0 text-[var(--red)]" />}
            </span>
            <span
              className="mt-0.5 inline-flex items-center rounded-full border px-1.5 py-[1px] text-[10px] font-semibold"
              style={{ color: badgeTone.fg, background: badgeTone.bg, borderColor: badgeTone.bd }}
            >
              {badge.label}
            </span>
          </span>
        </div>

        {/* 交易气息数字条：拿走 · 收藏 · 学习人数 */}
        <div className="mt-3 flex items-center gap-3 text-[11.5px] text-[var(--ink3)]">
          <span className="flex items-center gap-1" title="被拿走到书架的人数">
            <BookmarkSimple size={13} weight="fill" className="text-[var(--ink4)]" />
            <span className="mono text-[var(--ink2)]">{abbrevCount(collectCount)}</span> 拿走
          </span>
          <span className="h-3 w-px bg-[var(--border)]" />
          <button
            type="button"
            onClick={toggleLove}
            className="studio-press flex items-center gap-1 rounded-full px-1 py-0.5 transition-colors hover:text-[var(--red)]"
            aria-pressed={loved}
            aria-label={loved ? "取消收藏" : "收藏这门课"}
          >
            <Heart size={13} weight={loved ? "fill" : "regular"} className={loved ? "text-[var(--red)]" : "text-[var(--ink4)]"} />
            <span className={`mono ${loved ? "text-[var(--red)]" : "text-[var(--ink2)]"}`}>{abbrevCount(favoriteCount)}</span> 收藏
          </button>
          {stall.learnersCount > 0 && (
            <>
              <span className="h-3 w-px bg-[var(--border)]" />
              <span className="flex items-center gap-1" title="累计学习人数">
                <UsersThree size={13} weight="fill" className="text-[var(--ink4)]" />
                <span className="mono text-[var(--ink2)]">{abbrevCount(stall.learnersCount)}</span> 在学
              </span>
            </>
          )}
        </div>

        {/* ——— 拿走 CTA（关键红，唯一强调）——— */}
        <div className="mt-auto pt-3.5">
          {stall.mine ? (
            <span className="inline-flex w-full items-center justify-center gap-1.5 rounded-[11px] border border-[var(--border)] bg-[var(--surface-inset)] px-4 py-2.5 text-[13px] font-semibold text-[var(--ink3)]">
              <Storefront size={14} weight="fill" className="text-[var(--red)]" />
              你的摊位
            </span>
          ) : collected ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                router.push(detailHref);
              }}
              className="studio-press inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-[11px] border border-[var(--border2)] bg-[var(--surface)] px-4 py-2.5 text-[13px] font-bold text-[var(--ink)] transition-all hover:border-[var(--red)] hover:text-[var(--red)]"
            >
              <CheckCircle size={15} weight="fill" className="text-[var(--ok)]" />
              已在书架 · 去学习
              <ArrowRight size={14} weight="bold" />
            </button>
          ) : (
            <button
              type="button"
              onClick={collect}
              className="cta-glow studio-press inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-[11px] bg-[var(--red)] px-4 py-2.5 text-[13px] font-bold text-white transition-all hover:brightness-105"
            >
              <BookmarkSimple size={15} weight="fill" />
              免费拿走
            </button>
          )}
        </div>
      </div>
    </Link>
  );
}
