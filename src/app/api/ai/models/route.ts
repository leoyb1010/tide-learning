import { NextRequest } from "next/server";
import { ok, handle } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { resolveEntitlement } from "@/lib/entitlement";
import { availableModelsFor, lockedModelsFor, defaultModelFor } from "@/lib/ai/models";
import { COURSE_TEMPLATES, DEFAULT_TEMPLATE } from "@/lib/ai/templates";

export const dynamic = "force-dynamic";

/**
 * GET /api/ai/models —— 造课 UI 拉取「可选模型 + 全部课件模板」。
 *
 * 模型：按当前用户订阅态过滤（会员见 premium，免费仅 free）；未登录返回 free 档。
 * 模板：全员可选，返回全部模板的展示元数据（label/tagline/icon/recommendedFor）。
 * 只读、无副作用；隐藏内部字段（envKeyName/baseUrlEnvName 不外泄）。
 */
export async function GET(_req: NextRequest) {
  return handle(async () => {
    const user = await getCurrentUser();
    let isSubscriber = false;
    if (user) {
      const snap = await resolveEntitlement(user.id);
      isSubscriber = snap.isSubscriber;
    }
    const models = availableModelsFor(isSubscriber).map((m) => ({
      key: m.key,
      label: m.label,
      desc: m.desc,
      tier: m.tier,
      costWeight: m.costWeight,
    }));
    // 免费用户可见的「会员专享」模型（带锁，引导订阅）。会员或无 premium 模型时为空。
    const lockedModels = lockedModelsFor(isSubscriber).map((m) => ({
      key: m.key,
      label: m.label,
      desc: m.desc,
    }));
    const templates = COURSE_TEMPLATES.map((t) => ({
      key: t.key,
      label: t.label,
      tagline: t.tagline,
      icon: t.icon,
      recommendedFor: t.recommendedFor,
    }));
    return ok({
      models,
      lockedModels,
      defaultModel: defaultModelFor(isSubscriber)?.key ?? null,
      templates,
      defaultTemplate: DEFAULT_TEMPLATE,
      isSubscriber,
      qualityTiers: [
        { key: "standard", label: "标准排版", desc: "稳定、快速，由高级确定性引擎生成", available: true },
        { key: "premium", label: "精修排版", desc: "优先使用强模型逐节定制，失败自动回落", available: isSubscriber },
      ],
      defaultQualityTier: "standard",
    });
  });
}
