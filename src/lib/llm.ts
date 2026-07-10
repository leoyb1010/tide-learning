import { AppError } from "./api";
import { SEARCH_KEYWORDS_SYSTEM, searchKeywordsUser } from "./ai/prompts";
import { resolveModel, modelCredentials, hasUsableModel } from "./ai/models";

/**
 * DeepSeek LLM 统一服务层（C 模块）。
 * OpenAI 兼容协议，fetch 直调不引 SDK —— 与项目零重依赖风格一致（session 用内置 crypto、
 * rate-limit 自实现）。仅覆盖 /chat/completions 一个端点，封装超时/重试/错误折叠。
 *
 * 安全：key 只在服务端读取；upstream 错误一律折叠为通用文案（对齐 api.ts:handle），
 * 绝不把 DeepSeek 的原始错误体/key 泄露给客户端。
 */

/** LLM Token 用量（v2.3 积分经济计量）。DeepSeek 响应的 usage 字段 + 本次所用模型。 */
export interface LlmUsageInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model: string; // v3.2：本次实际所用模型 key，供积分记账按 costWeight 折算
}

export interface ChatOptions {
  system: string;
  user: string;
  temperature?: number; // 默认 0.7；抽取/分类类传 0.2-0.4
  maxTokens?: number; // 默认 8000（v4-flash 是推理模型，思维链先耗 token，需给正文预留空间）
  json?: boolean; // true → response_format json_object
  timeoutMs?: number; // 默认 45s（推理模型延迟更高）
  retries?: number; // 默认 1（仅 5xx/网络/超时重试）
  model?: string; // v3.2：本次调用用哪个模型（见 ai/models.ts）；缺省用默认模型
  onUsage?: (usage: LlmUsageInfo) => void; // v2.3：成功返回后回调实际 Token 用量（供积分记账）
}

