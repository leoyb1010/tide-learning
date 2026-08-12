import { AppError } from "./api";
import { redactSensitiveText } from "./errors";
import { SEARCH_KEYWORDS_SYSTEM, searchKeywordsUser } from "./ai/prompts";
import { resolveModel, modelCredentials, hasUsableModel } from "./ai/models";
import type { BillingReconciliationInput, Scene } from "./credits";

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

/** 成功响应的用量回调。计费属于交付契约，异步回调必须在正文返回前完成。 */
export type LlmUsageCallback = (usage: LlmUsageInfo) => void | Promise<void>;

/**
 * 一次逻辑 chat 的耐久计费上下文。callKey 必须在所属 job/请求内唯一；后台生成应包含
 * jobId + fencingToken + 阶段 + lessonId + 调用序号，租约接管后自然生成新键。
 */
export interface LlmBillingOptions {
  userId: string;
  scene: Scene;
  callKey: string;
  /** 同一次用户可见操作的稳定账务键；最终未交付时用于整组冲正。 */
  operationKey?: string;
  /** 可选硬预占额；省略时按输入字符上界 + maxTokens + 模型权重保守估算。 */
  estimatedCredits?: number;
  /** 实耗超出预占时允许补扣的硬上限；默认 0，余额绝不透支。 */
  maxAdditionalCredits?: number;
  ttlMs?: number;
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
  onUsage?: LlmUsageCallback; // v2.3：成功返回后回调实际 Token 用量（供积分记账）
  /** 新生成主链使用：供应商调用前先冻结积分，成功结算、失败退款。 */
  billing?: LlmBillingOptions;
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

/**
 * 上层编排不得把计费/幂等保护错误降级成“模型内容无效”后继续调供应商。
 * 这些 AppError 都要 fail-closed，由请求/任务边界做对账和恢复。
 */
export function isFailClosedLlmError(error: unknown): boolean {
  return error instanceof AppError && (
    error.retryable === false ||
    error.status === 402 ||
    error.status === 409 ||
    error.status === 503
  );
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
    billing,
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
    // 预占必须发生在真实供应商请求之前。每次 HTTP retry 都有独立 reservation；失败 attempt
    // 在 finally 退款，下一 attempt 不复用已经退款的状态机行。
    const billingAttemptKey = billing ? `${billing.callKey}:attempt:${attempt}` : null;
    let reservationId: string | null = null;
    let reservationSettled = false;
    let providerRequestId: string | null = null;
    let reconciliation: BillingReconciliationInput | null = null;
    if (billing && billingAttemptKey) {
      const { estimateCredits, reserveCredits } = await import("./credits");
      // UTF-16 字符数作为 prompt token 的保守上界；不会低估中文，ASCII 会多冻结但成功后按真实 usage 退款。
      // JavaScript length 统计 UTF-16 code units；astral 字符（emoji、部分生僻字）可能在
      // 某些 tokenizer 中拆成更多 token。按 UTF-8 byteLength 做更保守的输入上界，
      // 避免供应商已经成功返回后才发现真实用量超过预占、进而无法结算。
      const promptTokenUpperBound = Buffer.byteLength(system, "utf8") + Buffer.byteLength(user, "utf8");
      const estimatedTokens = Math.max(1, promptTokenUpperBound + effectiveMaxTokens);
      const estimatedCredits = billing.estimatedCredits
        ?? estimateCredits(billing.scene, estimatedTokens, modelEntry.key);
      const reservation = await reserveCredits({
        reservationKey: billingAttemptKey,
        operationKey: billing.operationKey,
        userId: billing.userId,
        scene: billing.scene,
        estimatedCredits,
        maxAdditionalCredits: billing.maxAdditionalCredits,
        ttlMs: billing.ttlMs,
      });
      // 同 reservationKey 的 active 行只是“首请求正在进行”，不是第二个
      // provider-dispatch 许可。继续 fetch 会让平台付两次供应商成本，却只结算一次。
      if (reservation.duplicate) {
        throw new AppError("相同 AI 计费请求仍在处理，请等待原操作结果", 409, false);
      }
      if (reservation.status !== "active" || reservation.expiresAt.getTime() <= Date.now()) {
        throw new AppError("本次 AI 计费凭据已使用，请重新发起", 409, false);
      }
      reservationId = reservation.id;
    }

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
      providerRequestId = res.headers.get("x-request-id") || res.headers.get("request-id");

      if (!res.ok) {
        // 4xx 是客户端/配置问题，不重试；5xx 可重试
        await res.text().catch(() => "");
        // 上游有时会回显 prompt 片段，日志只记状态码/请求 id，不保存原始错误体。
        console.error(`[llm] upstream ${res.status}${providerRequestId ? ` request=${providerRequestId.slice(0, 120)}` : ""}`);
        if (res.status >= 400 && res.status < 500) {
          if (res.status === 429) throw new AppError("AI 请求过于频繁，请稍后再试", 429);
          // 上游 4xx（配置错/payload 超限/鉴权失效）折叠为客户端可见 502，但标记不可重试：
          // 确定性失败，重试只会白打第二次上游调用。retryable=false 供下方 catch 识别。
          throw new AppError("AI 服务暂时不可用", 502, false);
        }
        // 5xx → 落入重试
        if (billingAttemptKey) {
          reconciliation = {
            attemptKey: billingAttemptKey,
            reasonCode: "provider_5xx",
            providerStatus: res.status,
            providerRequestId,
          };
        }
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
        // 某些推理模型会耗完预算只返回 reasoning/usage 而没有正文。供应商已经明确报告成本时，
        // 先结算这一 attempt 再放大预算重试；不能把真实成本当“未交付所以退款”。
        if (billing && reservationId && billingAttemptKey && data.usage) {
          try {
            const { settleLlmUsage } = await import("./credits");
            await settleLlmUsage(reservationId, providerUsage(data.usage, modelEntry.key), `${billingAttemptKey}:usage`);
            reservationSettled = true;
          } catch (billingError) {
            reconciliation = {
              attemptKey: billingAttemptKey,
              reasonCode: "settlement_failed",
              providerStatus: 200,
              providerRequestId,
              usage: providerUsage(data.usage, modelEntry.key),
            };
            console.error(
              "[llm] billing settlement failed:",
              redactSensitiveText(billingError instanceof Error ? billingError.message : billingError),
            );
            throw new AppError("AI 费用结算失败，请稍后重试", 503, false);
          }
        }
        // 推理模型专属：思维链耗尽 token 预算导致正文空（finish_reason=length）。
        // 放大预算重试一次，而非直接失败。
        const truncated = choice?.finish_reason === "length" || Boolean(choice?.message?.reasoning_content);
        if (truncated && attempt < retries) {
          effectiveMaxTokens = Math.min(effectiveMaxTokens * 2, 16000);
          console.warn(`[llm] 正文空(思维链耗尽), 放大 max_tokens 至 ${effectiveMaxTokens} 重试`);
          await sleep(300);
          continue;
        }
        if (billingAttemptKey && !data.usage) {
          reconciliation = {
            attemptKey: billingAttemptKey,
            reasonCode: "empty_response",
            providerStatus: 200,
            providerRequestId,
          };
        }
        throw new AppError("AI 返回为空", 502);
      }
      const usage: LlmUsageInfo = data.usage
        ? providerUsage(data.usage, modelEntry.key)
        : approximateUsage(system, user, content, modelEntry.key);

      // 耐久计费是交付前置条件：结算失败不能把已生成正文当免费成功，也绝不能触发供应商重试。
      if (billing && reservationId && billingAttemptKey) {
        try {
          const { settleLlmUsage } = await import("./credits");
          await settleLlmUsage(reservationId, usage, `${billingAttemptKey}:usage`);
          reservationSettled = true;
        } catch (billingError) {
          reconciliation = {
            attemptKey: billingAttemptKey,
            reasonCode: "settlement_failed",
            providerStatus: 200,
            providerRequestId,
            usage,
          };
          console.error(
            "[llm] billing settlement failed:",
            redactSensitiveText(billingError instanceof Error ? billingError.message : billingError),
          );
          throw new AppError("AI 费用结算失败，请稍后重试", 503, false);
        }
      }

      // 通用用量回调仍是成功响应的一部分：必须 await，确保分析/兼容记账完成。
      // 回调失败单独折叠并记录，不能落入外层 LLM retry——上游已经成功，再请求一次只会
      // 产生重复内容、重复供应商成本，甚至在部分记账成功时造成双扣。
      if (onUsage) {
        try {
          await onUsage(usage);
        } catch (usageError) {
          console.error(
            "[llm] usage callback failed:",
            redactSensitiveText(usageError instanceof Error ? usageError.message : usageError),
          );
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
        if (billingAttemptKey && !reconciliation) {
          reconciliation = { attemptKey: billingAttemptKey, reasonCode: "provider_timeout", providerRequestId };
        }
        lastErr = new AppError("AI 响应超时，请重试", 504);
      } else {
        if (billingAttemptKey && !reconciliation) {
          reconciliation = { attemptKey: billingAttemptKey, reasonCode: "provider_network", providerRequestId };
        }
        console.error(
          "[llm] fetch error:",
          redactSensitiveText(e instanceof Error ? e.message : e),
        );
        lastErr = new AppError("AI 服务暂时不可用", 502);
      }
      // HTTP 请求已发出但网络中断/超时/5xx 时，供应商可能已消耗 token 却没有 usage。
      // 不伪造 token 扣费；finally 会把耐久对账事件与退预占放在同一 DB 事务。
      if (billing && reservationId && !reservationSettled) {
        console.warn(`[llm] provider attempt requires billing reconciliation: ${billingAttemptKey ?? "unknown"}`);
      }
      if (attempt < retries) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw lastErr;
    } finally {
      // 成功 / 失败 / continue 重试各路径统一清理，避免定时器泄漏或误伤下一次尝试
      clearTimeout(timer);
      if (reservationId && !reservationSettled) {
        try {
          const { refundCreditReservation, refundCreditReservationForReconciliation } = await import("./credits");
          if (reconciliation) {
            await refundCreditReservationForReconciliation(reservationId, reconciliation);
          } else {
            await refundCreditReservation(reservationId, "LLM 供应商调用未成功交付");
          }
        } catch (refundError) {
          console.error(
            "[llm] billing reservation refund failed:",
            redactSensitiveText(refundError instanceof Error ? refundError.message : refundError),
          );
          // 预占退款/待对账事件没有耐久落库时，绝不能继续下一次供应商 retry：
          // 否则同一逻辑请求会叠加第二笔未知供应商成本与第二笔冻结。finally 抛错会
          // 覆盖上方 continue，明确停在可恢复状态；过期预占仍由后台 sweep 兜底释放。
          throw new AppError("AI 费用状态待恢复，请稍后重试", 503, false);
        }
      }
    }
  }
  throw lastErr ?? new AppError("AI 服务暂时不可用", 502);
}

/** 上游极少数成功响应不返回 usage 时，按真实请求/正文字符数保守记量，绝不静默免单。 */
function approximateUsage(system: string, user: string, content: string, model: string): LlmUsageInfo {
  const promptTokens = Math.max(1, Math.ceil((system.length + user.length) / 3));
  const completionTokens = Math.max(1, Math.ceil(content.length / 3));
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, model };
}

function providerUsage(usage: NonNullable<DeepSeekResponse["usage"]>, model: string): LlmUsageInfo {
  const promptTokens = Math.max(0, usage.prompt_tokens ?? 0);
  const completionTokens = Math.max(0, usage.completion_tokens ?? 0);
  return {
    promptTokens,
    completionTokens,
    totalTokens: Math.max(promptTokens + completionTokens, usage.total_tokens ?? 0),
    model,
  };
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
  // 模型输出可能回显用户导入资料/私有课件；格式失败时只记机械元数据，
  // 不把原文片段落入通用服务日志。
  console.error(`[llm] JSON parse failed (chars=${raw.length})`);
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
