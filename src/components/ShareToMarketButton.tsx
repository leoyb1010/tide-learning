"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Export, CheckCircle, HourglassMedium, Gift, Coins } from "@phosphor-icons/react";
import { Dialog } from "./Dialog";
import { useToast } from "./Toast";
import { track } from "@/lib/analytics-client";

export type ShareState = "private" | "pending" | "shared" | "rejected";

/** 价格输入合法性：免费不校验；付费必须为正整数。返回错误文案或 null。 */
export function validatePrice(isPaid: boolean, raw: string): string | null {
  if (!isPaid) return null;
  const n = Number(raw);
  if (!raw.trim() || !Number.isInteger(n) || n <= 0) return "售价需为正整数积分";
  return null;
}

/** 标题/简介限长校验（与后端契约一致：title 2-80 字、subtitle ≤160 字）。返回错误文案或 null。 */
export function validateMeta(title: string, subtitle: string): string | null {
  const t = title.trim();
  if (t.length < 2 || t.length > 80) return "标题需 2-80 个字";
  if (subtitle.trim().length > 160) return "简介最多 160 个字";
  return null;
}

/** 免费 / 付费切换 + 积分输入（分享弹窗与经营弹窗共用）。 */
export function PriceField({
  isPaid,
  setIsPaid,
  price,
  setPrice,
}: {
  isPaid: boolean;
  setIsPaid: (v: boolean) => void;
  price: string;
  setPrice: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold text-[var(--ink2)]">定价</span>
      <div className="flex items-center gap-2">
        <div className="flex overflow-hidden rounded-[10px] border border-[var(--border)]">
          <button
            type="button"
            onClick={() => setIsPaid(false)}
            className={`inline-flex items-center gap-1 px-3 py-1.5 text-[12px] font-semibold transition-colors ${
              !isPaid ? "bg-[var(--ok-soft)] text-[var(--ok)]" : "bg-[var(--surface)] text-[var(--ink3)] hover:text-[var(--ink)]"
            }`}
          >
            <Gift size={12} weight="fill" />
            免费
          </button>
          <button
            type="button"
            onClick={() => setIsPaid(true)}
            className={`inline-flex items-center gap-1 border-l border-[var(--border)] px-3 py-1.5 text-[12px] font-semibold transition-colors ${
              isPaid ? "bg-[var(--red-soft)] text-[var(--red)]" : "bg-[var(--surface)] text-[var(--ink3)] hover:text-[var(--ink)]"
            }`}
          >
            <Coins size={12} weight="fill" />
            付费
          </button>
        </div>
        {isPaid && (
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              step={1}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="如 30"
              className="mono w-24 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[13px] font-semibold text-[var(--ink)] outline-none transition-colors focus:border-[var(--border2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red-soft)]"
            />
            <span className="text-[12px] text-[var(--ink3)]">积分</span>
          </div>
        )}
      </div>
      <p className="text-[12px] text-[var(--ink4)]">
        {isPaid ? "别人购买后你可得售价的 70%，即时入账积分。" : "免费课任何人都可直接拿走，你会获得小额创作激励。"}
      </p>
    </div>
  );
}

/**
 * ShareToMarketButton —— 「我的课」卡片上的「分享到社区」按钮（client）。
 * 点击先弹出上架弹窗：免费(默认)/付费切换 + 积分输入（正整数），可选编辑标题/简介（预填现值），
 * 再调 /api/market/share（POST，无 action = 上架语义）。服务端 LLM 审核课程标题+简介：
 *   shared → 已上架；pending → 转人工；rejected → 返回 fail 文案。
 * 已上架/审核中显示只读态。STUDIO token。
 */
export function ShareToMarketButton({
  courseId,
  initialStatus,
  courseTitle,
  courseSubtitle,
}: {
  courseId: string;
  initialStatus: ShareState;
  /** 课程现标题/简介（上架弹窗预填，可选，缺省时不展示编辑区，保持旧用法兼容）。 */
  courseTitle?: string;
  courseSubtitle?: string | null;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [status, setStatus] = useState<ShareState>(initialStatus);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  // 弹窗表单态
  const [isPaid, setIsPaid] = useState(false);
  const [price, setPrice] = useState("");
  const [title, setTitle] = useState(courseTitle ?? "");
  const [subtitle, setSubtitle] = useState(courseSubtitle ?? "");
  const hasMeta = courseTitle !== undefined;

  async function share() {
    if (loading) return;
    const priceErr = validatePrice(isPaid, price);
    if (priceErr) return toast(priceErr, { tone: "warn" });
    if (hasMeta) {
      const metaErr = validateMeta(title, subtitle);
      if (metaErr) return toast(metaErr, { tone: "warn" });
    }
    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        courseId,
        priceCredits: isPaid ? Number(price) : 0,
      };
      if (hasMeta) {
        body.title = title.trim();
        body.subtitle = subtitle.trim();
      }
      const res = await fetch("/api/market/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as
        | { ok: true; data: { status: string; message: string } }
        | { ok: false; error: string };
      if (!json.ok) {
        // 审核不通过（rejected）也走这里：标红提示，本地切到 rejected。
        setStatus("rejected");
        setOpen(false);
        toast(json.error, { tone: "warn" });
        return;
      }
      const next = json.data.status as ShareState;
      setStatus(next);
      setOpen(false);
      toast(json.data.message, { tone: next === "shared" ? "success" : "info" });
      track("market_share", { course_id: courseId, status: next });
      router.refresh();
    } catch {
      toast("网络异常，请重试", { tone: "warn" });
    } finally {
      setLoading(false);
    }
  }

  if (status === "shared") {
    return (
      <span className="inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-1.5 text-[12px] font-semibold text-[var(--ink2)]">
        <CheckCircle size={13} weight="fill" className="text-[var(--red)]" />
        已在集市
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-1.5 text-[12px] font-semibold text-[var(--ink3)]">
        <HourglassMedium size={13} weight="fill" />
        审核中
      </span>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={loading}
        className="studio-press inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[12px] font-semibold text-[var(--ink2)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)] disabled:opacity-50"
      >
        <Export size={13} weight="bold" />
        {status === "rejected" ? "重新分享" : "分享到社区"}
      </button>

      <Dialog open={open} onClose={() => !loading && setOpen(false)} title="分享到集市">
        <div className="flex flex-col gap-4">
          <p className="text-[13px] leading-relaxed text-[var(--ink2)]">
            上架前会审核课程标题与简介；通过后即在集市展示。
          </p>

          <PriceField isPaid={isPaid} setIsPaid={setIsPaid} price={price} setPrice={setPrice} />

          {hasMeta && (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold text-[var(--ink2)]">标题（2-80 字）</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={80}
                  className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[14px] text-[var(--ink)] outline-none transition-colors focus:border-[var(--border2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red-soft)]"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold text-[var(--ink2)]">简介（最多 160 字，可留空）</span>
                <textarea
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  maxLength={160}
                  rows={2}
                  className="resize-none rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[14px] leading-relaxed text-[var(--ink)] outline-none transition-colors focus:border-[var(--border2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red-soft)]"
                />
              </label>
            </>
          )}

          <div className="mt-1 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={loading}
              className="studio-press rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[13px] font-semibold text-[var(--ink2)] transition-colors hover:border-[var(--border2)] hover:text-[var(--ink)] disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={share}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-[10px] bg-[var(--red)] px-4 py-2 text-[13px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(252,1,26,0.5)] transition-all duration-200 hover:brightness-105 active:translate-y-px disabled:opacity-50"
            >
              <Export size={13} weight="bold" />
              {loading ? "提交中…" : "确认上架"}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
