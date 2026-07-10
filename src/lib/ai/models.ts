/**
 * LLM 模型注册表 —— 会员造课可选模型的单一真值源。
 *
 * 【Leo 的录入位】以后加新模型：复制一个条目改字段即可，其余链路（权益过滤 / UI 下拉 /
 * 计费权重 / 落库）全自动生效。apiKey / baseUrl 只在此写 env 变量名，真实密钥走 .env。
 * 下架某模型：把 enabled 设 false（或不配它的 env key），它就从所有 UI 与校验里消失。
 */

const DEFAULT_BASE_URL = "https://newapi.inner.youdao.com/v1";
const NEWAPI_KEY_ENV = "NEWAPI_API_KEY";
const NEWAPI_BASE_URL_ENV = "NEWAPI_BASE_URL";

export interface LlmModelEntry {
  key: string; // 传给上游 API 的 model 名，落库到 Course.modelUsed
  label: string; // UI 显示名
  desc: string; // UI 一句话（速度 / 质量 / 适合场景）
  tier: "free" | "premium"; // free=所有人；premium=仅订阅会员
  costWeight: number; // 积分折算权重：消耗 = token 折算 × costWeight（flash 基准 = 1）
  envKeyName: string; // 读哪个 env 拿 apiKey
  baseUrlEnvName?: string; // 读哪个 env 拿 baseUrl（缺省用 NewAPI 网关地址）
  enabled: boolean; // 快速下架开关；env 没配 key 时服务端也会视为不可用
}

/** v3.4 bespoke HTML 只允许强模型；可用环境变量逗号列表覆盖，便于网关模型升级时零代码切换。 */
const DEFAULT_BESPOKE_MODELS = ["claude-sonnet-5", "glm-5.2", "claude-opus-4-8", "gpt-5.5"];

export function bespokeModelKeys(): string[] {
  const configured = process.env.COURSEWARE_BESPOKE_MODELS?.split(",").map((v) => v.trim()).filter(Boolean);
  return configured?.length ? configured : DEFAULT_BESPOKE_MODELS;
}

export const LLM_MODELS: LlmModelEntry[] = [
  {
    key: "gpt-5.5",
    label: "GPT-5.5",
    desc: "综合质量最高，适合完整体系化造课",
    tier: "free",
    costWeight: 1,
    envKeyName: NEWAPI_KEY_ENV,
    baseUrlEnvName: NEWAPI_BASE_URL_ENV,
    enabled: true,
  },
  {
    key: "glm-5.2",
    label: "GLM-5.2",
    desc: "推理与知识结构化均衡，适合专业主题大纲",
    tier: "premium",
    costWeight: 2,
    envKeyName: NEWAPI_KEY_ENV,
    baseUrlEnvName: NEWAPI_BASE_URL_ENV,
    enabled: true,
  },
  {
    key: "qwen3.7-max",
    label: "Qwen3.7 Max",
    desc: "中文知识与任务执行能力强，适合结构化课程生成",
    tier: "premium",
    costWeight: 2,
    envKeyName: NEWAPI_KEY_ENV,
    baseUrlEnvName: NEWAPI_BASE_URL_ENV,
    enabled: true,
  },
  {
    key: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    desc: "长文本理解与课程规划能力强，适合复杂主题深度生成",
    tier: "premium",
    costWeight: 3,
    envKeyName: NEWAPI_KEY_ENV,
    baseUrlEnvName: NEWAPI_BASE_URL_ENV,
    enabled: true,
  },
  {
    key: "MiniMax-M3",
    label: "MiniMax-M3",
    desc: "中文表达与长内容组织稳定，适合导入资料改课",
    tier: "premium",
    costWeight: 2,
    envKeyName: NEWAPI_KEY_ENV,
    baseUrlEnvName: NEWAPI_BASE_URL_ENV,
    enabled: true,
  },
  {
    key: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    desc: "推理能力强，适合需要严谨步骤与解释的课程生成",
    tier: "premium",
    costWeight: 2,
    envKeyName: NEWAPI_KEY_ENV,
    baseUrlEnvName: NEWAPI_BASE_URL_ENV,
    enabled: true,
  },
  {
    key: "gemini-3.1-pro",
    label: "Gemini 3.1 Pro",
    desc: "多领域综合能力稳定，适合跨学科内容组织",
    tier: "premium",
    costWeight: 3,
    envKeyName: NEWAPI_KEY_ENV,
    baseUrlEnvName: NEWAPI_BASE_URL_ENV,
    enabled: true,
  },
];

