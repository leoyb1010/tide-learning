import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { yuan } from "@/lib/format";
import { MockPayActions } from "@/components/MockPayActions";
import { TidalReveal } from "@/components/motion";

export const dynamic = "force-dynamic";
export const metadata = { title: "收银台（模拟）" };

/**
 * Mock 收银台页（开发/演示）：展示订单 + 金额 + 二维码占位，
 * 「模拟支付成功/失败」按钮经 /api/checkout/mock-pay（服务端签名）回调 webhook。
 * 真实环境此页由渠道收银台替代。
 */
export default async function MockCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string; next?: string }>;
}) {
  const { order: externalOrderId, next } = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/pricing")}`);
  if (!externalOrderId) redirect("/pricing");

  const order = await prisma.order.findFirst({
    where: { externalOrderId, userId: user.id },
    include: { plan: true, coupon: true },
  });
  if (!order) redirect("/pricing");

  // 只接受站内相对路径（"//host" 是协议相对外跳，一并挡掉）
  const nextUrl = next && next.startsWith("/") && !next.startsWith("//") ? next : "/me/subscription";

  return (
    <div className="mx-auto max-w-md py-8">
      <TidalReveal>
        <div className="rounded-2xl border border-ink-100 bg-paper-raised p-6 shadow-[var(--shadow-soft)]">
          <div className="text-center">
            <p className="text-sm text-ink-500">模拟收银台</p>
            <p className="mt-1 text-xs text-ink-400">开发演示环境 · 真实支付由渠道处理</p>
          </div>

          {/* 二维码占位 */}
          <div className="mx-auto mt-6 flex h-44 w-44 items-center justify-center rounded-xl border border-dashed border-ink-200 bg-paper">
            <div className="text-center">
              <div className="mx-auto mb-2 grid grid-cols-4 gap-1">
                {Array.from({ length: 16 }).map((_, i) => (
                  <span key={i} className={`h-3 w-3 rounded-sm ${i % 3 === 0 ? "bg-ink-800" : "bg-ink-200"}`} />
                ))}
              </div>
              <p className="text-xs text-ink-400">扫码支付（占位）</p>
            </div>
          </div>

          {/* 订单摘要 */}
          <dl className="mt-6 space-y-2 border-t border-ink-100 pt-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-400">套餐</dt>
              <dd className="font-medium text-ink-950">{order.plan.name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-400">订单号</dt>
              <dd className="tabular text-xs text-ink-500">{order.externalOrderId}</dd>
            </div>
            {order.discountCents > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-400">优惠{order.coupon ? `（${order.coupon.code}）` : ""}</dt>
                <dd className="text-accent-700">-¥{yuan(order.discountCents)}</dd>
              </div>
            )}
            <div className="flex items-baseline justify-between border-t border-ink-100 pt-3">
              <dt className="text-ink-500">应付</dt>
              <dd>
                <span className="text-sm text-ink-500">¥</span>
                <span className="num text-3xl font-semibold text-ink-950">{yuan(order.amountCents)}</span>
              </dd>
            </div>
          </dl>

          {order.status === "paid" ? (
            <div className="mt-6 rounded-xl bg-success/10 p-3 text-center text-sm text-success">该订单已支付</div>
          ) : (
            <MockPayActions externalOrderId={order.externalOrderId!} nextUrl={nextUrl} />
          )}

          <div className="mt-4 text-center">
            <Link href="/pricing" className="text-xs text-ink-400 hover:underline">取消并返回</Link>
          </div>
        </div>
      </TidalReveal>
    </div>
  );
}
