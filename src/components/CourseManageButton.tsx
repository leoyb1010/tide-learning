"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Storefront, Package, Coins, HourglassMedium, ArrowCounterClockwise } from "@phosphor-icons/react";
import { Dialog } from "./Dialog";
import { useToast } from "./Toast";
import { PriceField, validatePrice, validateMeta } from "./ShareToMarketButton";

/**
 * CourseManageButton —— 「我的课」已上架/审核中课卡的「经营」按钮 + 经营弹窗（client）。
 *
 * shared：展示当前状态/销量/累计收益，可改价（免费/付费切换 + 正整数积分）、编辑标题/简介
 *   （POST /api/market/share action:"update"，不触发重新审核），或下架（DELETE，二次确认）。
 * pending：只提供「撤回审核」（同 DELETE 下架语义，回到 private）。
 * 全部操作 loading 防重复提交，成功 router.refresh()，失败走全局 toast。STUDIO token。
 */
export function CourseManageButton({
  courseId,
  status,
  priceCredits,
  salesCount,
  income,
  courseTitle,
  courseSubtitle,
}: {
  courseId: string;
  status: "shared" | "pending";
  priceCredits: number | null;
  salesCount: number;
  /** 该课累计收益（积分），页面服务端从收益流水算好传入。 */
  income: number;
  courseTitle: string;
  courseSubtitle: string | null;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmDelist, setConfirmDelist] = useState(false);
  // 改价/改文案表单态（预填现值）
  const [isPaid, setIsPaid] = useState((priceCredits ?? 0) > 0);
  const [price, setPrice] = useState((priceCredits ?? 0) > 0 ? String(priceCredits) : "");
  const [title, setTitle] = useState(courseTitle);
  const [subtitle, setSubtitle] = useState(courseSubtitle ?? "");

  function close() {
    if (loading) return;
    setOpen(false);
    setConfirmDelist(false);
  }

  /** 保存经营信息（改价 + 标题/简介），action:"update" 不触发上架/审核。 */
  async function save() {
    if (loading) return;
    const priceErr = validatePrice(isPaid, price);
    if (priceErr) return toast(priceErr, { tone: "warn" });
    const metaErr = validateMeta(title, subtitle);
    if (metaErr) return toast(metaErr, { tone: "warn" });
    setLoading(true);
    try {
      const res = await fetch("/api/market/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          courseId,
          action: "update",
          priceCredits: isPaid ? Number(price) : 0,
          title: title.trim(),
          subtitle: subtitle.trim(),
        }),
      });
      const json = (await res.json()) as { ok: true } | { ok: false; error: string };
      if (!json.ok) {
        toast(json.error, { tone: "warn" });
        return;
      }
      toast("经营信息已更新", { tone: "success" });
      setOpen(false);
      router.refresh();
    } catch {
      toast("网络异常，请重试", { tone: "warn" });
    } finally {
      setLoading(false);
    }
  }

  /** 下架 / 撤回审核（DELETE → 回到 private）。 */
  async function delist() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/market/share", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseId }),
      });
      const json = (await res.json()) as { ok: true } | { ok: false; error: string };
      if (!json.ok) {
        toast(json.error, { tone: "warn" });
        return;
      }
      toast(status === "pending" ? "已撤回审核" : "已下架，集市不再展示", { tone: "success" });
      setOpen(false);
      setConfirmDelist(false);
      router.refresh();
    } catch {
      toast("网络异常，请重试", { tone: "warn" });
    } finally {
      setLoading(false);
    }
  }

  const isFree = (priceCredits ?? 0) <= 0;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="studio-press inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[12px] font-semibold text-[var(--ink2)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)]"
      >
        <Storefront size={13} weight="bold" />
        经营
      </button>

      <Dialog open={open} onClose={close} title={status === "pending" ? "审核中" : "经营这门课"}>
        {status === "pending" ? (
          /* ——— pending：只提供撤回审核 ——— */
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 rounded-[12px] border border-[var(--border)] bg-[var(--warn-soft)] px-3.5 py-3">
              <HourglassMedium size={16} weight="fill" className="shrink-0 text-[var(--warn)]" />
              <p className="text-[13px] leading-relaxed text-[var(--ink2)]">
                这门课正在审核中，通过后会自动上架集市。你也可以先撤回。
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={close}
                disabled={loading}
                className="studio-press rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[13px] font-semibold text-[var(--ink2)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)] disabled:opacity-50"
              >
                继续等待
              </button>
              <button
                type="button"
                onClick={delist}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-[10px] border border-transparent bg-[var(--red-soft)] px-4 py-2 text-[13px] font-semibold text-[var(--red)] transition-colors hover:brightness-95 disabled:opacity-50"
              >
                <ArrowCounterClockwise size={13} weight="bold" />
                {loading ? "撤回中…" : "撤回审核"}
              </button>
            </div>
          </div>
        ) : (
          /* ——— shared：经营面板 ——— */
          <div className="flex flex-col gap-4">
            {/* 状态 + 销量 + 收益 */}
            <div className="grid grid-cols-3 divide-x divide-[var(--border)] overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface-inset)]">
              <div className="flex flex-col items-center gap-0.5 px-2 py-3">
                <span className="inline-flex items-center gap-1 text-[13px] font-bold text-[var(--ok)]">已上架</span>
                <span className="text-[10.5px] text-[var(--ink4)]">{isFree ? "免费" : `${priceCredits} 积分`}</span>
              </div>
              <div className="flex flex-col items-center gap-0.5 px-2 py-3">
                <span className="mono inline-flex items-center gap-1 text-[15px] font-bold text-[var(--ink)]">
                  <Package size={12} weight="fill" className="text-[var(--ink4)]" />
                  {salesCount}
                </span>
                <span className="text-[10.5px] text-[var(--ink4)]">{isFree ? "被拿走" : "成交"}</span>
              </div>
              <div className="flex flex-col items-center gap-0.5 px-2 py-3">
                <span className="mono inline-flex items-center gap-1 text-[15px] font-bold text-[var(--ok)]">
                  <Coins size={12} weight="fill" />
                  +{income}
                </span>
                <span className="text-[10.5px] text-[var(--ink4)]">累计收益</span>
              </div>
            </div>

            <PriceField isPaid={isPaid} setIsPaid={setIsPaid} price={price} setPrice={setPrice} />

            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-semibold text-[var(--ink2)]">标题（2-80 字）</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={80}
                className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13.5px] text-[var(--ink)] outline-none transition-colors focus:border-[var(--border2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red-soft)]"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-semibold text-[var(--ink2)]">简介（最多 160 字，可留空）</span>
              <textarea
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                maxLength={160}
                rows={2}
                className="resize-none rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13.5px] leading-relaxed text-[var(--ink)] outline-none transition-colors focus:border-[var(--border2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red-soft)]"
              />
            </label>

            {/* 底部操作：下架（danger）居左，保存居右 */}
            <div className="mt-1 flex items-center justify-between gap-2 border-t border-[var(--border)] pt-4">
              {confirmDelist ? (
                <div className="flex min-w-0 items-center gap-2">
                  <p className="min-w-0 text-[12px] leading-snug text-[var(--ink3)]">
                    下架后集市不再展示，已购学员不受影响。
                  </p>
                  <button
                    type="button"
                    onClick={delist}
                    disabled={loading}
                    className="shrink-0 rounded-[10px] bg-[var(--red)] px-3 py-1.5 text-[12px] font-semibold text-white transition-all hover:brightness-105 disabled:opacity-50"
                  >
                    {loading ? "下架中…" : "确认下架"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelist(false)}
                    disabled={loading}
                    className="shrink-0 text-[12px] font-semibold text-[var(--ink3)] transition-colors hover:text-[var(--ink)] disabled:opacity-50"
                  >
                    再想想
                  </button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirmDelist(true)}
                    disabled={loading}
                    className="rounded-[10px] border border-transparent bg-[var(--red-soft)] px-3.5 py-2 text-[12.5px] font-semibold text-[var(--red)] transition-colors hover:brightness-95 disabled:opacity-50"
                  >
                    下架
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={close}
                      disabled={loading}
                      className="studio-press rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[13px] font-semibold text-[var(--ink2)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)] disabled:opacity-50"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={save}
                      disabled={loading}
                      className="rounded-[10px] bg-[var(--red)] px-4 py-2 text-[13px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(252,1,26,0.5)] transition-all duration-200 hover:brightness-105 active:translate-y-px disabled:opacity-50"
                    >
                      {loading ? "保存中…" : "保存修改"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
