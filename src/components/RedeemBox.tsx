"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Gift } from "@phosphor-icons/react/dist/ssr";
import { useToast } from "@/components/Toast";

/**
 * 兑换码兑换入口（用户侧）。极简单行输入 + 兑换按钮；成功后按发放类型提示并 refresh 页面
 * （会员到期 / 积分余额随之更新）。走 POST /api/redeem，服务端原子核销。
 */
export function RedeemBox() {
  const router = useRouter();
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function redeem(e: React.FormEvent) {
    e.preventDefault();
    const c = code.trim();
    if (!c) return toast("请输入兑换码", { tone: "warn" });
    setBusy(true);
    try {
      const json = await fetch("/api/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: c }),
      }).then((r) => r.json());
      if (json.ok) {
        const d = json.data as { type: "credits" | "membership"; value: number };
        toast(d.type === "credits" ? `兑换成功，+${d.value} 积分` : `兑换成功，会员 +${d.value} 天`, { tone: "success" });
        setCode("");
        router.refresh();
      } else {
        toast(json.error ?? "兑换失败", { tone: "warn" });
      }
    } catch {
      toast("网络异常，请重试", { tone: "warn" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--card)]">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-[var(--red-soft)] text-[var(--red)]">
          <Gift size={16} weight="fill" />
        </span>
        <div>
          <p className="text-[14px] font-bold text-[var(--ink)]">兑换码</p>
          <p className="text-[12px] text-[var(--ink3)]">输入活动兑换码，领取积分或会员</p>
        </div>
      </div>
      <form onSubmit={redeem} className="flex flex-wrap items-center gap-2.5">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="TIDE-XXXX-XXXX-XXXX"
          aria-label="兑换码"
          className="mono min-w-[220px] flex-1 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[13px] uppercase tracking-wide text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink4)] placeholder:normal-case focus:border-[var(--ink3)]"
        />
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="rounded-[10px] bg-[var(--red)] px-5 py-2.5 text-[13px] font-bold text-white transition-all hover:brightness-105 disabled:opacity-40"
        >
          {busy ? "兑换中…" : "兑换"}
        </button>
      </form>
    </section>
  );
}
