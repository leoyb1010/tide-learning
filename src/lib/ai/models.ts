/**
 * LLM 模型注册表 —— 会员造课可选模型的单一真值源。
 *
 * 【Leo 的录入位】以后加新模型：复制一个条目改字段即可，其余链路（权益过滤 / UI 下拉 /
 * 计费权重 / 落库）全自动生效。apiKey / baseUrl 只在此写 env 变量名，真实密钥走 .env。
 * 下架某模型：把 enabled 设 false（或不配它的 env key），它就从所有 UI 与校验里消失。
 */

const DEFAULT_BASE_URL = "https://api.deepseek.com";

export interface LlmModelEntry {
  key: string; // 传给上游 API 的 model 名，落库到 Course.modelUsed
  label: string; // UI 显示名
  desc: string; // UI 一句话（速度 / 质量 / 适合场景）
  tier: "free" | "premium"; // free=所有人；premium=仅订阅会员
  costWeight: number; // 积分折算权重：消耗 = token 折算 × costWeight（flash 基准 = 1）
  envKeyName: string; // 读哪个 env 拿 apiKey
  baseUrlEnvName?: string; // 读哪个 env 拿 baseUrl（缺省用 DeepSeek 官方地址）
  enabled: boolean; // 快速下架开关；env 没配 key 时服务端也会视为不可用
}

export const LLM_MODELS: LlmModelEntry[] = [
  {
    key: "deepseek-v4-flash",
    label: "潮汐 · 快速",
    desc: "响应快、成本低，日常造课默认",
    tier: "free",
    costWeight: 1,
    envKeyName: "DEEPSEEK_API_KEY",
    enabled: true,
  },
  // ↓↓↓ Leo 录入位（enabled:false 时不出现在任何 UI / 校验里，配好 key 后翻 true 即上线）↓↓↓
  // {
  //   key: "deepseek-v4-pro",
  //   label: "潮汐 · 深思",
  //   desc: "更强推理与文采，长课 / 专业内容更佳（会员专享）",
  //   tier: "premium",
  //   costWeight: 3,
  //   envKeyName: "DEEPSEEK_API_KEY",
  //   enabled: false,
  // },
  // {
  //   key: "<其它 OpenAI 兼容模型名>",
  //   label: "<显示名>",
  //   desc: "<一句话>",
  //   tier: "premium",
  //   costWeight: 2,
  //   envKeyName: "OTHER_PROVIDER_API_KEY",
  //   baseUrlEnvName: "OTHER_PROVIDER_BASE_URL",
  //   enabled: false,
  // },
];

export const DEFAULT_MODEL_KEY =
  process.env.DEEPSEEK_MODEL || LLM_MODELS[0].key;

/** 某模型当前是否真正可用（启用 + env 配了 key）。 */
export function isModelUsable(m: LlmModelEntry): boolean {
  return m.enabled && Boolean(process.env[m.envKeyName]);
}

/**
 * 按用户订阅态返回可选模型列表：启用 + env 有 key，且（free 档 / 会员可见 premium）。
 * 永远至少返回默认模型（若默认模型 env 都没配，返回空——上层据此隐藏模型选择）。
 */
export function availableModelsFor(isSubscriber: boolean): LlmModelEntry[] {
  return LLM_MODELS.filter(
    (m) => isModelUsable(m) && (m.tier === "free" || isSubscriber),
  );
}

/** 把一个 model key 解析成可用条目；非法 / 不可用 → 回落到默认模型条目。 */
export function resolveModel(key?: string | null): LlmModelEntry {
  const found = key ? LLM_MODELS.find((m) => m.key === key && isModelUsable(m)) : null;
  if (found) return found;
  const def = LLM_MODELS.find((m) => m.key === DEFAULT_MODEL_KEY && isModelUsable(m));
  return def ?? LLM_MODELS[0];
}

/** 解析条目的 apiKey / baseUrl（供 llm.ts 直连）。 */
export function modelCredentials(m: LlmModelEntry): { apiKey: string | undefined; baseUrl: string } {
  return {
    apiKey: process.env[m.envKeyName],
    baseUrl: (m.baseUrlEnvName && process.env[m.baseUrlEnvName]) || DEFAULT_BASE_URL,
  };
}

/** 某 model key 的计费权重（未知 key → 默认 1）。 */
export function costWeightOf(key?: string | null): number {
  return resolveModel(key).costWeight;
}

/**
 * 对该用户「已启用但不可用」的 premium 模型（免费用户看会员专享模型）。
 * 供造课 UI 渲染带锁的引导项，点击去订阅。会员或无 premium 模型时返回空。
 */
export function lockedModelsFor(isSubscriber: boolean): LlmModelEntry[] {
  if (isSubscriber) return [];
  return LLM_MODELS.filter((m) => isModelUsable(m) && m.tier === "premium");
}
