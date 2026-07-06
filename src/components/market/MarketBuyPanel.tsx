"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Coins,
  Gift,
  BookmarkSimple,
  CheckCircle,
  ArrowRight,
  Wallet,
  SealCheck,
  ShoppingBagOpen,
  Handbag,
} from "@phosphor-icons/react";
import { Dialog } from "@/components/Dialog";
import { useToast } from "@/components/Toast";
import { track } from "@/lib/analytics-client";
import { formatPrice } from "@/lib/market-view";

/**
 * MarketBuyPanel —— 商品详情页「购买 / 拿走」交易面板（client, S4 §问题⑪·②③）。
 *
 * 交易闭环：
 *   1) 免费课 → 「免费拿走」直接调 collect（无确认弹层，零摩擦）。
 *   2) 付费课 → 「N 积分拿走」先弹确认层：进层时拉一次余额；
 *      够 → 「确认购买」；不够 → 展示差额 + 引导去充值（/me）。
 *   3) 成功 → 入袋动效（购物袋收拢）+ Toast「去书架」+ CTA 变「去学习」。
 *   已在书架 / 本人摊位由父页判定，此处只在「未拥有且非本人」时渲染购买按钮。
 *
 * 铁律：本文件 "use client"，只 fetch API（collect / credits.me）+ 客户端埋点，不引 server 链。
 *   写操作走 POST /api/market/collect（服务端 assertSameOrigin + 越权铁律）。
 *   动效全 transform/opacity；reduce-motion 下 useReducedMotion 关位移、入袋降级为即时。
 */