interface DeepSeekResponse {
  // v4-flash 是推理模型：message 除 content 外还带 reasoning_content（思维链）
  choices?: { message?: { content?: string; reasoning_content?: string }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/** 是否已配置 AI —— 供 UI/降级判断，未配置时 AI 功能优雅缺席而非崩溃。 */
export function isLLMConfigured(): boolean {
  return hasUsableModel();
}

/** 统一 chat 调用。返回模型输出文本（已 trim）。 */
export async function chat(opts: ChatOptions): Promise<string> {
  // v3.2：解析本次所用模型条目（含 apiKey / baseUrl / model key）。缺省回落默认模型，
  // 故不传 model 的历史调用行为完全不变。
  const modelEntry = resolveModel(opts.model);
  const { apiKey: key, baseUrl } = modelCredentials(modelEntry);
  if (!key) throw new AppError("AI 服务未配置", 503);

  const {
    system,
    user,
    temperature = 0.7,
    maxTokens = 8000, // 推理模型：思维链先耗 token，正文需在其后生成，故预算调大
    json = false,
    // 45s → 60s：NewAPI 网关下部分模型（如 glm-5.2）单次响应可逼近 40s，
    // 45s 会偶发 504 让造课「生成失败」。给足头寸，仍由 AbortController 兜底封顶。
    timeoutMs = 60_000,
    retries = 1,
    onUsage,
  } = opts;
  // 空正文自动放大重试：v4-flash 思维链耗尽预算时 content 为空且 finish_reason=length。
  let effectiveMaxTokens = maxTokens;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const body = JSON.stringify({
      model: modelEntry.key,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature,
      max_tokens: effectiveMaxTokens,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // timer 由 finally 统一清理：超时须覆盖到 body 完整读取（res.text()/res.json() 同受
    // controller.signal 约束），拿到响应头就 clear 会让慢 body 读取脱离 45s 超时。
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body,
        signal: controller.signal,
      });

      if (!res.ok) {
        // 4xx 是客户端/配置问题，不重试；5xx 可重试
        const upstreamText = await res.text().catch(() => "");
        // 不泄露 upstream 细节给客户端，仅服务端日志
        console.error(`[llm] upstream ${res.status}: ${upstreamText.slice(0, 300)}`);
        if (res.status >= 400 && res.status < 500) {
          if (res.status === 429) throw new AppError("AI 请求过于频繁，请稍后再试", 429);
          // 上游 4xx（配置错/payload 超限/鉴权失效）折叠为客户端可见 502，但标记不可重试：
          // 确定性失败，重试只会白打第二次上游调用。retryable=false 供下方 catch 识别。
          throw new AppError("AI 服务暂时不可用", 502, false);
        }
        // 5xx → 落入重试
        lastErr = new AppError("AI 服务暂时不可用", 502);
        if (attempt < retries) {
          await sleep(500 * (attempt + 1));
          continue;
        }
        throw lastErr;
      }

      const data = (await res.json()) as DeepSeekResponse;
      const choice = data.choices?.[0];
      const content = choice?.message?.content;
      if (!content || !content.trim()) {
        // 推理模型专属：思维链耗尽 token 预算导致正文空（finish_reason=length）。
        // 放大预算重试一次，而非直接失败。
        const truncated = choice?.finish_reason === "length" || Boolean(choice?.message?.reasoning_content);
        if (truncated && attempt < retries) {
          effectiveMaxTokens = Math.min(effectiveMaxTokens * 2, 16000);
          console.warn(`[llm] 正文空(思维链耗尽), 放大 max_tokens 至 ${effectiveMaxTokens} 重试`);
          await sleep(300);
          continue;
        }
        throw new AppError("AI 返回为空", 502);
      }
      // v2.3：上报实际 Token 用量供积分记账（失败不影响正文返回）
      if (onUsage && data.usage) {
        try {
          onUsage({
            promptTokens: data.usage.prompt_tokens ?? 0,
            completionTokens: data.usage.completion_tokens ?? 0,
            totalTokens: data.usage.total_tokens ?? 0,
            model: modelEntry.key,
          });
        } catch {
          /* 记账回调异常不影响 AI 返回 */
        }
      }
      return content.trim();
    } catch (e) {
      // AppError 直接上抛（业务级，已折叠）
      if (e instanceof AppError) {
        // 不重试：4xx 业务错，或显式标记 retryable=false 的上游 4xx（已折叠为 502）。
        if ((e.status >= 400 && e.status < 500) || e.retryable === false) throw e;
        lastErr = e;
      } else if (e instanceof Error && e.name === "AbortError") {
        lastErr = new AppError("AI 响应超时，请重试", 504);
      } else {
        console.error("[llm] fetch error:", e);
        lastErr = new AppError("AI 服务暂时不可用", 502);
      }
      if (attempt < retries) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw lastErr;
    } finally {
      // 成功 / 失败 / continue 重试各路径统一清理，避免定时器泄漏或误伤下一次尝试
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new AppError("AI 服务暂时不可用", 502);
}

/**
 * 从模型原始输出里稳健抽取 JSON —— 兼容各家模型的常见「不规矩」输出：
 *  1) 直接就是合法 JSON（多数情况）。
 *  2) 包在 ```json ... ``` 代码围栏里（claude-sonnet-5 即便要求 json_object 仍会这么干）。
 *  3) JSON 前后夹带说明性散文（截取第一个 { 到最后一个 } / 第一个 [ 到最后一个 ]）。
 * 任一步解析成功即返回；全部失败返回 undefined，由调用方折叠为 502。
 */
function extractJson<T>(raw: string): T | undefined {
  const tryParse = (s: string): T | undefined => {
    try {
      return JSON.parse(s) as T;
    } catch {
      return undefined;
    }
  };

  const trimmed = raw.trim();
  const direct = tryParse(trimmed);
  if (direct !== undefined) return direct;

  // 代码围栏：取第一段 ```...``` 内容
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) {
    const inFence = tryParse(fence[1].trim());
    if (inFence !== undefined) return inFence;
  }

  // 夹带散文：截取最外层对象 / 数组字面量
  const firstObj = trimmed.indexOf("{");
  const lastObj = trimmed.lastIndexOf("}");
  if (firstObj >= 0 && lastObj > firstObj) {
    const obj = tryParse(trimmed.slice(firstObj, lastObj + 1));
    if (obj !== undefined) return obj;
  }
  const firstArr = trimmed.indexOf("[");
  const lastArr = trimmed.lastIndexOf("]");
  if (firstArr >= 0 && lastArr > firstArr) {
    const arr = tryParse(trimmed.slice(firstArr, lastArr + 1));
    if (arr !== undefined) return arr;
  }
  return undefined;
}

/** JSON 输出包装：内部 json:true + 稳健解析，失败降级为 AppError。 */
export async function chatJson<T>(opts: Omit<ChatOptions, "json">): Promise<T> {
  const raw = await chat({ ...opts, json: true });
  const parsed = extractJson<T>(raw);
  if (parsed !== undefined) return parsed;
  console.error("[llm] JSON parse failed:", raw.slice(0, 300));
  throw new AppError("AI 返回格式异常，请重试", 502);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 语义搜索：把自然语言 query 扩展为关键词组（场景4）。
 * 服务端直接调用（课程库页），任何失败/未配置都降级为 [q]，保证搜索永不中断。
 * 始终包含原始 q，不丢召回。
 */
// 关键词扩展短缓存：热门/重复查询直接命中，不重复烧 LLM（配合 SSR 侧 IP 限流双保险）。
// 有界 + TTL，防内存无限增长；query 已 trim+lowercase 归一化为键。
const SEARCH_CACHE_TTL = 5 * 60_000;
const SEARCH_CACHE_MAX = 500;
const searchKeywordCache = new Map<string, { terms: string[]; at: number }>();

export async function expandSearchKeywords(q: string): Promise<string[]> {
  const query = q.trim();
  if (!query || !isLLMConfigured()) return query ? [query] : [];

  const cacheKey = query.toLowerCase();
  const now = Date.now();
  const cached = searchKeywordCache.get(cacheKey);
  if (cached && now - cached.at < SEARCH_CACHE_TTL) return cached.terms;

  try {
    const result = await chatJson<{ keywords: string[] }>({
      system: SEARCH_KEYWORDS_SYSTEM,
      user: searchKeywordsUser(query),
      temperature: 0.3,
      maxTokens: 1500,
      timeoutMs: 12_000,
      retries: 0,
    });
    const kws = Array.isArray(result.keywords) ? result.keywords.filter((k) => typeof k === "string" && k.trim()).slice(0, 6) : [];
    const terms = Array.from(new Set([query, ...kws]));
    // 写缓存前先淘汰：超上限删最早插入的一条（Map 迭代序即插入序）。
    if (searchKeywordCache.size >= SEARCH_CACHE_MAX) {
      const oldest = searchKeywordCache.keys().next().value;
      if (oldest !== undefined) searchKeywordCache.delete(oldest);
    }
    searchKeywordCache.set(cacheKey, { terms, at: now });
    return terms;
  } catch {
    return [query];
  }
}