export const DEFAULT_MODEL_KEY =
  process.env.NEWAPI_DEFAULT_MODEL || process.env.DEEPSEEK_MODEL || LLM_MODELS[0].key;

/** 某模型当前是否真正可用（启用 + env 配了 key）。 */
export function isModelUsable(m: LlmModelEntry): boolean {
  return m.enabled && Boolean(process.env[m.envKeyName]);
}

/** 当前服务端是否至少配置了一个可用模型。 */
export function hasUsableModel(): boolean {
  return LLM_MODELS.some(isModelUsable);
}

/**
 * 按用户订阅态返回可选模型列表：启用 + env 有 key，且（free 档 / 会员可见 premium）。
 * 若默认模型 env 都没配，返回空——上层据此隐藏模型选择或提示 AI 未配置。
 */
export function availableModelsFor(isSubscriber: boolean): LlmModelEntry[] {
  return LLM_MODELS.filter(
    (m) => isModelUsable(m) && (m.tier === "free" || isSubscriber),
  );
}

/** 当前用户可用的默认模型：优先 env 指定值，不可用则回落第一个可用模型。 */
export function defaultModelFor(isSubscriber: boolean): LlmModelEntry | null {
  const available = availableModelsFor(isSubscriber);
  return available.find((m) => m.key === DEFAULT_MODEL_KEY) ?? available[0] ?? null;
}

/** 显式模型选择校验；未传则取可用默认。返回 null 表示该用户当前无可用模型。 */
export function selectModelFor(requestedModel: string | undefined | null, isSubscriber: boolean): LlmModelEntry | null {
  const available = availableModelsFor(isSubscriber);
  if (requestedModel) return available.find((m) => m.key === requestedModel) ?? null;
  return available.find((m) => m.key === DEFAULT_MODEL_KEY) ?? available[0] ?? null;
}

/** 为 premium bespoke 选择第一个可用强模型。显式请求不在白名单时返回 null，不静默降级。 */
export function selectBespokeModel(requested?: string | null): LlmModelEntry | null {
  const allowed = new Set(bespokeModelKeys());
  if (requested) {
    return LLM_MODELS.find((m) => m.key === requested && allowed.has(m.key) && isModelUsable(m)) ?? null;
  }
  return bespokeModelKeys()
    .map((key) => LLM_MODELS.find((m) => m.key === key && isModelUsable(m)))
    .find((m): m is LlmModelEntry => Boolean(m)) ?? null;
}

/** 把一个 model key 解析成可用条目；非法 / 不可用 → 回落到默认可用模型条目。 */
export function resolveModel(key?: string | null): LlmModelEntry {
  const found = key ? LLM_MODELS.find((m) => m.key === key && isModelUsable(m)) : null;
  if (found) return found;
  const def = LLM_MODELS.find((m) => m.key === DEFAULT_MODEL_KEY && isModelUsable(m));
  const fallback = def ?? LLM_MODELS.find(isModelUsable) ?? LLM_MODELS[0];
  // 可见化静默回退（R3）：用户「换了模型结果一样」的一大成因是请求模型不可用被无声回落到默认，
  // 用户侧无感。这里在服务端日志明确记一条，便于排查「到底跑的哪个模型」。仅在显式请求了某模型
  // 却拿不到时才 warn（key 为空是正常取默认，不告警）。
  if (key && !found) {
    console.warn(`[llm] 请求模型「${key}」当前不可用（未启用或未配 key），已回退到「${fallback.key}」`);
  }
  return fallback;
}

function normalizeBaseUrl(raw?: string): string {
  const base = (raw || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

/** 解析条目的 apiKey / baseUrl（供 llm.ts 直连）。 */
export function modelCredentials(m: LlmModelEntry): { apiKey: string | undefined; baseUrl: string } {
  return {
    apiKey: process.env[m.envKeyName],
    baseUrl: normalizeBaseUrl(m.baseUrlEnvName ? process.env[m.baseUrlEnvName] : undefined),
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
