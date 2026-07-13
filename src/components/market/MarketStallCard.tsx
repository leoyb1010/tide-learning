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
  UsersThree,
  ArrowRight,
  Gift,
  Coins,
  Handbag,
  CheckCircle,
  SealCheck,
  Package,
} from "@phosphor-icons/react";
import { CoverBg } from "@/components/ui";
import { RatingStars } from "@/components/RatingStars";
import { useToast } from "@/components/Toast";
import { track } from "@/lib/analytics-client";
import { trackLabel, trackGradientVar } from "@/lib/tracks";
import { abbrevCount, sellerBadge, formatPrice, tradeVolume, type MarketStall } from "@/lib/market-view";

/** 摊主等级徽章配色（tier 1-4，越高越暖，克制不喧宾夺主）。 */
const BADGE_TONE: Record<1 | 2 | 3 | 4, { fg: string; bg: string; bd: string }> = {
  1: { fg: "var(--ink3)", bg: "var(--surface-inset)", bd: "var(--border)" },
  2: { fg: "var(--info)", bg: "var(--info-soft)", bd: "transparent" },
  3: { fg: "var(--warn)", bg: "var(--warn-soft)", bd: "transparent" },
  4: { fg: "var(--red-ink)", bg: "var(--red-soft)", bd: "var(--red-soft-border)" },
};

