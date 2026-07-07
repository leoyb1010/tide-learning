import { RedemptionCodeManager } from "@/components/admin/RedemptionCodeManager";
import { requireAdminPage } from "@/lib/admin-guard";

export const metadata = { title: "兑换码管理" };

/**
 * 兑换码管理后台：批量生成积分/会员兑换码 + 列表（含已兑次数）+ 复制/导出 + 作废/启用。
 * 高危发放页（P0-1）→ 仅超级管理员（role==="admin"）可访问；无权者重定向到可访问页。
 */
export default async function AdminRedemptionCodesPage() {
  await requireAdminPage("admin", "/admin/redemption-codes");

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
