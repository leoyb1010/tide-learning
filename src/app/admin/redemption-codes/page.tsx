import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { RedemptionCodeManager } from "@/components/admin/RedemptionCodeManager";

export const metadata = { title: "兑换码管理" };

/**
 * 兑换码管理后台：批量生成积分/会员兑换码 + 列表（含已兑次数）+ 复制/导出 + 作废/启用。
 * 高危发放页 → 仅超级管理员（role==="admin"）可访问；非 admin redirect 回后台首页。
 */
export default async function AdminRedemptionCodesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/redemption-codes");
  if (user.role !== "admin") redirect("/admin");

  return (
    <div className="space-y-4">
      <div>
        <div className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink4)]">REDEMPTION · 兑换码</div>
        <h1 className="mt-1 text-[22px] font-bold text-[var(--ink)]">兑换码管理</h1>
        <p className="mt-1 text-[13px] text-[var(--ink3)]">
          批量生成积分 / 会员兑换码，供活动运营发放。用户在「订阅管理」页输入兑换。所有生成与作废写入审计日志。
        </p>
      </div>
      <RedemptionCodeManager />
    </div>
  );
}