/**
 * MarketStallCard —— 集市「橱窗商品卡」（client, S4 交易市场重设计 §问题⑪·①②③）。
 *
 * 交易市场隐喻：橱窗式陈列，每卡是一件「商品」——封面 + 标题 + 摊主(店主感) + **价签(免费/N积分)**
 *   + **成交/评分** + CTA。点卡进**商品详情页**（/market/[slug]，看评价/大纲/店铺/价格），
 *   不直接进学习台；确认购买/拿走后才进学习（闭环在详情页的 <MarketBuyPanel>）。
 *
 * 卡上互动（快捷通道，降低摩擦）：
 *  - 免费课「免费拿走」→ 卡上直接 POST /api/market/collect + 乐观更新(成交+1、CTA 变「去学习」)
 *    + 入袋动效 + Toast「去书架」。付费课不在卡上直接扣款——「查看购买」跳详情页确认，
 *    避免误触扣积分（大额操作需商品页确认层）。
 *  - 本人摊位显示「你的摊位」。
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
  // 成交热度乐观值（免费课看拿走数、付费课看销量，统一口径见 tradeVolume）。
  const [volume, setVolume] = useState(tradeVolume(stall));
  const [flying, setFlying] = useState(false); // 入袋动效开关

  const isAi = stall.origin === "ai_generated";
  const price = formatPrice(stall.priceCredits);
  const detailHref = `/market/${stall.slug}`;

  // 价签智能化（U4-a）：付费课 + 未拥有 + 订阅覆盖本赛道 → 价签/CTA 显示「订阅已含」而非价格，
  // 让已订阅用户明确「不必再花积分」。免费课、已拥有、本人摊位、未订阅均不触发（照常）。
  const subCovered = Boolean(stall.subscriptionCovered) && stall.isPaid && !collected && !stall.mine;

  const badge = useMemo(() => sellerBadge(stall.collectCount), [stall.collectCount]);
  const badgeTone = BADGE_TONE[badge.tier];
  // 评分读数据层已算好的字段（S5）：有真实评价读真实、零评价占位派生，卡片不再自行派生。
  const sellerInitial = stall.seller.nickname.slice(0, 1) || "学";

  // ---------- 免费拿走（卡上快捷 fork 到书架；付费课不走此路，跳详情页确认）----------
  async function collectFree(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (inFlight.current) return;
    if (!isLoggedIn) {
      toast("登录后可把课拿到书架", { tone: "info" });
      router.push(`/login?next=/market/${stall.slug}`);
      return;
    }
    inFlight.current = true;

    // 乐观：先播入袋动效 + 成交 +1 + CTA 切「去学习」。
    setFlying(true);
    setCollected(true);
    setVolume((c) => c + 1);

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
        setVolume(tradeVolume(stall));
        toast(json.error, { tone: "warn" });
        return;
      }
      if (json.data.already) {
        // 服务端幂等命中：本就在书架。若之前不是"我拿走的"，说明本地曾误 +1，回落基线。
        if (!stall.collectedByMe) setVolume(tradeVolume(stall));
        toast(json.data.message, { tone: "info" });
      } else {
        toast(json.data.message, {
          tone: "success",
          action: { label: "去书架", onClick: () => router.push("/desk?shelf=1") },
        });
        track("market_collect", { course_id: stall.id });
      }
      router.refresh();
    } catch {
      setCollected(stall.collectedByMe);
      setVolume(tradeVolume(stall));
      toast("网络异常，请重试", { tone: "warn" });
    } finally {
      inFlight.current = false;
      window.setTimeout(() => setFlying(false), reduce ? 0 : 720);
    }
  }

  return (
    <Link
      href={detailHref}
      className="hover-sheen studio-lift group relative flex h-full flex-col overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card),var(--inner-hi)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] hover:border-[var(--border2)]"
      aria-label={`查看商品《${stall.title}》· ${price.label}`}
    >
      {/* ——— 封面橱窗：赛道渐变(底) + 背景图 + 融合/暗化层；徽标 + 价签 + 成交热度 ——— */}
      <CoverBg
        color={stall.coverColor}
        imageSrc={stall.coverSrc}
        alt={stall.title}
        className="aspect-[16/9] w-full"
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
              "linear-gradient(to bottom, rgba(15,17,21,.5) 0%, rgba(15,17,21,0) 34%, rgba(15,17,21,0) 60%, rgba(15,17,21,.55) 100%)",
          }}
        />

        {/* 来源徽标 */}
        <div className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-[var(--ink)]/40 px-2.5 py-1 text-[0.68rem] font-semibold text-white backdrop-blur-sm">
          {isAi ? <Sparkle size={11} weight="fill" /> : <ListChecks size={11} weight="fill" />}
          {isAi ? "AI 造课" : "整理导入"}
        </div>

        {/* 价签：订阅已含 / 免费 / N 积分（交易市场核心信号）。
            价签智能化（U4-a）：已订阅覆盖本赛道的付费课显示「订阅已含」（info 蓝，弱化价格焦虑），
            否则免费绿 / 付费红。已拥有的课不出订阅标（下方 CTA 直接「去学习」）。 */}
        <div
          className={`absolute right-3 top-3 flex items-center gap-1 rounded-full bg-white/92 px-2.5 py-1 text-[0.68rem] font-extrabold shadow-[0_1px_3px_rgba(35,41,53,.2)] backdrop-blur-sm ${
            subCovered ? "text-[var(--info)]" : price.free ? "text-[var(--ok)]" : "text-[var(--red)]"
          }`}
        >
          {subCovered ? (
            <>
              <SealCheck size={12} weight="fill" />
              订阅已含
            </>
          ) : price.free ? (
            <>
              <Gift size={12} weight="fill" />
              免费
            </>
          ) : (
            <>
              <Coins size={12} weight="fill" />
              <span className="mono">{price.amount}</span> 积分
            </>
          )}
        </div>

        {/* 成交热度气泡（左下，交易气息） */}
        {volume > 0 && (
          <div className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-[var(--ink)]/50 px-2.5 py-1 text-[0.66rem] font-semibold text-white backdrop-blur-sm">
            <Package size={11} weight="fill" />
            <span className="mono">{abbrevCount(volume)}</span> 人{stall.isPaid ? "入手" : "拿走"}
          </div>
        )}

        {/* 入袋动效：一枚购物袋从封面飞向价签方向（入袋隐喻）。 */}
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
              <Handbag size={18} weight="fill" />
            </motion.span>
          )}
        </AnimatePresence>
      </CoverBg>

      {/* ——— 卡身 ——— */}
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink4)]">
            {trackLabel(stall.category)}
          </div>
          {/* 评分（S5）：读数据层 ratingScore，有真实评价读真实、零评价占位派生；卡上不显条数 */}
          <RatingStars score={stall.ratingScore} count={stall.ratingCount} showCount={false} size={12} className="shrink-0" />
        </div>
        {/* 对齐规范（问题③）：标题固定两行（line-clamp-2 + min-h），副标恒占两行（无则占位），
            让「摊主条」在同排卡片间对齐成一条基线，消除有无副标导致的错落。 */}
        <h3 className="mt-1.5 line-clamp-2 min-h-[2.5rem] text-[15px] font-bold leading-snug tracking-tight text-[var(--ink)]">
          {stall.title}
        </h3>
        <p className="mt-1 line-clamp-2 min-h-[2.4rem] text-[13px] leading-[1.55] text-[var(--ink2)]">
          {stall.subtitle || " "}
        </p>

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

        {/* 交易气息数字条：成交 · 学习人数 */}
        <div className="mt-3 flex items-center gap-3 text-[11.5px] text-[var(--ink3)]">
          <span className="flex items-center gap-1" title={stall.isPaid ? "付费成交数" : "被拿走到书架的人数"}>
            <Package size={13} weight="fill" className="text-[var(--ink4)]" />
            <span className="mono text-[var(--ink2)]">{abbrevCount(volume)}</span> {stall.isPaid ? "成交" : "拿走"}
          </span>
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

        {/* ——— CTA（关键红，唯一强调）——— */}
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
          ) : subCovered ? (
            // 价签智能化（U4-a）：已订阅覆盖本赛道的付费课 → 「订阅已含·去学习」，进详情页开始学（不扣积分）
            <span className="studio-press inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-[11px] border border-[var(--info-soft-border,var(--border2))] bg-[var(--info-soft)] px-4 py-2.5 text-[13px] font-bold text-[var(--info)] transition-all group-hover:brightness-[1.02]">
              <SealCheck size={15} weight="fill" />
              订阅已含 · 去学习
              <ArrowRight size={14} weight="bold" />
            </span>
          ) : price.free ? (
            // 免费课：卡上直接快捷拿走（零摩擦）
            <button
              type="button"
              onClick={collectFree}
              className="cta-glow studio-press inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-[11px] bg-[var(--red)] px-4 py-2.5 text-[13px] font-bold text-white transition-all hover:brightness-105"
            >
              <Gift size={15} weight="fill" />
              免费拿走
            </button>
          ) : (
            // 付费课：跳详情页确认购买（避免卡上误触扣积分）
            <span className="cta-glow studio-press inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-[11px] bg-[var(--red)] px-4 py-2.5 text-[13px] font-bold text-white transition-all group-hover:brightness-105">
              <Handbag size={15} weight="fill" />
              <span className="mono">{price.amount}</span> 积分 · 查看购买
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