export function MarketBuyPanel({
  courseId,
  slug,
  title,
  priceCredits,
  isLoggedIn,
  initialCollected,
  learnHref,
}: {
  courseId: string;
  slug: string;
  title: string;
  priceCredits: number | null;
  isLoggedIn: boolean;
  initialCollected: boolean;
  /** 拿走/购买后进入学习的目标（课程第 1 节学习台）。 */
  learnHref: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const reduce = useReducedMotion();
  const inFlight = useRef(false);

  const price = formatPrice(priceCredits);
  const [collected, setCollected] = useState(initialCollected);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [buying, setBuying] = useState(false);
  const [celebrate, setCelebrate] = useState(false); // 成功入袋庆祝

  // 拉当前余额（仅付费确认层需要；免费课不拉）。失败静默，UI 回落「未知余额」不阻断。
  const loadBalance = useCallback(async () => {
    setBalanceLoading(true);
    try {
      const json = await fetch("/api/credits/me").then((r) => r.json());
      if (json.ok) setBalance(json.data.balance as number);
    } catch {
      /* 静默：余额未知时仍允许尝试购买，服务端会二次校验并 402 引导 */
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  // 成功庆祝定时收尾（reduce 下瞬时）。
  useEffect(() => {
    if (!celebrate) return;
    const t = window.setTimeout(() => setCelebrate(false), reduce ? 0 : 1100);
    return () => window.clearTimeout(t);
  }, [celebrate, reduce]);

  // 未登录：任何拿走/购买都先引导登录（回跳本商品页）。
  function requireLogin(): boolean {
    if (isLoggedIn) return true;
    toast("登录后可把课拿到书架", { tone: "info" });
    router.push(`/login?next=/market/${slug}`);
    return false;
  }

  // 免费课：直接拿走（无确认层）。付费课：打开确认层并拉余额。
  function onPrimary() {
    if (!requireLogin()) return;
    if (price.free) {
      void doCollect();
      return;
    }
    setConfirmOpen(true);
    void loadBalance();
  }

  // 实际调 collect（免费 fork / 付费买断由服务端按 priceCredits 分支）。
  async function doCollect() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBuying(true);
    // 20s 超时兜底：网络卡死时用 AbortController 中断请求，避免按钮永久卡 loading（finally 统一解锁）。
    const ctrl = new AbortController();
    const timeout = window.setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch("/api/market/collect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseId }),
        signal: ctrl.signal,
      });
      const json = (await res.json()) as
        | { ok: true; data: { status: string; already: boolean; message: string; balance?: number; spent?: number } }
        | { ok: false; error: string };

      if (!json.ok) {
        // 402（余额不足）等：确认层保留，提示 + 露充值入口。
        toast(json.error, { tone: "warn" });
        // 余额可能已变（并发），刷新一次让差额显示准确。
        if (!price.free) void loadBalance();
        return;
      }

      setCollected(true);
      setConfirmOpen(false);
      if (typeof json.data.balance === "number") setBalance(json.data.balance);

      if (json.data.already) {
        toast(json.data.message, { tone: "info" });
      } else {
        setCelebrate(true);
        toast(json.data.message, {
          tone: "success",
          action: { label: "去书架", onClick: () => router.push("/desk?shelf=1") },
        });
        track(price.free ? "market_collect" : "market_purchase", {
          course_id: courseId,
          price_credits: price.amount,
        });
      }
      router.refresh();
    } catch {
      toast("网络异常，请重试", { tone: "warn" });
    } finally {
      window.clearTimeout(timeout);
      inFlight.current = false;
      setBuying(false);
    }
  }

  const enough = balance != null && balance >= price.amount;
  const shortfall = balance != null ? Math.max(0, price.amount - balance) : 0;

  // ============ 已拥有：进学习台 ============
  if (collected) {
    return (
      <div className="relative">
        <Link
          href={learnHref}
          className="studio-press group inline-flex h-12 w-full items-center justify-center gap-2 rounded-[14px] border border-[var(--border2)] bg-[var(--surface)] px-6 text-[15px] font-bold text-[var(--ink)] transition-all hover:border-[var(--red)] hover:text-[var(--red)]"
        >
          <CheckCircle size={18} weight="fill" className="text-[var(--ok)]" />
          已在书架 · 去学习
          <ArrowRight size={16} weight="bold" className="transition-transform group-hover:translate-x-0.5" />
        </Link>
        {/* 入袋庆祝：购物袋收拢 + 光点，成功反馈（reduce 降级不渲染） */}
        <BagCelebrate show={celebrate && !reduce} />
      </div>
    );
  }

  // ============ 未拥有：购买 / 免费拿走 ============
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onPrimary}
        disabled={buying}
        className="cta-glow studio-press inline-flex h-12 w-full items-center justify-center gap-2 rounded-[14px] bg-[var(--red)] px-6 text-[15px] font-bold text-white transition-all hover:brightness-105 disabled:opacity-60"
      >
        {buying ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />
        ) : price.free ? (
          <>
            <Gift size={17} weight="fill" />
            免费拿走
          </>
        ) : (
          <>
            <Handbag size={17} weight="fill" />
            <span className="mono">{price.amount}</span> 积分拿走
          </>
        )}
      </button>

      {/* 付费确认层：余额核对 + 够则确认 / 不够引导充值 */}
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} title="确认购买">
        <div className="flex flex-col gap-4">
          {/* 商品摘要 */}
          <div className="flex items-center gap-3 rounded-[14px] border border-[var(--border)] bg-[var(--surface-inset)] px-3.5 py-3 shadow-[var(--inner-hi)]">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-[var(--red-soft)]">
              <ShoppingBagOpen size={20} weight="fill" className="text-[var(--red)]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-bold text-[var(--ink)]">{title}</p>
              <p className="mt-0.5 flex items-center gap-1 text-[12.5px] text-[var(--ink3)]">
                <Coins size={13} weight="fill" className="text-[var(--red)]" />
                售价 <span className="mono font-bold text-[var(--red)]">{price.amount}</span> 积分
              </p>
            </div>
          </div>

          {/* 余额行 */}
          <div className="flex items-center justify-between rounded-[12px] px-1 text-[13px]">
            <span className="flex items-center gap-1.5 text-[var(--ink3)]">
              <Wallet size={15} weight="fill" className="text-[var(--ink4)]" />
              你的余额
            </span>
            <span className="mono font-bold text-[var(--ink)]">
              {balanceLoading ? "···" : balance == null ? "··" : balance.toLocaleString()}
              <span className="ml-0.5 text-[11px] font-semibold text-[var(--ink3)]">积分</span>
            </span>
          </div>

          {/* 够 / 不够 分支 */}
          {balance != null && !enough ? (
            <div className="flex flex-col gap-3 rounded-[14px] border border-[var(--red-soft-border)] bg-[var(--red-soft)] px-4 py-3.5">
              <p className="text-[13px] font-semibold text-[var(--ink)]">
                还差 <span className="mono font-extrabold text-[var(--red)]">{shortfall}</span> 积分，充值后即可购买。
              </p>
              <Link
                href="/me"
                onClick={() => setConfirmOpen(false)}
                className="cta-glow studio-press inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-[12px] bg-[var(--red)] text-[14px] font-bold text-white transition-all hover:brightness-105"
              >
                <Coins size={16} weight="fill" />
                去充值积分
                <ArrowRight size={15} weight="bold" />
              </Link>
            </div>
          ) : (
            <button
              type="button"
              onClick={doCollect}
              disabled={buying || balanceLoading}
              className="cta-glow studio-press inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-[12px] bg-[var(--red)] text-[14px] font-bold text-white transition-all hover:brightness-105 disabled:opacity-60"
            >
              {buying ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />
              ) : (
                <>
                  <SealCheck size={16} weight="fill" />
                  确认购买 · <span className="mono">{price.amount}</span> 积分
                </>
              )}
            </button>
          )}

          <p className="text-center text-[11.5px] leading-[1.5] text-[var(--ink4)]">
            购买后课程永久进入你的书架，作者获得收益分成。
          </p>
        </div>
      </Dialog>

      <BagCelebrate show={celebrate && !reduce} />
    </div>
  );
}

/**
 * 入袋庆祝层：一枚购物袋图标从按钮中心弹起、收拢，伴随光点四散（购买成功隐喻）。
 * 纯 framer transform/opacity；reduce-motion 时父层不渲染本组件（即时无动效）。
 */
function BagCelebrate({ show }: { show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="celebrate"
          className="pointer-events-none absolute inset-0 z-10 grid place-items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.span
            initial={{ scale: 0.4, y: 6 }}
            animate={{ scale: [0.4, 1.15, 1], y: [6, -6, 0] }}
            transition={{ duration: 0.55, times: [0, 0.6, 1], ease: "easeOut" }}
            className="grid h-14 w-14 place-items-center rounded-full bg-[var(--red)] text-white shadow-[var(--lift)]"
          >
            <Handbag size={26} weight="fill" />
          </motion.span>
          {/* 四散光点 */}
          {[0, 60, 120, 180, 240, 300].map((deg) => (
            <motion.span
              key={deg}
              className="absolute h-1.5 w-1.5 rounded-full bg-[var(--red)]"
              initial={{ opacity: 0, x: 0, y: 0, scale: 0.5 }}
              animate={{
                opacity: [0, 1, 0],
                x: Math.cos((deg * Math.PI) / 180) * 44,
                y: Math.sin((deg * Math.PI) / 180) * 44,
                scale: [0.5, 1, 0.4],
              }}
              transition={{ duration: 0.7, ease: "easeOut" }}
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
