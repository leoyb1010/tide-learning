import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { CreateStudio } from "@/components/CreateStudio";

export const metadata = { title: "AI 造课" };

/**
 * /create —— AI 造课页（页面壳，server）。
 * 服务端取当前用户 + 权益快照，仅把布尔 canUseLLM 透给客户端交互组件；
 * 真正的权益闸门在各 AI route 内二次校验（越权/权益判断只信服务端）。
 * 未登录先引导登录（AI 功能必须登录）。
 */
export default async function CreatePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/create");

  const snapshot = await resolveEntitlement(user.id);

  return (
    <div className="mx-auto flex min-h-[calc(100vh-160px)] w-full max-w-[1040px] flex-col justify-center py-8 sm:py-12">
      <CreateStudio canUseLLM={snapshot.canUseLLM} />
    </div>
  );
}
